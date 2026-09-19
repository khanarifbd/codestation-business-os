from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from fastapi import HTTPException, Request, status
from sqlalchemy import delete, insert, select, update
from sqlalchemy.orm import Session
from webauthn import (
    base64url_to_bytes,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import bytes_to_base64url
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse
from webauthn.helpers.structs import (
    AttestationConveyancePreference,
    AuthenticatorSelectionCriteria,
    AuthenticatorTransport,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.core.config import settings
from app.core.security import verify_password
from app.models.passkey import PasskeyChallenge, UserPasskey
from app.models.user import User
from app.services.activity_log import record_activity
from app.services.google_identity import (
    GoogleIdentityConfigurationError,
    GoogleIdentityError,
    GoogleIdentityUnavailableError,
    verify_google_id_token,
)

_CHALLENGE_BYTES = 32
_GOOGLE_REAUTH_MAX_AGE_SECONDS = 300
_MAX_PASSKEYS_PER_USER = 20
_ALLOWED_TRANSPORTS = {item.value for item in AuthenticatorTransport}


def relying_party() -> tuple[str, str]:
    parsed = urlsplit(settings.public_app_url.strip())
    host = (parsed.hostname or "").strip().lower()
    scheme = parsed.scheme.lower()
    if not host or scheme not in {"http", "https"}:
        raise RuntimeError("PUBLIC_APP_URL must be an absolute HTTP(S) URL for passkeys")
    if settings.environment.lower().strip() in {"staging", "production"} and scheme != "https":
        raise RuntimeError("Passkeys require HTTPS in staging/production")
    if scheme == "http" and host not in {"localhost", "127.0.0.1"}:
        raise RuntimeError("Passkeys only allow HTTP for local development")
    origin = f"{scheme}://{parsed.netloc}"
    return host, origin


def credential_id_hash(value: str) -> str:
    if not value or len(value) > 2_048:
        raise ValueError("Invalid passkey credential identifier")
    try:
        canonical = bytes_to_base64url(base64url_to_bytes(value))
    except Exception as exc:
        raise ValueError("Invalid passkey credential identifier") from exc
    return hashlib.sha256(canonical.encode("ascii")).hexdigest()


def _cleanup_challenges(db: Session) -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    db.execute(
        delete(PasskeyChallenge.__table__).where(
            (PasskeyChallenge.expires_at < cutoff)
            | (PasskeyChallenge.consumed_at < cutoff)
        )
    )


def create_challenge(db: Session, *, purpose: str, user_id: str | None) -> PasskeyChallenge:
    now = datetime.now(timezone.utc)
    challenge_id = secrets.token_hex(18)
    challenge_id = f"{challenge_id[:8]}-{challenge_id[8:12]}-{challenge_id[12:16]}-{challenge_id[16:20]}-{challenge_id[20:32]}"
    challenge = secrets.token_bytes(_CHALLENGE_BYTES)
    _cleanup_challenges(db)
    db.execute(
        insert(PasskeyChallenge.__table__).values(
            id=challenge_id,
            user_id=user_id,
            purpose=purpose,
            challenge=challenge,
            created_at=now,
            expires_at=now + timedelta(minutes=settings.passkey_challenge_expire_minutes),
            consumed_at=None,
        )
    )
    db.commit()
    return PasskeyChallenge(
        id=challenge_id,
        user_id=user_id,
        purpose=purpose,
        challenge=challenge,
        created_at=now,
        expires_at=now + timedelta(minutes=settings.passkey_challenge_expire_minutes),
        consumed_at=None,
    )


def claim_challenge(
    db: Session,
    *,
    challenge_id: str,
    purpose: str,
    user_id: str | None,
) -> PasskeyChallenge:
    now = datetime.now(timezone.utc)
    row = db.scalar(
        select(PasskeyChallenge)
        .where(
            PasskeyChallenge.id == challenge_id,
            PasskeyChallenge.purpose == purpose,
        )
        .with_for_update()
    )
    if (
        row is None
        or row.consumed_at is not None
        or row.expires_at <= now
        or row.user_id != user_id
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="This passkey request is invalid or expired. Please try again.",
        )
    db.execute(
        update(PasskeyChallenge.__table__)
        .where(
            PasskeyChallenge.id == challenge_id,
            PasskeyChallenge.consumed_at.is_(None),
        )
        .values(consumed_at=now)
    )
    return row


def verify_registration_step_up(
    db: Session,
    request: Request,
    user: User,
    *,
    current_password: str | None,
    google_credential: str | None,
) -> str:
    reason = "verification_required"
    try:
        if current_password:
            if user.password_hash is None or not verify_password(current_password, user.password_hash):
                reason = "invalid_password"
                raise HTTPException(status_code=401, detail="Current password is incorrect.")
            return "password"

        if google_credential:
            if user.google_subject is None:
                reason = "google_not_linked"
                raise HTTPException(status_code=403, detail="Google sign-in is not connected to this account.")
            try:
                identity = verify_google_id_token(google_credential)
            except GoogleIdentityConfigurationError as exc:
                reason = "google_not_configured"
                raise HTTPException(status_code=503, detail="Google verification is not configured.") from exc
            except GoogleIdentityUnavailableError as exc:
                reason = "google_unavailable"
                raise HTTPException(status_code=503, detail="Google verification is temporarily unavailable.") from exc
            except GoogleIdentityError as exc:
                reason = "invalid_google_credential"
                raise HTTPException(status_code=401, detail="Unable to verify your Google account.") from exc

            now = int(time.time())
            if not hmac.compare_digest(identity.subject, user.google_subject):
                reason = "google_subject_mismatch"
                raise HTTPException(status_code=403, detail="Use the Google account connected to this profile.")
            if identity.issued_at is None or identity.issued_at < now - _GOOGLE_REAUTH_MAX_AGE_SECONDS:
                reason = "stale_google_credential"
                raise HTTPException(status_code=401, detail="Google verification expired. Please verify again.")
            return "google"

        raise HTTPException(
            status_code=401,
            detail="Verify your identity with your current password or connected Google account before adding a passkey.",
        )
    except HTTPException:
        record_activity(
            db,
            action="auth.passkey.step_up_failed",
            scope="auth",
            actor_user_id=user.id,
            entity_type="user",
            entity_id=user.id,
            outcome="failure",
            message="Passkey enrollment step-up verification failed",
            metadata={"reason": reason},
            request=request,
        )
        db.commit()
        raise


def registration_options(db: Session, user: User) -> tuple[PasskeyChallenge, dict]:
    rp_id, _ = relying_party()
    existing = db.scalars(select(UserPasskey).where(UserPasskey.user_id == user.id)).all()
    if len(existing) >= _MAX_PASSKEYS_PER_USER:
        raise HTTPException(status_code=400, detail="You can save up to 20 passkeys. Remove an old passkey before adding another.")
    challenge = create_challenge(db, purpose="registration", user_id=user.id)
    exclude_credentials: list[PublicKeyCredentialDescriptor] = []
    for item in existing:
        try:
            transports = [
                AuthenticatorTransport(value)
                for value in (item.transports or [])
                if value in _ALLOWED_TRANSPORTS
            ]
            exclude_credentials.append(
                PublicKeyCredentialDescriptor(
                    id=base64url_to_bytes(item.credential_id),
                    transports=transports or None,
                )
            )
        except Exception:
            continue

    options = generate_registration_options(
        rp_id=rp_id,
        rp_name="CodeStation AI Business OS",
        user_id=user.id.encode("utf-8"),
        user_name=user.email,
        user_display_name=user.full_name,
        challenge=challenge.challenge,
        timeout=settings.passkey_challenge_expire_minutes * 60_000,
        attestation=AttestationConveyancePreference.NONE,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=exclude_credentials,
    )
    return challenge, json.loads(options_to_json(options))


def authentication_options(db: Session) -> tuple[PasskeyChallenge, dict]:
    rp_id, _ = relying_party()
    challenge = create_challenge(db, purpose="authentication", user_id=None)
    options = generate_authentication_options(
        rp_id=rp_id,
        challenge=challenge.challenge,
        timeout=settings.passkey_challenge_expire_minutes * 60_000,
        allow_credentials=None,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    return challenge, json.loads(options_to_json(options))


def verify_registration(
    *,
    credential: dict,
    challenge: PasskeyChallenge,
) :
    rp_id, origin = relying_party()
    return verify_registration_response(
        credential=credential,
        expected_challenge=challenge.challenge,
        expected_rp_id=rp_id,
        expected_origin=origin,
        require_user_verification=True,
    )


def verify_authentication(
    *,
    credential: dict,
    challenge: PasskeyChallenge,
    passkey: UserPasskey,
):
    rp_id, origin = relying_party()
    return verify_authentication_response(
        credential=credential,
        expected_challenge=challenge.challenge,
        expected_rp_id=rp_id,
        expected_origin=origin,
        credential_public_key=passkey.credential_public_key,
        credential_current_sign_count=passkey.sign_count,
        require_user_verification=True,
    )


def registration_transports(credential: dict) -> list[str]:
    response = credential.get("response")
    if not isinstance(response, dict):
        return []
    raw = response.get("transports")
    if not isinstance(raw, list):
        return []
    return list(dict.fromkeys(value for value in raw if isinstance(value, str) and value in _ALLOWED_TRANSPORTS))


def canonical_credential_id(raw: bytes) -> str:
    return bytes_to_base64url(raw)


__all__ = [
    "InvalidAuthenticationResponse",
    "InvalidRegistrationResponse",
    "authentication_options",
    "canonical_credential_id",
    "claim_challenge",
    "credential_id_hash",
    "registration_options",
    "registration_transports",
    "verify_authentication",
    "verify_registration",
    "verify_registration_step_up",
]
