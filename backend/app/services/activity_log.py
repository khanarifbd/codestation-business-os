from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog

SENSITIVE_KEYS = {
    "password",
    "password_hash",
    "secret",
    "token",
    "access_token",
    "refresh_token",
    "authorization",
    "jwt",
    "jwt_secret_key",
    "super_admin_password",
    "postgres_password",
}


def _is_sensitive_key(key: str) -> bool:
    normalized = key.lower().replace("-", "_")
    return normalized in SENSITIVE_KEYS or any(
        marker in normalized
        for marker in ("password", "secret", "token", "authorization")
    )


def sanitize_for_audit(value: Any) -> Any:
    """Return a JSON-safe, secret-redacted representation for audit storage."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {
            str(key): "[REDACTED]" if _is_sensitive_key(str(key)) else sanitize_for_audit(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [sanitize_for_audit(item) for item in value]
    if hasattr(value, "model_dump"):
        return sanitize_for_audit(value.model_dump())
    return str(value)


def _request_fields(request: Request | None) -> dict[str, str | None]:
    if request is None:
        return {
            "request_id": None,
            "ip_address": None,
            "user_agent": None,
            "http_method": None,
            "request_path": None,
        }

    real_ip = request.headers.get("x-real-ip")
    forwarded_for = request.headers.get("x-forwarded-for")
    ip_address = real_ip
    if not ip_address and forwarded_for:
        ip_address = forwarded_for.split(",")[-1].strip()
    if not ip_address and request.client:
        ip_address = request.client.host

    return {
        "request_id": getattr(request.state, "request_id", None),
        "ip_address": ip_address,
        "user_agent": request.headers.get("user-agent"),
        "http_method": request.method,
        "request_path": request.url.path,
    }


def record_activity(
    db: Session,
    *,
    action: str,
    scope: str,
    actor_user_id: str | None = None,
    actor_type: str = "user",
    organization_id: str | None = None,
    entity_type: str | None = None,
    entity_id: str | None = None,
    outcome: str = "success",
    message: str | None = None,
    before: Any = None,
    after: Any = None,
    metadata: Any = None,
    request: Request | None = None,
) -> ActivityLog:
    """Stage an audit row in the caller's current transaction.

    Callers must commit the business mutation and this audit record together.
    If audit insertion fails, the same transaction fails and the mutation is not committed.
    """

    request_fields = _request_fields(request)
    log = ActivityLog(
        organization_id=organization_id,
        actor_user_id=actor_user_id,
        actor_type=actor_type,
        scope=scope,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        outcome=outcome,
        message=message,
        before_data=sanitize_for_audit(before),
        after_data=sanitize_for_audit(after),
        metadata_json=sanitize_for_audit(metadata),
        **request_fields,
    )
    db.add(log)
    db.flush()
    return log
