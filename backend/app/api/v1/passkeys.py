from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import CurrentUser, DbSession
from app.models.passkey import UserPasskey
from app.models.user import User
from app.schemas.auth import TokenPair
from app.schemas.passkey import (
    PasskeyAuthenticationVerifyRequest,
    PasskeyOptionsRead,
    PasskeyRead,
    PasskeyRegistrationOptionsRequest,
    PasskeyRegistrationVerifyRequest,
)
from app.services.activity_log import record_activity
from app.services.auth_rate_limit import enforce_auth_rate_limit
from app.services.auth_sessions import create_user_session
from app.services.passkeys import (
    InvalidAuthenticationResponse,
    InvalidRegistrationResponse,
    authentication_options,
    canonical_credential_id,
    claim_challenge,
    credential_id_hash,
    registration_options,
    registration_transports,
    verify_authentication,
    verify_registration,
    verify_registration_step_up,
)
from app.core.security import create_access_token, create_refresh_token
from app.schemas.auth import UserRead

public_router = APIRouter(prefix="/auth/passkeys", tags=["Authentication"])
profile_router = APIRouter(prefix="/profile/passkeys", tags=["User Profile"])


def _token_pair(user: User, session_id: str) -> TokenPair:
    version = int(user.auth_token_version or 0)
    return TokenPair(
        access_token=create_access_token(user.id, version, session_id),
        refresh_token=create_refresh_token(user.id, version, session_id),
        user=UserRead.model_validate(user),
    )


def _passkey_read(row: UserPasskey) -> PasskeyRead:
    return PasskeyRead.model_validate(row)


def _failed_authentication(
    db: DbSession,
    request: Request,
    *,
    user_id: str | None,
    reason: str,
) -> None:
    record_activity(
        db,
        action="auth.passkey.login_failed",
        scope="auth",
        actor_user_id=user_id,
        actor_type="user" if user_id else "anonymous",
        entity_type="user" if user_id else None,
        entity_id=user_id,
        outcome="failure",
        message="Passkey sign-in failed",
        metadata={"reason": reason},
        request=request,
    )
    db.commit()


@public_router.post("/options", response_model=PasskeyOptionsRead)
def get_authentication_options(request: Request, db: DbSession) -> PasskeyOptionsRead:
    enforce_auth_rate_limit(request, action="passkey_options", limit=30, window_seconds=600)
    challenge, options = authentication_options(db)
    return PasskeyOptionsRead(challenge_id=challenge.id, public_key=options)


@public_router.post("/verify", response_model=TokenPair)
def authenticate_with_passkey(
    payload: PasskeyAuthenticationVerifyRequest,
    request: Request,
    db: DbSession,
) -> TokenPair:
    enforce_auth_rate_limit(request, action="passkey_verify", limit=20, window_seconds=600)
    challenge = claim_challenge(
        db,
        challenge_id=payload.challenge_id,
        purpose="authentication",
        user_id=None,
    )

    raw_credential_id = payload.credential.get("id")
    if not isinstance(raw_credential_id, str):
        _failed_authentication(db, request, user_id=None, reason="missing_credential_id")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    try:
        digest = credential_id_hash(raw_credential_id)
    except ValueError:
        _failed_authentication(db, request, user_id=None, reason="invalid_credential_id")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    passkey = db.scalar(
        select(UserPasskey)
        .where(UserPasskey.credential_id_hash == digest)
        .with_for_update()
    )
    if passkey is None:
        _failed_authentication(db, request, user_id=None, reason="unknown_credential")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    user = db.get(User, passkey.user_id)
    if user is None or not user.is_active or not user.is_verified:
        _failed_authentication(db, request, user_id=passkey.user_id, reason="account_unavailable")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    try:
        verified = verify_authentication(
            credential=payload.credential,
            challenge=challenge,
            passkey=passkey,
        )
    except (InvalidAuthenticationResponse, ValueError, TypeError):
        _failed_authentication(db, request, user_id=user.id, reason="invalid_assertion")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    if credential_id_hash(canonical_credential_id(verified.credential_id)) != passkey.credential_id_hash:
        _failed_authentication(db, request, user_id=user.id, reason="credential_mismatch")
        raise HTTPException(status_code=401, detail="Unable to verify this passkey.")

    passkey.sign_count = verified.new_sign_count
    passkey.credential_device_type = verified.credential_device_type.value
    passkey.backed_up = bool(verified.credential_backed_up)
    passkey.last_used_at = datetime.now(timezone.utc)

    user_session = create_user_session(db, user, request, auth_method="passkey")
    record_activity(
        db,
        action="auth.login.succeeded",
        scope="auth",
        actor_user_id=user.id,
        entity_type="user",
        entity_id=user.id,
        message="User signed in with a passkey",
        metadata={
            "provider": "passkey",
            "passkey_id": passkey.id,
            "session_id": user_session.id,
            "device_type": user_session.device_type,
            "browser": user_session.browser,
            "operating_system": user_session.operating_system,
        },
        request=request,
    )
    db.commit()
    db.refresh(user)
    return _token_pair(user, user_session.id)


