from __future__ import annotations

import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Request, Response, status

from app.api.dependencies import CurrentUser, DbSession
from app.core.security import hash_password, verify_password
from app.schemas.auth import PasswordChangeRequest, UserProfileRead, UserProfileUpdateRequest
from app.services.activity_log import record_activity

router = APIRouter(prefix="/profile", tags=["User Profile"])

PHONE_PATTERN = re.compile(r"^[0-9+().\-\s]{4,40}$")


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
                "This account currently uses Google Sign-In and has no password to change. "
                "Continue using Google Sign-In; password creation requires a separate secure re-authentication flow."
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
