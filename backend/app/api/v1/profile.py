from __future__ import annotations

import hmac
import re
import time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile, status
from fastapi.responses import FileResponse

from app.api.dependencies import CurrentUser, DbSession
from app.core.security import hash_password, verify_password
from app.schemas.auth import (
    GooglePasswordSetupRequest,
    PasswordChangeRequest,
    UserProfileRead,
    UserProfileUpdateRequest,
)
from app.services.activity_log import record_activity
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityError,
    GoogleIdentityUnavailableError,
    verify_google_id_token,
)
from app.services.profile_avatar import AVATAR_MAX_BYTES, avatar_storage

router = APIRouter(prefix="/profile", tags=["User Profile"])

PHONE_PATTERN = re.compile(r"^[0-9+().\-\s]{4,40}$")
_GOOGLE_REAUTH_MAX_AGE_SECONDS = 300


def _profile_read(user: CurrentUser) -> UserProfileRead:
    return UserProfileRead(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        timezone=user.timezone,
        system_role=user.system_role,
        is_active=user.is_active,
        is_verified=user.is_verified,
        has_password=user.password_hash is not None,
        google_connected=user.google_subject is not None,
        has_avatar=bool(user.avatar_storage_key),
        avatar_version=user.avatar_version,
        created_at=user.created_at,
        updated_at=user.updated_at,
    )


def _record_password_failure(
    db: DbSession,
    request: Request,
    current_user: CurrentUser,
    *,
    message: str,
    reason: str,
) -> None:
    record_activity(
        db,
        action="user.password.change_failed",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        outcome="failure",
        message=message,
        metadata={"reason": reason, "google_connected": current_user.google_subject is not None},
        request=request,
    )
    db.commit()


def _record_password_setup_failure(
    db: DbSession,
    request: Request,
    current_user: CurrentUser,
    *,
    message: str,
    reason: str,
) -> None:
    record_activity(
        db,
        action="user.password.setup_failed",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        outcome="failure",
        message=message,
        metadata={"reason": reason, "provider": "google"},
        request=request,
    )
    db.commit()


@router.get("", response_model=UserProfileRead)
def get_profile(current_user: CurrentUser) -> UserProfileRead:
    return _profile_read(current_user)


