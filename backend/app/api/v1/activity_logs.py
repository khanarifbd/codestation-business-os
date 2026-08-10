import base64
from datetime import datetime, time, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, or_, select

from app.api.dependencies import CurrentSuperAdmin, CurrentTenantAdmin, DbSession
from app.models.activity_log import ActivityLog
from app.schemas.activity_log import ActivityLogDetail, ActivityLogListItem, ActivityLogPage

platform_activity_router = APIRouter(
    prefix="/platform/activity-logs",
    tags=["Platform Activity Logs"],
)
tenant_activity_router = APIRouter(
    prefix="/tenant/activity-logs",
    tags=["Tenant Activity Logs"],
)


def _encode_cursor(log: ActivityLog) -> str:
    raw = f"{log.created_at.isoformat()}|{log.id}".encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode_cursor(cursor: str) -> tuple[datetime, str]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded = base64.urlsafe_b64decode(padded.encode()).decode()
        timestamp, log_id = decoded.rsplit("|", 1)
        return datetime.fromisoformat(timestamp), log_id
    except (ValueError, UnicodeDecodeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid activity log cursor",
        ) from exc


def _apply_cursor(statement, cursor: str | None):
    if not cursor:
        return statement
    created_at, log_id = _decode_cursor(cursor)
    return statement.where(
        or_(
            ActivityLog.created_at < created_at,
            and_(ActivityLog.created_at == created_at, ActivityLog.id < log_id),
        )
    )


def _apply_filters(
    statement,
    *,
    actor_user_id: str | None,
    action: str | None,
    entity_type: str | None,
    outcome: str | None,
    date_from: str | None,
    date_to: str | None,
):
    if actor_user_id:
        statement = statement.where(ActivityLog.actor_user_id == actor_user_id)
    if action:
        statement = statement.where(ActivityLog.action.ilike(f"%{action.strip()}%"))
    if entity_type:
        statement = statement.where(ActivityLog.entity_type == entity_type)
    if outcome:
        statement = statement.where(ActivityLog.outcome == outcome)
    try:
        if date_from:
            start = datetime.combine(datetime.fromisoformat(date_from).date(), time.min, tzinfo=timezone.utc)
            statement = statement.where(ActivityLog.created_at >= start)
        if date_to:
            end = datetime.combine(datetime.fromisoformat(date_to).date(), time.max, tzinfo=timezone.utc)
            statement = statement.where(ActivityLog.created_at <= end)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid activity log date filter") from exc
    return statement


def _page(db: DbSession, statement, limit: int, cursor: str | None) -> ActivityLogPage:
    statement = _apply_cursor(statement, cursor).order_by(
        ActivityLog.created_at.desc(), ActivityLog.id.desc()
    )
    rows = list(db.scalars(statement.limit(limit + 1)).all())
    has_more = len(rows) > limit
    items = rows[:limit]
    return ActivityLogPage(
        items=[ActivityLogListItem.model_validate(item) for item in items],
        next_cursor=_encode_cursor(items[-1]) if has_more and items else None,
    )


@platform_activity_router.get("", response_model=ActivityLogPage)
def list_platform_activity_logs(
    db: DbSession,
    _: CurrentSuperAdmin,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None,
    organization_id: str | None = None,
    actor_user_id: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    outcome: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> ActivityLogPage:
    statement = select(ActivityLog)
    if organization_id:
        statement = statement.where(ActivityLog.organization_id == organization_id)
    statement = _apply_filters(
        statement,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
    )
    return _page(db, statement, limit, cursor)


@platform_activity_router.get("/{log_id}", response_model=ActivityLogDetail)
def get_platform_activity_log(
    log_id: str,
    db: DbSession,
    _: CurrentSuperAdmin,
) -> ActivityLogDetail:
    log = db.get(ActivityLog, log_id)
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity log not found")
    return ActivityLogDetail.model_validate(log)


@tenant_activity_router.get("", response_model=ActivityLogPage)
def list_tenant_activity_logs(
    db: DbSession,
    tenant: CurrentTenantAdmin,
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = None,
    actor_user_id: str | None = None,
    action: str | None = None,
    entity_type: str | None = None,
    outcome: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> ActivityLogPage:
    statement = select(ActivityLog).where(
        ActivityLog.organization_id == tenant.organization_id
    )
    statement = _apply_filters(
        statement,
        actor_user_id=actor_user_id,
        action=action,
        entity_type=entity_type,
        outcome=outcome,
        date_from=date_from,
        date_to=date_to,
    )
    return _page(db, statement, limit, cursor)


@tenant_activity_router.get("/{log_id}", response_model=ActivityLogDetail)
def get_tenant_activity_log(
    log_id: str,
    db: DbSession,
    tenant: CurrentTenantAdmin,
) -> ActivityLogDetail:
    log = db.scalar(
        select(ActivityLog).where(
            ActivityLog.id == log_id,
            ActivityLog.organization_id == tenant.organization_id,
        )
    )
    if log is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Activity log not found")
    return ActivityLogDetail.model_validate(log)
