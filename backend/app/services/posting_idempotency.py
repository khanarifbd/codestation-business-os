from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.models.common import new_uuid, utc_now
from app.models.posting_idempotency import PostingIdempotency


HEADER_NAMES = ("Idempotency-Key", "X-Idempotency-Key")
AUTO_WINDOW_SECONDS = 120


def _request_key(request: Request) -> str | None:
    value = next((request.headers.get(name) for name in HEADER_NAMES if request.headers.get(name)), None)
    if value is None:
        return None
    value = value.strip()
    if len(value) < 8 or len(value) > 128:
        raise HTTPException(status_code=400, detail="Idempotency key must be between 8 and 128 characters")
    return value


def _fingerprint(action: str, payload: BaseModel | dict[str, Any] | Any) -> str:
    if isinstance(payload, BaseModel):
        body = payload.model_dump(mode="json")
    elif isinstance(payload, dict):
        body = payload
    else:
        body = payload
    encoded = json.dumps({"action": action, "payload": body}, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _lookup(db, *, organization_id: str, action: str, key: str) -> PostingIdempotency | None:
    return db.scalar(
        select(PostingIdempotency).where(
            PostingIdempotency.organization_id == organization_id,
            PostingIdempotency.action == action,
            PostingIdempotency.idempotency_key == key,
        )
    )


def reserve_posting(
    db,
    request: Request,
    *,
    organization_id: str,
    user_id: str,
    action: str,
    payload: BaseModel | dict[str, Any] | Any,
) -> tuple[PostingIdempotency, bool]:
    fingerprint = _fingerprint(action, payload)
    explicit_key = _request_key(request)
    bucket = int(time.time() // AUTO_WINDOW_SECONDS)
    key = explicit_key or f"auto:{fingerprint[:48]}:{bucket}"

    existing = _lookup(db, organization_id=organization_id, action=action, key=key)
    if existing is not None:
        if existing.request_fingerprint != fingerprint:
            raise HTTPException(status_code=409, detail="This idempotency key was already used for a different request")
        return existing, True

    table = PostingIdempotency.__table__
    item_id = new_uuid()
    insert_statement = (
        pg_insert(table)
        .values(
            id=item_id,
            organization_id=organization_id,
            action=action,
            idempotency_key=key,
            request_fingerprint=fingerprint,
            created_by_user_id=user_id,
            created_at=utc_now(),
            completed_at=None,
            resource_type=None,
            resource_id=None,
        )
        .on_conflict_do_nothing(
            index_elements=[
                table.c.organization_id,
                table.c.action,
                table.c.idempotency_key,
            ]
        )
        .returning(table.c.id)
    )
    inserted_id = db.execute(insert_statement).scalar_one_or_none()

    item = _lookup(db, organization_id=organization_id, action=action, key=key)
    if item is None:
        raise RuntimeError("Unable to reserve financial idempotency key")
    if item.request_fingerprint != fingerprint:
        raise HTTPException(status_code=409, detail="This idempotency key was already used for a different request")
    return item, inserted_id is None


def completed_resource(item: PostingIdempotency, resource_type: str) -> str:
    if item.resource_id is None:
        raise HTTPException(
            status_code=409,
            detail="A matching financial request is already being processed or may have completed. Review transaction history before retrying.",
        )
    if item.resource_type != resource_type:
        raise HTTPException(status_code=409, detail="Idempotency record points to an unexpected resource type")
    return item.resource_id


def complete_posting(db, item: PostingIdempotency, *, resource_type: str, resource_id: str) -> None:
    db.execute(
        update(PostingIdempotency)
        .where(PostingIdempotency.id == item.id)
        .values(
            resource_type=resource_type,
            resource_id=resource_id,
            completed_at=datetime.now(timezone.utc),
        )
        .execution_options(synchronize_session=False)
    )
    db.commit()
