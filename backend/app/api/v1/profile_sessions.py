from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import and_, or_, select

from app.api.dependencies import CurrentUser, DbSession
from app.models.user_session import UserSession
from app.schemas.auth import UserSessionListRead, UserSessionRead, UserSessionRevokeResult
from app.services.activity_log import record_activity
from app.services.auth_sessions import revoke_user_sessions

router = APIRouter(prefix="/profile", tags=["User Profile"])
_SESSION_HISTORY_DAYS = 90


def _session_read(row: UserSession, *, current_user: CurrentUser, current_session_id: str | None) -> UserSessionRead:
    now = datetime.now(timezone.utc)
    revoked_reason = row.revoked_reason
    if row.token_version != int(current_user.auth_token_version or 0):
        status_value = "revoked"
        revoked_reason = revoked_reason or "security_change"
    elif row.revoked_at is not None:
        status_value = "revoked"
    elif row.expires_at <= now:
        status_value = "expired"
    else:
        status_value = "active"

    return UserSessionRead(
        id=row.id,
        auth_method=row.auth_method,
        device_type=row.device_type,
        browser=row.browser,
        operating_system=row.operating_system,
        ip_address=row.ip_address,
        created_at=row.created_at,
        last_seen_at=row.last_seen_at,
        expires_at=row.expires_at,
        revoked_at=row.revoked_at,
        revoked_reason=revoked_reason,
        status=status_value,
        is_current=bool(current_session_id and row.id == current_session_id and status_value == "active"),
    )


@router.get("/sessions", response_model=UserSessionListRead)
def list_user_sessions(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserSessionListRead:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=_SESSION_HISTORY_DAYS)
    current_session_id = getattr(request.state, "auth_session_id", None)
    rows = db.scalars(
        select(UserSession)
        .where(
            UserSession.user_id == current_user.id,
            or_(
                UserSession.created_at >= cutoff,
                and_(UserSession.revoked_at.is_(None), UserSession.expires_at > now),
            ),
        )
        .order_by(UserSession.last_seen_at.desc(), UserSession.created_at.desc())
        .limit(100)
    ).all()
    return UserSessionListRead(
        items=[
            _session_read(row, current_user=current_user, current_session_id=current_session_id)
            for row in rows
        ],
        legacy_current_session=current_session_id is None,
    )


@router.delete("/sessions/{session_id}", response_model=UserSessionRevokeResult)
def revoke_user_session(
    session_id: str,
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserSessionRevokeResult:
    current_session_id = getattr(request.state, "auth_session_id", None)
    if current_session_id and session_id == current_session_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Use the normal Sign out action for the current device.",
        )

    row = db.scalar(
        select(UserSession)
        .where(UserSession.id == session_id, UserSession.user_id == current_user.id)
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    now = datetime.now(timezone.utc)
    if row.revoked_at is not None or row.expires_at <= now or row.token_version != int(current_user.auth_token_version or 0):
        return UserSessionRevokeResult(revoked_count=0)

    row.revoked_at = now
    row.revoked_reason = "remote_sign_out"
    record_activity(
        db,
        action="auth.session.revoked",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user_session",
        entity_id=row.id,
        message="User remotely signed out a device session",
        metadata={
            "session_id": row.id,
            "device_type": row.device_type,
            "browser": row.browser,
            "operating_system": row.operating_system,
        },
        request=request,
    )
    db.commit()
    return UserSessionRevokeResult(revoked_count=1)


@router.post("/sessions/revoke-others", response_model=UserSessionRevokeResult)
def revoke_other_user_sessions(
    request: Request,
    db: DbSession,
    current_user: CurrentUser,
) -> UserSessionRevokeResult:
    current_session_id = getattr(request.state, "auth_session_id", None)
    if not current_session_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This browser is using a legacy session. Sign in again before managing other devices.",
        )

    revoked_count = revoke_user_sessions(
        db,
        user_id=current_user.id,
        reason="sign_out_other_devices",
        except_session_id=current_session_id,
    )
    record_activity(
        db,
        action="auth.sessions.revoked_others",
        scope="account",
        actor_user_id=current_user.id,
        entity_type="user",
        entity_id=current_user.id,
        message="User signed out all other active device sessions",
        metadata={"current_session_id": current_session_id, "sessions_revoked": revoked_count},
        request=request,
    )
    db.commit()
    return UserSessionRevokeResult(revoked_count=revoked_count)
