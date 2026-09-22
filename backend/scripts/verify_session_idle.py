"""Session idle policy: explicit interaction extends; background calls never do."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from fastapi import HTTPException
from starlette.requests import Request

from app.core.config import settings
from app.core.security import create_access_token, create_refresh_token, decode_token_claims
from app.services.auth_sessions import session_is_active


def make_session(*, last_activity: datetime, expiry: datetime):
    return SimpleNamespace(
        id="ci-session",
        user_id="ci-user",
        token_version=0,
        revoked_at=None,
        expires_at=expiry,
        last_user_activity_at=last_activity,
    )


def main() -> None:
    now = datetime.now(timezone.utc)
    idle = timedelta(minutes=settings.session_idle_timeout_minutes)
    user = SimpleNamespace(id="ci-user", auth_token_version=0)
    fresh = make_session(last_activity=now - timedelta(minutes=1), expiry=now + idle)
    if not session_is_active(fresh, user=user, now=now):
        raise AssertionError("recently active session was rejected")
    idle_session = make_session(last_activity=now - idle - timedelta(seconds=1), expiry=now + idle)
    if session_is_active(idle_session, user=user, now=now):
        raise AssertionError("background requests must not prolong an idle session")
    expired = make_session(last_activity=now, expiry=now - timedelta(seconds=1))
    if session_is_active(expired, user=user, now=now):
        raise AssertionError("expired server session remained active")
    print("session idle verification passed: active, idle, and expired session constraints")


if __name__ == "__main__":
    main()