@router.patch("", response_model=UserProfileRead)
def update_profile(
    payload: UserProfileUpdateRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserProfileRead:
    fields = payload.model_fields_set
    if not fields:
        return _profile_read(current_user)

    before = {
        "full_name": current_user.full_name,
        "phone": current_user.phone,
        "timezone": current_user.timezone,
    }

    if "full_name" in fields:
        full_name = (payload.full_name or "").strip()
        if len(full_name) < 2:
            raise HTTPException(status_code=400, detail="Full name must contain at least 2 characters")
        current_user.full_name = full_name

    if "phone" in fields:
        phone = (payload.phone or "").strip() or None
        if phone is not None and (
            not PHONE_PATTERN.fullmatch(phone) or not any(character.isdigit() for character in phone)
        ):
            raise HTTPException(
                status_code=400,
                detail="Enter a valid phone number containing at least one digit",
            )
        current_user.phone = phone

    if "timezone" in fields:
        timezone_name = (payload.timezone or "").strip() or None
        if timezone_name is not None:
            try:
                ZoneInfo(timezone_name)
            except (ZoneInfoNotFoundError, ValueError) as exc:
                raise HTTPException(status_code=400, detail="Select a valid IANA timezone") from exc
        current_user.timezone = timezone_name

    after = {
        "full_name": current_user.full_name,
        "phone": current_user.phone,
        "timezone": current_user.timezone,
    }
    if after != before:
        record_activity(
            db,
            action="user.profile.updated",
            scope="account",
            actor_user_id=current_user.id,
            entity_type="user",
            entity_id=current_user.id,
            before=before,
            after=after,
            message="User updated their profile",
            request=request,
        )
        db.commit()
        db.refresh(current_user)

    return _profile_read(current_user)


@router.get("/avatar")
def get_avatar(current_user: CurrentUser) -> FileResponse:
    if not current_user.avatar_storage_key:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile photo not found")
    path = avatar_storage.resolve(current_user.avatar_storage_key)
    return FileResponse(
        path,
        media_type=current_user.avatar_content_type or "application/octet-stream",
        headers={
            "Cache-Control": "private, max-age=3600",
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.put("/avatar", response_model=UserProfileRead)
async def upload_avatar(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
    file: UploadFile = File(...),
) -> UserProfileRead:
    data = await file.read(AVATAR_MAX_BYTES + 1)
    await file.close()
    new_key, content_type = avatar_storage.save(
        user_id=current_user.id,
        data=data,
        declared_content_type=file.content_type,
    )
    old_key = current_user.avatar_storage_key
    current_user.avatar_storage_key = new_key
    current_user.avatar_content_type = content_type
    current_user.avatar_version = (current_user.avatar_version or 0) + 1
    record_activity(
        db,
        action="user.avatar.updated",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User updated their profile photo",
        metadata={"content_type": content_type},
        request=request,
    )
    try:
        db.commit()
        db.refresh(current_user)
    except Exception:
        db.rollback()
        avatar_storage.delete(new_key)
        raise
    avatar_storage.delete(old_key)
    return _profile_read(current_user)


@router.delete("/avatar", response_model=UserProfileRead)
def remove_avatar(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserProfileRead:
    old_key = current_user.avatar_storage_key
    if not old_key:
        return _profile_read(current_user)
    current_user.avatar_storage_key = None
    current_user.avatar_content_type = None
    current_user.avatar_version = (current_user.avatar_version or 0) + 1
    record_activity(
        db,
        action="user.avatar.removed",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User removed their profile photo",
        request=request,
    )
    db.commit()
    db.refresh(current_user)
    avatar_storage.delete(old_key)
    return _profile_read(current_user)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(
    payload: PasswordChangeRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> Response:
    if current_user.password_hash is None:
        _record_password_failure(
            db,
            request,
            current_user,
            message="Password change rejected because the account has no password credential",
            reason="password_not_configured",
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "This account does not have a password yet. Verify the linked Google account "
                "to create one securely."
            ),
        )

    if not verify_password(payload.current_password, current_user.password_hash):
        _record_password_failure(
            db,
            request,
            current_user,
            message="Password change rejected because the current password was incorrect",
            reason="incorrect_current_password",
        )
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if verify_password(payload.new_password, current_user.password_hash):
        _record_password_failure(
            db,
            request,
            current_user,
            message="Password change rejected because the new password matched the current password",
            reason="password_reuse",
        )
        raise HTTPException(status_code=400, detail="New password must be different from the current password")

    current_user.password_hash = hash_password(payload.new_password)
    record_activity(
        db,
        action="user.password.changed",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User changed their password",
        metadata={"google_connected": current_user.google_subject is not None},
        request=request,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/password/google-setup", response_model=UserProfileRead)
def setup_password_with_google(
    payload: GooglePasswordSetupRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserProfileRead:
    if current_user.password_hash is not None:
        raise HTTPException(status_code=409, detail="This account already has a password")
    if not current_user.google_subject:
        _record_password_setup_failure(
            db,
            request,
            current_user,
            message="Password setup rejected because no Google identity is linked",
            reason="google_not_linked",
        )
        raise HTTPException(status_code=409, detail="A linked Google account is required to set a password")

    try:
        identity = verify_google_id_token(payload.credential)
    except GoogleIdentityConfigurationError as exc:
        raise HTTPException(status_code=503, detail="Google verification is not configured") from exc
    except GoogleIdentityUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail="Google verification is temporarily unavailable. Please try again.",
        ) from exc
    except GoogleIdentityError as exc:
        _record_password_setup_failure(
            db,
            request,
            current_user,
            message="Password setup rejected because Google re-authentication failed",
            reason="invalid_google_credential",
        )
        raise HTTPException(status_code=401, detail="Unable to verify your Google account") from exc

    if not hmac.compare_digest(identity.subject, current_user.google_subject):
        _record_password_setup_failure(
            db,
            request,
            current_user,
            message="Password setup rejected because a different Google identity was used",
            reason="google_subject_mismatch",
        )
        raise HTTPException(status_code=403, detail="Verify with the Google account linked to this profile")

    now = int(time.time())
    if identity.issued_at is None or identity.issued_at < now - _GOOGLE_REAUTH_MAX_AGE_SECONDS:
        _record_password_setup_failure(
            db,
            request,
            current_user,
            message="Password setup rejected because the Google credential was not fresh",
            reason="stale_google_credential",
        )
        raise HTTPException(status_code=401, detail="Google verification expired. Please verify again.")

    current_user.password_hash = hash_password(payload.new_password)
    record_activity(
        db,
        action="user.password.setup",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User created a password after Google re-authentication",
        metadata={"provider": "google"},
        request=request,
    )
    db.commit()
    db.refresh(current_user)
    return _profile_read(current_user)
