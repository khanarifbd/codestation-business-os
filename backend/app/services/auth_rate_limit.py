from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256

from fastapi import HTTPException, Request, status
from sqlalchemy import text

from app.core.client_ip import request_client_ip
from app.db.session import SessionLocal


def _client_ip(request: Request) -> str:
    return request_client_ip(request) or "unknown"


def enforce_auth_rate_limit(
    request: Request,
    *,
    action: str,
    limit: int,
    window_seconds: int,
    identity: str | None = None,
) -> None:
    if limit < 1 or window_seconds < 1:
        raise RuntimeError("Auth rate-limit configuration must be positive")

    now = datetime.now(timezone.utc)
    bucket_epoch = int(now.timestamp()) // window_seconds * window_seconds
    bucket_start = datetime.fromtimestamp(bucket_epoch, tz=timezone.utc)
    expires_at = bucket_start + timedelta(seconds=window_seconds)
    identity_value = (identity or "").strip().lower()
    raw_key = f"{action}|{_client_ip(request)}|{identity_value}|{bucket_epoch}"
    key_hash = sha256(raw_key.encode("utf-8")).hexdigest()

    # Rate-limit accounting is deliberately isolated from the business/auth
    # transaction so a rejected request still consumes its attempt and a later
    # rollback cannot erase the security control.
    with SessionLocal() as rate_db:
        rate_db.execute(
            text("DELETE FROM auth_rate_limit_buckets WHERE expires_at < :cutoff"),
            {"cutoff": now - timedelta(hours=1)},
        )
        count = rate_db.execute(
            text(
                """
                INSERT INTO auth_rate_limit_buckets (
                    key_hash, action, window_started_at, request_count, expires_at, updated_at
                ) VALUES (
                    :key_hash, :action, :window_started_at, 1, :expires_at, :updated_at
                )
                ON CONFLICT (key_hash) DO UPDATE SET
                    request_count = auth_rate_limit_buckets.request_count + 1,
                    updated_at = EXCLUDED.updated_at
                RETURNING request_count
                """
            ),
            {
                "key_hash": key_hash,
                "action": action,
                "window_started_at": bucket_start,
                "expires_at": expires_at,
                "updated_at": now,
            },
        ).scalar_one()
        rate_db.commit()

    if int(count) > limit:
        retry_after = max(1, int((expires_at - now).total_seconds()))
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many authentication attempts. Please try again later.",
            headers={"Retry-After": str(retry_after)},
        )
