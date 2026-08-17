from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.crm import (
    create_lead_source,
    create_lead_status,
    delete_lead_source,
    delete_lead_status,
    update_lead_source,
    update_lead_status,
)
from app.db.session import SessionLocal, engine
from app.models.crm import LeadSource, LeadStatus
from app.schemas.crm import LeadSourceCreate, LeadSourceUpdate, LeadStatusCreate, LeadStatusUpdate


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str


def req(method: str, path: str) -> Request:
    return Request({"type": "http", "method": method, "path": path, "raw_path": path.encode(), "headers": [], "query_string": b"", "scheme": "https", "server": ("testserver", 443), "client": ("127.0.0.1", 50000)})


def expect(status_code: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != status_code:
            raise AssertionError(f"Expected HTTP {status_code}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {status_code}, but request succeeded")


def main() -> None:
    marker = uuid4().hex[:8]
    lead_id = str(uuid4())
    now = datetime.now(timezone.utc)
    with engine.connect() as connection:
        fixture = connection.execute(text("""
            SELECT o.id AS organization_id, o.created_by_user_id AS user_id,
                   (SELECT id FROM lead_statuses s WHERE s.organization_id=o.id AND s.is_default=true LIMIT 1) AS default_status_id
            FROM organizations o
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(str(fixture["organization_id"]), str(fixture["user_id"]))
    db = SessionLocal()
    try:
        status_item = create_lead_status(
            LeadStatusCreate(name=f"CI Editable {marker}", color="#123456", category="open"),
            req("POST", "/crm/settings/statuses"), db, tenant,  # type: ignore[arg-type]
        )
        status_item = update_lead_status(
            status_item.id,
            LeadStatusUpdate(name=f"CI Edited {marker}", color="#abcdef", category="qualified"),
            req("PATCH", f"/crm/settings/statuses/{status_item.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if status_item.name != f"CI Edited {marker}" or status_item.color != "#abcdef" or status_item.category != "qualified":
            raise AssertionError(f"lead status edit failed: {status_item}")

        source_item = create_lead_source(
            LeadSourceCreate(name=f"CI Source {marker}"),
            req("POST", "/crm/settings/sources"), db, tenant,  # type: ignore[arg-type]
        )
        source_item = update_lead_source(
            source_item.id,
            LeadSourceUpdate(name=f"CI Source Edited {marker}"),
            req("PATCH", f"/crm/settings/sources/{source_item.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if source_item.name != f"CI Source Edited {marker}":
            raise AssertionError(f"lead source edit failed: {source_item}")

        with engine.begin() as connection:
            connection.execute(text("""
                INSERT INTO leads
                    (id, organization_id, lead_code, lead_type, contact_name, status_id, source_id,
                     probability_percent, currency, created_at, updated_at)
                VALUES
                    (:id, :organization_id, :lead_code, 'company', 'CRM Settings CI', :status_id, :source_id,
                     0, 'USD', :now, :now)
            """), {"id": lead_id, "organization_id": tenant.organization_id, "lead_code": f"LEAD-SET-{marker}", "status_id": status_item.id, "source_id": source_item.id, "now": now})

        expect(409, lambda: delete_lead_status(status_item.id, req("DELETE", f"/crm/settings/statuses/{status_item.id}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()
        expect(409, lambda: delete_lead_source(source_item.id, req("DELETE", f"/crm/settings/sources/{source_item.id}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()
        expect(409, lambda: delete_lead_status(str(fixture["default_status_id"]), req("DELETE", f"/crm/settings/statuses/{fixture['default_status_id']}"), db, tenant))  # type: ignore[arg-type]
        db.rollback()

        with engine.begin() as connection:
            connection.execute(text("DELETE FROM leads WHERE id=:id AND organization_id=:organization_id"), {"id": lead_id, "organization_id": tenant.organization_id})

        if delete_lead_source(source_item.id, req("DELETE", f"/crm/settings/sources/{source_item.id}"), db, tenant).status_code != 204:  # type: ignore[arg-type]
            raise AssertionError("unused lead source delete did not return 204")
        if delete_lead_status(status_item.id, req("DELETE", f"/crm/settings/statuses/{status_item.id}"), db, tenant).status_code != 204:  # type: ignore[arg-type]
            raise AssertionError("unused lead status delete did not return 204")

        if db.scalar(select(LeadStatus.id).where(LeadStatus.id == status_item.id)) is not None:
            raise AssertionError("deleted lead status still exists")
        if db.scalar(select(LeadSource.id).where(LeadSource.id == source_item.id)) is not None:
            raise AssertionError("deleted lead source still exists")
    finally:
        db.close()

    print("CRM pipeline settings edit/delete verification passed")


if __name__ == "__main__":
    main()
