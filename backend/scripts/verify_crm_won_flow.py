from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.crm import convert_lead
from app.api.v1.crm_status import LeadStatusChange, change_lead_status
from app.db.session import SessionLocal, engine
from app.models.crm import Client, LeadStatus
from app.schemas.crm import LeadConvertRequest


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str


def make_request(method: str, path: str) -> Request:
    return Request(
        {
            "type": "http",
            "method": method,
            "path": path,
            "raw_path": path.encode(),
            "headers": [],
            "query_string": b"",
            "scheme": "https",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 50000),
        }
    )


def expect_http_error(expected_status: int, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != expected_status:
            raise AssertionError(f"Expected HTTP {expected_status}, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"Expected HTTP {expected_status}, but request succeeded")


def main() -> None:
    now = datetime.now(timezone.utc)
    lead_id = str(uuid4())
    unqualified_lead_id = str(uuid4())
    client_sequence_id = str(uuid4())

    with engine.begin() as connection:
        fixture = connection.execute(
            text(
                """
                SELECT o.id AS organization_id, o.created_by_user_id AS user_id
                FROM organizations o
                WHERE o.name = 'Existing Tenant Fixture'
                ORDER BY o.created_at DESC
                LIMIT 1
                """
            )
        ).mappings().one()

        statuses = connection.execute(
            text(
                """
                SELECT id, slug
                FROM lead_statuses
                WHERE organization_id = :organization_id
                  AND slug IN ('proposal', 'won', 'lost')
                """
            ),
            {"organization_id": fixture["organization_id"]},
        ).mappings().all()
        status_by_slug = {row["slug"]: row["id"] for row in statuses}
        if set(status_by_slug) != {"proposal", "won", "lost"}:
            raise AssertionError("CRM fixture is missing proposal/won/lost statuses")

        connection.execute(
            text(
                """
                INSERT INTO organization_document_sequences
                    (id, organization_id, document_type, prefix, next_number, padding,
                     separator, created_at, updated_at)
                VALUES
                    (:id, :organization_id, 'client', 'CLI', 1, 5, '-', :now, :now)
                ON CONFLICT (organization_id, document_type) DO NOTHING
                """
            ),
            {
                "id": client_sequence_id,
                "organization_id": fixture["organization_id"],
                "now": now,
            },
        )

        for current_lead_id, code in (
            (lead_id, f"LEAD-CI-{lead_id[:8]}"),
            (unqualified_lead_id, f"LEAD-CI-{unqualified_lead_id[:8]}"),
        ):
            connection.execute(
                text(
                    """
                    INSERT INTO leads
                        (id, organization_id, lead_code, lead_type, company_name, contact_name,
                         email, status_id, probability_percent, currency, created_at, updated_at)
                    VALUES
                        (:id, :organization_id, :lead_code, 'company', 'CI Client', 'CI Contact',
                         'ci-client@example.com', :status_id, 50, 'USD', :now, :now)
                    """
                ),
                {
                    "id": current_lead_id,
                    "organization_id": fixture["organization_id"],
                    "lead_code": code,
                    "status_id": status_by_slug["proposal"],
                    "now": now,
                },
            )

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
    )

    db = SessionLocal()
    try:
        won_result = change_lead_status(
            lead_id,
            LeadStatusChange(status_id=str(status_by_slug["won"])),
            make_request("PATCH", f"/api/v1/crm/leads/{lead_id}/status"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if won_result.status_category != "won" or not won_result.locked:
            raise AssertionError("Changing a lead to Won must return locked=true")

        expect_http_error(
            409,
            lambda: change_lead_status(
                lead_id,
                LeadStatusChange(status_id=str(status_by_slug["lost"])),
                make_request("PATCH", f"/api/v1/crm/leads/{lead_id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        expect_http_error(
            409,
            lambda: convert_lead(
                unqualified_lead_id,
                LeadConvertRequest(display_name="Should Not Convert"),
                make_request("POST", f"/api/v1/crm/leads/{unqualified_lead_id}/convert"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()

        converted = convert_lead(
            lead_id,
            LeadConvertRequest(
                client_type="company",
                display_name="CI Converted Client",
                legal_name="CI Converted Client LLC",
                contact_name="Converted Contact",
                email="converted@example.com",
                billing_email="billing@example.com",
                phone="+12025550123",
                whatsapp="+12025550123",
                website="https://example.com",
                country_code="US",
                state_region="California",
                city="San Francisco",
                postal_code="94105",
                address_line1="1 Market Street",
                address_line2="Suite 10",
                tax_identifier="CI-TAX-001",
                currency="USD",
                notes="Converted through CI won-flow verification.",
            ),
            make_request("POST", f"/api/v1/crm/leads/{lead_id}/convert"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if converted.display_name != "CI Converted Client":
            raise AssertionError("Won lead conversion did not create the expected client")

        client = db.scalar(select(Client).where(Client.id == converted.id))
        if client is None:
            raise AssertionError("Converted client row was not created")
        if client.billing_email != "billing@example.com" or client.city != "San Francisco":
            raise AssertionError("Full conversion fields were not persisted")

        won_status = db.scalar(select(LeadStatus).where(LeadStatus.id == status_by_slug["won"]))
        if won_status is None:
            raise AssertionError("Won status disappeared during conversion test")

        expect_http_error(
            409,
            lambda: change_lead_status(
                lead_id,
                LeadStatusChange(status_id=str(status_by_slug["lost"])),
                make_request("PATCH", f"/api/v1/crm/leads/{lead_id}/status"),
                db,
                tenant,  # type: ignore[arg-type]
            ),
        )
        db.rollback()
    finally:
        db.close()

    print("crm won-flow verification passed")


if __name__ == "__main__":
    main()
