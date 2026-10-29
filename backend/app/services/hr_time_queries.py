"""Bounded, tenant-scoped keyset reads for the explicit mode=page contract.

The cursor is a position, not authorization or a snapshot. Every request applies
its tenant predicate again. No configured engine/settings or writes live here.
"""
import base64
import binascii
from datetime import date, datetime, timezone
import hashlib
import json
import re

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import and_, or_, select

from app.models.hr import AttendanceRecord, LeaveRequest
from app.schemas.hr_time import TimePageQuery


def parse_time_page(params) -> TimePageQuery:
    if len(params.getlist("mode")) > 1:
        raise HTTPException(422, "Duplicate query parameter: mode")
    values = {}
    for key in TimePageQuery.model_fields:
        supplied = params.getlist(key)
        if len(supplied) > 1:
            raise HTTPException(422, f"Duplicate query parameter: {key}")
        if supplied:
            values[key] = supplied[0]
    # Date-only ISO bounds: do not coerce epoch numbers or local timestamps.
    for key in ("date_from", "date_to"):
        if key in values and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", values[key]):
            raise HTTPException(422, f"{key} must be YYYY-MM-DD")
    if "limit" in values and not re.fullmatch(r"[0-9]{1,3}", values["limit"]):
        raise HTTPException(422, "limit must be an integer from 1 to 100")
    try:
        return TimePageQuery.model_validate(values)
    except ValidationError:
        raise HTTPException(422, "Invalid HR time page filters") from None


def _context(resource: str, org_id: str, query: TimePageQuery) -> str:
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


def _encode_cursor(resource: str, org_id: str, query: TimePageQuery, row) -> str:
    key = {"created_at": _instant(row.created_at), "id": row.id}
    if resource == "attendance":
        key["attendance_date"] = row.attendance_date.isoformat()
    raw = json.dumps({"v": 1, "context": _context(resource, org_id, query), "key": key},
                     sort_keys=True, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode_cursor(resource: str, org_id: str, query: TimePageQuery):
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
        expected = {"created_at", "id"} | ({"attendance_date"} if resource == "attendance" else set())
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
        if resource == "attendance":
            raw_date = key["attendance_date"]
            key["attendance_date"] = date.fromisoformat(raw_date)
            if key["attendance_date"].isoformat() != raw_date:
                raise ValueError()
        return key
    except (ValueError, TypeError, KeyError, OverflowError, RecursionError, binascii.Error, UnicodeError):
        raise HTTPException(422, "Invalid or mismatched HR time cursor") from None


def _page_rows(db, org_id: str, resource: str, query: TimePageQuery):
    model = AttendanceRecord if resource == "attendance" else LeaveRequest
    statement = select(model).where(model.organization_id == org_id)
    if query.record_id:
        statement = statement.where(model.id == query.record_id)
    if query.employee_id:
        statement = statement.where(model.employee_id == query.employee_id)
    if query.status:
        statement = statement.where(model.status == query.status)
    if query.date_from:
        column = model.attendance_date if resource == "attendance" else model.end_date
        statement = statement.where(column >= query.date_from)
    if query.date_to:
        column = model.attendance_date if resource == "attendance" else model.start_date
        statement = statement.where(column <= query.date_to)
    cursor = _decode_cursor(resource, org_id, query)
    if cursor:
        earlier = or_(model.created_at < cursor["created_at"],
                      and_(model.created_at == cursor["created_at"], model.id < cursor["id"]))
        if resource == "attendance":
            earlier = or_(model.attendance_date < cursor["attendance_date"],
                          and_(model.attendance_date == cursor["attendance_date"], earlier))
        statement = statement.where(earlier)
    ordering = [model.created_at.desc(), model.id.desc()]
    if resource == "attendance":
        ordering.insert(0, model.attendance_date.desc())
    rows = db.scalars(statement.order_by(*ordering).limit(query.limit + 1)).all()
    more = len(rows) > query.limit
    items = rows[:query.limit]
    return items, _encode_cursor(resource, org_id, query, items[-1]) if more else None


def attendance_page(db, org_id: str, query: TimePageQuery, names: dict):
    rows, cursor = _page_rows(db, org_id, "attendance", query)
    items = [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "attendance_date": x.attendance_date, "status": x.status, "attendance_mode": x.attendance_mode, "check_in_at": x.check_in_at, "check_out_at": x.check_out_at, "work_minutes": x.work_minutes, "overtime_minutes": x.overtime_minutes, "notes": x.notes} for x in rows]
    return {"items": items, "next_cursor": cursor}


def leave_page(db, org_id: str, query: TimePageQuery, names: dict, types: dict):
    rows, cursor = _page_rows(db, org_id, "leave", query)
    items = [{"id": x.id, "employee_id": x.employee_id, "employee_name": names.get(x.employee_id), "leave_type_id": x.leave_type_id, "leave_type_name": types.get(x.leave_type_id), "start_date": x.start_date, "end_date": x.end_date, "days": str(x.days), "reason": x.reason, "status": x.status, "review_notes": x.review_notes} for x in rows]
    return {"items": items, "next_cursor": cursor}