@profile_router.get("", response_model=list[PasskeyRead])
def list_passkeys(db: DbSession, current_user: CurrentUser) -> list[PasskeyRead]:
    rows = db.scalars(
        select(UserPasskey)
        .where(UserPasskey.user_id == current_user.id)
        .order_by(UserPasskey.created_at.desc())
    ).all()
    return [_passkey_read(row) for row in rows]


@profile_router.post("/registration/options", response_model=PasskeyOptionsRead)
def get_registration_options(
    payload: PasskeyRegistrationOptionsRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> PasskeyOptionsRead:
    enforce_auth_rate_limit(
        request,
        action="passkey_enroll",
        limit=10,
        window_seconds=600,
        identity=current_user.id,
    )
    method = verify_registration_step_up(
        db,
        request,
        current_user,
        current_password=payload.current_password,
        google_credential=payload.google_credential,
    )
    challenge, options = registration_options(db, current_user)
    record_activity(
        db,
        action="auth.passkey.enrollment_started",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="Passkey enrollment started after step-up verification",
        metadata={"verification_method": method, "challenge_id": challenge.id},
        request=request,
    )
    db.commit()
    return PasskeyOptionsRead(challenge_id=challenge.id, public_key=options)


@profile_router.post("/registration/verify", response_model=PasskeyRead, status_code=status.HTTP_201_CREATED)
def complete_registration(
    payload: PasskeyRegistrationVerifyRequest,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> PasskeyRead:
    enforce_auth_rate_limit(
        request,
        action="passkey_enroll_verify",
        limit=10,
        window_seconds=600,
        identity=current_user.id,
    )
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Passkey name is required.")

    challenge = claim_challenge(
        db,
        challenge_id=payload.challenge_id,
        purpose="registration",
        user_id=current_user.id,
    )
    try:
        verified = verify_registration(
            credential=payload.credential,
            challenge=challenge,
        )
    except (InvalidRegistrationResponse, ValueError, TypeError):
        record_activity(
            db,
            action="auth.passkey.enrollment_failed",
            scope="auth",
            actor_user_id=current_user.id,
            entity_type="user",
            entity_id=current_user.id,
            outcome="failure",
            message="Passkey registration response was invalid",
            metadata={"reason": "invalid_attestation"},
            request=request,
        )
        db.commit()
        raise HTTPException(status_code=400, detail="Unable to register this passkey. Please try again.")

    credential_id = canonical_credential_id(verified.credential_id)
    digest = credential_id_hash(credential_id)
    existing = db.scalar(select(UserPasskey.id).where(UserPasskey.credential_id_hash == digest))
    if existing is not None:
        record_activity(
            db,
            action="auth.passkey.enrollment_failed",
            scope="auth",
            actor_user_id=current_user.id,
            entity_type="user",
            entity_id=current_user.id,
            outcome="failure",
            message="Passkey registration attempted to reuse an existing credential",
            metadata={"reason": "credential_exists"},
            request=request,
        )
        db.commit()
        raise HTTPException(status_code=409, detail="This passkey is already registered.")

    passkey = UserPasskey(
        user_id=current_user.id,
        name=name,
        credential_id=credential_id,
        credential_id_hash=digest,
        credential_public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        credential_device_type=verified.credential_device_type.value,
        backed_up=bool(verified.credential_backed_up),
        transports=registration_transports(payload.credential),
        aaguid=verified.aaguid,
    )
    db.add(passkey)
    db.flush()
    record_activity(
        db,
        action="auth.passkey.added",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user_passkey",
        entity_id=passkey.id,
        message="User added a passkey",
        metadata={
            "passkey_id": passkey.id,
            "name": passkey.name,
            "credential_device_type": passkey.credential_device_type,
            "backed_up": passkey.backed_up,
        },
        request=request,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This passkey is already registered.") from exc
    db.refresh(passkey)
    return _passkey_read(passkey)


@profile_router.delete("/{passkey_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_passkey(
    passkey_id: str,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> None:
    row = db.scalar(
        select(UserPasskey).where(
            UserPasskey.id == passkey_id,
            UserPasskey.user_id == current_user.id,
        )
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Passkey not found")
    before = {
        "passkey_id": row.id,
        "name": row.name,
        "credential_device_type": row.credential_device_type,
        "backed_up": row.backed_up,
    }
    db.delete(row)
    record_activity(
        db,
        action="auth.passkey.removed",
        scope="auth",
        actor_user_id=current_user.id,
        entity_type="user_passkey",
        entity_id=row.id,
        message="User removed a passkey",
        before=before,
        request=request,
    )
    db.commit()
    return None
