"""Bounded, tenant-scoped keyset reads for the explicit mode=page contract.

The cursor is a position, not authorization or a snapshot. Every request applies
its tenant predicate again. No configured engine/settings or writes live here.
"""
import base64
import binascii
from datetime import date, datetime, time, timezone
import hashlib
import json
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select

from app.models.hr import EmployeeHRDocument, EmployeeLifecycleEvent
from app.schemas.hr_records import RecordsPageQuery


def parse_records_page(params, resource: str) -> RecordsPageQuery:
    if resource not in {"documents", "lifecycle"}:
        raise ValueError("Unknown Records resource")
    if params.getlist("mode") != ["page"]:
        raise HTTPException(422, "Expected a single mode=page")
    allowed = set(RecordsPageQuery.model_fields) | {"mode"}
    if set(params) - allowed:
        raise HTTPException(422, "Unknown Records query parameter")
    forbidden = "event_type" if resource == "documents" else "document_type"
    if forbidden in params:
        raise HTTPException(422, "Filter belongs to another Records resource")
    values = {}
    for key in RecordsPageQuery.model_fields:
        supplied = params.getlist(key)
        if len(supplied) > 1:
            raise HTTPException(422, f"Duplicate query parameter: {key}")
        if supplied:
            values[key] = supplied[0]
    for key in ("date_from", "date_to"):
        if key in values and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values[key]):
            raise HTTPException(422, f"{key} must be YYYY-MM-DD")
    if "limit" in values and not re.fullmatch(r"[0-9]{1,3}", values["limit"]):
        raise HTTPException(422, "limit must be an integer from 1 to 100")
    try:
        return RecordsPageQuery.model_validate(values)
    except (ValidationError, UnicodeError):
        raise HTTPException(422, "Invalid HR Records page filters") from None


def _context(resource: str, org_id: str, query: RecordsPageQuery) -> str:
    payload = {"resource": resource, "organization_id": org_id,
               "query": query.model_dump(mode="json", exclude={"cursor"})}
    return hashlib.sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _instant(value: datetime) -> str:
    # Models store UTC instants; SQLite's offline adapter strips tzinfo.
    return value.replace(tzinfo=value.tzinfo or timezone.utc).astimezone(timezone.utc).isoformat()


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate cursor field")
        value[key] = item
    return value


def _encode_cursor(resource: str, org_id: str, query: RecordsPageQuery, row) -> str:
    key = {"created_at": _instant(row.created_at), "id": row.id}
    if resource == "lifecycle":
        key["effective_date"] = row.effective_date.isoformat()
    raw = json.dumps({"v": 1, "context": _context(resource, org_id, query), "key": key},
                     sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode_cursor(resource: str, org_id: str, query: RecordsPageQuery):
    if not query.cursor:
        return None
    try:
        token = query.cursor
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,4096}", token):
            raise ValueError()
        value = json.loads(base64.b64decode(token + "=" * (-len(token) % 4), altchars=b"-_", validate=True), object_pairs_hook=_unique_object)
        if not isinstance(value, dict) or set(value) != {"v", "context", "key"}:
            raise ValueError()
        if type(value["v"]) is not int or value["v"] != 1 or value["context"] != _context(resource, org_id, query):
            raise ValueError()
        key = value["key"]
        expected = {"created_at", "id"} | ({"effective_date"} if resource == "lifecycle" else set())
        if not isinstance(key, dict) or set(key) != expected:
            raise ValueError()
        if not isinstance(key["id"], str) or not 1 <= len(key["id"]) <= 36:
            raise ValueError()
        key["id"].encode("utf-8", errors="strict")
        if "\x00" in key["id"]:
            raise ValueError()
        created = datetime.fromisoformat(key["created_at"])
        if created.tzinfo is None:
            raise ValueError()
        key["created_at"] = created.astimezone(timezone.utc)
        if resource == "lifecycle":
            raw_date = key["effective_date"]
            key["effective_date"] = date.fromisoformat(raw_date)
            if key["effective_date"].isoformat() != raw_date:
                raise ValueError()
        return key
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, binascii.Error, UnicodeError):
        raise HTTPException(422, "Invalid or mismatched HR records cursor") from None


def _page_rows(db, org_id: str, resource: str, query: RecordsPageQuery):
    if resource not in {"documents", "lifecycle"}:
        raise ValueError("Unknown Records resource")
    model = EmployeeHRDocument if resource == "documents" else EmployeeLifecycleEvent
    statement = select(model).where(model.organization_id == org_id)
    if query.record_id:
        statement = statement.where(model.id == query.record_id)
    if query.employee_id:
        statement = statement.where(model.employee_id == query.employee_id)
    kind = query.document_type if resource == "documents" else query.event_type
    if kind:
        column = model.document_type if resource == "documents" else model.event_type
        statement = statement.where(column == kind)
    if query.date_from:
        lower = datetime.combine(query.date_from, time.min, tzinfo=timezone.utc) if resource == "documents" else query.date_from
        statement = statement.where((model.created_at if resource == "documents" else model.effective_date) >= lower)
    if query.date_to:
        # Inclusive UTC day, avoiding date.max + one-day overflow.
        upper = datetime.combine(query.date_to, time.max, tzinfo=timezone.utc) if resource == "documents" else query.date_to
        statement = statement.where((model.created_at if resource == "documents" else model.effective_date) <= upper)
    cursor = _decode_cursor(resource, org_id, query)
    if cursor:
        earlier = or_(model.created_at < cursor["created_at"], and_(model.created_at == cursor["created_at"], model.id < cursor["id"]))
        if resource == "lifecycle":
            earlier = or_(model.effective_date < cursor["effective_date"], and_(model.effective_date == cursor["effective_date"], earlier))
        statement = statement.where(earlier)
    ordering = [model.created_at.desc(), model.id.desc()]
    if resource == "lifecycle":
        ordering.insert(0, model.effective_date.desc())
    rows = db.scalars(statement.order_by(*ordering).limit(query.limit + 1)).all()
    more = len(rows) > query.limit
    items = rows[:query.limit]
    return items, _encode_cursor(resource, org_id, query, items[-1]) if more else None


def documents_page(db, org_id: str, query: RecordsPageQuery, names: dict):
    rows, cursor = _page_rows(db, org_id, "documents", query)
    items = [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "title": x.title, "document_type": x.document_type, "reference_number": x.reference_number, "issued_on": x.issued_on, "expires_on": x.expires_on, "file_url": x.file_url, "notes": x.notes} for x in rows]
    return {"items": items, "next_cursor": cursor}


def lifecycle_page(db, org_id: str, query: RecordsPageQuery, names: dict):
    rows, cursor = _page_rows(db, org_id, "lifecycle", query)
    items = [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "event_type": x.event_type, "effective_date": x.effective_date, "title": x.title, "details": x.details, "notes": x.notes} for x in rows]
    return {"items": items, "next_cursor": cursor}
