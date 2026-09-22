"""Regression checks for the configurable, foreground-only session idle policy."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.core.config import settings
from app.services.auth_sessions import session_is_active


def make_session(*, last_activity: datetime, last_seen: datetime, expiry: datetime):
    return SimpleNamespace(
        id="ci-session",
        user_id="ci-user",
        token_version=0,
        revoked_at=None,
        expires_at=expiry,
        last_user_activity_at=last_activity,
        last_seen_at=last_seen,
    )


def main() -> None:
    now = datetime.now(timezone.utc)
    idle = timedelta(minutes=settings.session_idle_timeout_minutes)
    user = SimpleNamespace(id="ci-user", auth_token_version=0)
    fresh = make_session(last_activity=now - timedelta(minutes=1), last_seen=now, expiry=now + idle)
    if not session_is_active(fresh, user=user, now=now):
        raise AssertionError("recently active session was rejected")
    # A background API call may have updated last_seen_at just now, but MUST
    # NOT revive a session whose last actual user interaction was >4h ago.
    idle_session = make_session(
        last_activity=now - idle - timedelta(seconds=1),
        last_seen=now,
        expiry=now + idle,
    )
    if session_is_active(idle_session, user=user, now=now):
        raise AssertionError("background polling must not prolong an idle session")
    expired = make_session(last_activity=now, last_seen=now, expiry=now - timedelta(seconds=1))
    if session_is_active(expired, user=user, now=now):
        raise AssertionError("expired server session remained active")
    revoked = make_session(last_activity=now, last_seen=now, expiry=now + idle)
    revoked.revoked_at = now
    if session_is_active(revoked, user=user, now=now):
        raise AssertionError("revoked session remained active")
    print("session idle verification passed: active, idle after background polling, expired, revoked")


if __name__ == "__main__":
    main()
