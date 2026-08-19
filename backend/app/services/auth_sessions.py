from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

from fastapi import Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import engine
from app.models.user import User
from app.models.user_session import UserSession

_SESSION_TOUCH_INTERVAL = timedelta(minutes=5)


def _request_ip(request: Request) -> str | None:
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()[:64]
    forwarded_for = request.headers.get("x-forwarded-for")
    if forwarded_for:
        return forwarded_for.split(",")[-1].strip()[:64]
    if request.client:
        return request.client.host[:64]
    return None


def describe_user_agent(user_agent: str | None) -> tuple[str, str, str]:
    ua = (user_agent or "").strip()
    lower = ua.lower()

    if "ipad" in lower or "tablet" in lower:
        device_type = "tablet"
    elif "mobile" in lower or "iphone" in lower or "android" in lower:
        device_type = "mobile"
    else:
        device_type = "desktop"

    if "edg/" in lower or "edgios" in lower or "edga" in lower:
        browser = "Microsoft Edge"
    elif "opr/" in lower or "opera" in lower:
        browser = "Opera"
    elif "firefox/" in lower or "fxios" in lower:
        browser = "Firefox"
    elif "crios" in lower or "chrome/" in lower:
        browser = "Chrome"
    elif "safari/" in lower and "version/" in lower:
        browser = "Safari"
    else:
        browser = "Unknown browser"

    if "windows nt" in lower:
        operating_system = "Windows"
    elif "iphone" in lower or "ipad" in lower or "cpu iphone os" in lower:
        operating_system = "iOS / iPadOS"
    elif "android" in lower:
        operating_system = "Android"
    elif "mac os x" in lower or "macintosh" in lower:
        operating_system = "macOS"
    elif "linux" in lower:
        operating_system = "Linux"
    else:
        operating_system = "Unknown OS"

    return device_type, browser, operating_system


def create_user_session(
    db: Session,
    user: User,
    request: Request,
    *,
    auth_method: str,
    legacy_refresh_fingerprint: str | None = None,
) -> UserSession:
    now = datetime.now(timezone.utc)
    user_agent = (request.headers.get("user-agent") or "").strip()[:1000] or None
    device_type, browser, operating_system = describe_user_agent(user_agent)
    session = UserSession(
        user_id=user.id,
        token_version=int(user.auth_token_version or 0),
        auth_method=auth_method[:24],
        device_type=device_type,
        browser=browser,
        operating_system=operating_system,
        user_agent=user_agent,
        ip_address=_request_ip(request),
        legacy_refresh_fingerprint=legacy_refresh_fingerprint,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    db.flush()
    return session


def get_or_create_legacy_user_session(
    db: Session,
    user: User,
    request: Request,
    *,
    refresh_token: str,
) -> tuple[UserSession, bool]:
    """Idempotently upgrade one pre-session refresh token to one UserSession.

    Next.js may issue parallel authenticated requests when a browser only has a
    legacy refresh token. Every request can reach /auth/refresh at the same time.
    A SHA-256 fingerprint plus a DB uniqueness constraint makes that migration
    safe without storing the raw bearer token.
    """

    fingerprint = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
    existing = db.scalar(
        select(UserSession).where(
            UserSession.user_id == user.id,
            UserSession.legacy_refresh_fingerprint == fingerprint,
        )
    )
    if existing is not None:
        return existing, False

    try:
        with db.begin_nested():
            created = create_user_session(
                db,
                user,
                request,
                auth_method="legacy",
                legacy_refresh_fingerprint=fingerprint,
            )
        return created, True
    except IntegrityError:
        # Another parallel refresh upgraded the same legacy token first.
        existing = db.scalar(
            select(UserSession).where(
                UserSession.user_id == user.id,
                UserSession.legacy_refresh_fingerprint == fingerprint,
            )
        )
        if existing is None:
            raise
        return existing, False


def session_is_active(session: UserSession, *, user: User, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    return bool(
        session.user_id == user.id
        and session.revoked_at is None
        and session.expires_at > current
        and session.token_version == int(user.auth_token_version or 0)
    )


def touch_user_session(
    session: UserSession,
    request: Request,
    *,
    extend_expiry: bool = False,
    force: bool = False,
) -> None:
    """Update security telemetry outside the caller's business transaction.

    The Core update avoids making the request-scoped ORM Session dirty, so a
    read-only request never acquires an unrelated pending business mutation.
    """

    now = datetime.now(timezone.utc)
    if not force and session.last_seen_at > now - _SESSION_TOUCH_INTERVAL:
        return

    values: dict[str, object] = {
        "last_seen_at": now,
        "ip_address": _request_ip(request),
    }
    if extend_expiry:
        values["expires_at"] = now + timedelta(days=settings.refresh_token_expire_days)

    with engine.begin() as connection:
        connection.execute(
            update(UserSession)
            .where(UserSession.id == session.id, UserSession.revoked_at.is_(None))
            .values(**values)
        )


def revoke_user_sessions(
    db: Session,
    *,
    user_id: str,
    reason: str,
    except_session_id: str | None = None,
) -> int:
    now = datetime.now(timezone.utc)
    conditions = [
        UserSession.user_id == user_id,
        UserSession.revoked_at.is_(None),
        UserSession.expires_at > now,
    ]
    if except_session_id:
        conditions.append(UserSession.id != except_session_id)
    result = db.execute(
        update(UserSession)
        .where(*conditions)
        .values(revoked_at=now, revoked_reason=reason[:80])
    )
    return int(result.rowcount or 0)
