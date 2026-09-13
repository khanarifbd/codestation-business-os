from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash

from app.core.config import settings

password_hasher = PasswordHash.recommended()
TokenType = Literal["access", "refresh", "email_verify", "password_reset"]


@dataclass(frozen=True)
class TokenClaims:
    user_id: str
    token_type: TokenType
    token_version: int
    email: str | None = None
    session_id: str | None = None


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    return password_hasher.verify(password, password_hash)


def _create_token(
    subject: str,
    token_type: TokenType,
    expires_delta: timedelta,
    *,
    token_version: int = 0,
    email: str | None = None,
    session_id: str | None = None,
) -> str:
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "type": token_type,
        "ver": int(token_version),
        "iat": now,
        "exp": now + expires_delta,
    }
    if email:
        payload["email"] = email.lower().strip()
    if session_id:
        payload["sid"] = session_id
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def create_access_token(user_id: str, token_version: int = 0, session_id: str | None = None) -> str:
    return _create_token(
        user_id,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
        token_version=token_version,
        session_id=session_id,
    )


def create_refresh_token(user_id: str, token_version: int = 0, session_id: str | None = None) -> str:
    return _create_token(
        user_id,
        "refresh",
        timedelta(days=settings.refresh_token_expire_days),
        token_version=token_version,
        session_id=session_id,
    )


def create_email_verification_token(
    user_id: str,
    email: str,
    token_version: int = 0,
) -> str:
    return _create_token(
        user_id,
        "email_verify",
        timedelta(hours=settings.email_verification_token_expire_hours),
        token_version=token_version,
        email=email,
    )


def create_password_reset_token(
    user_id: str,
    email: str,
    token_version: int = 0,
) -> str:
    return _create_token(
        user_id,
        "password_reset",
        timedelta(minutes=settings.password_reset_token_expire_minutes),
        token_version=token_version,
        email=email,
    )


def decode_token_claims(token: str, expected_type: TokenType) -> TokenClaims:
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
        )
    except InvalidTokenError as exc:
        raise ValueError("Invalid or expired token") from exc

    if payload.get("type") != expected_type:
        raise ValueError("Invalid token type")

    subject = payload.get("sub")
    if not isinstance(subject, str) or not subject:
        raise ValueError("Invalid token subject")

    # Version 0 keeps tokens issued immediately before this migration valid. Any
    # subsequent logout/password reset increments the user's version and revokes
    # every older access/refresh token immediately.
    version = payload.get("ver", 0)
    if not isinstance(version, int) or version < 0:
        raise ValueError("Invalid token version")

    email = payload.get("email")
    if email is not None and (not isinstance(email, str) or not email):
        raise ValueError("Invalid token email")

    session_id = payload.get("sid")
    if session_id is not None and (not isinstance(session_id, str) or not session_id):
        raise ValueError("Invalid session identifier")

    return TokenClaims(
        user_id=subject,
        token_type=expected_type,
        token_version=version,
        email=email.lower().strip() if isinstance(email, str) else None,
        session_id=session_id,
    )


def decode_token(token: str, expected_type: Literal["access", "refresh"]) -> str:
    """Compatibility wrapper for call sites that only need the user id."""
    return decode_token_claims(token, expected_type).user_id
