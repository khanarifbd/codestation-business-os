"""In-memory regression checks; no application DB, email or payment service used."""
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.api.v1.finance import _invoice_list_item, _seller_snapshot
from app.api.v1.client_portal import _invoice_response
from app.models.company_settings import OrganizationAddress, OrganizationIdentifier, OrganizationProfile


def main():
    engine = create_engine("sqlite:///:memory:")
    for model in (OrganizationProfile, OrganizationAddress, OrganizationIdentifier):
        model.__table__.create(engine)
    tenant = SimpleNamespace(organization_id="synthetic-org", organization=SimpleNamespace(name="Synthetic QA Company"))
    with Session(engine) as db:
        db.add(OrganizationIdentifier(organization_id=tenant.organization_id, identifier_type="other", label="Synthetic custom reference", value="NOT-A-TAX-ID", is_primary=True))
        db.flush()
        assert _seller_snapshot(db, tenant)[3] is None, "Custom identifier must not enter Tax ID snapshot"
        db.add(OrganizationIdentifier(organization_id=tenant.organization_id, identifier_type="vat", label="VAT", value="SYNTHETIC-VAT", is_primary=False))
        db.add(OrganizationIdentifier(organization_id="other-tenant", identifier_type="tin", label="TIN", value="FOREIGN-TAX", is_primary=True))
        db.flush()
        assert _seller_snapshot(db, tenant)[3] == "SYNTHETIC-VAT", "Tax-only and tenant-isolated selection"
        db.add(OrganizationIdentifier(organization_id=tenant.organization_id, identifier_type="tin", label="TIN", value="PRIMARY-TAX", is_primary=True))
        db.flush()
        assert _seller_snapshot(db, tenant)[3] == "PRIMARY-TAX", "Primary selection among tax identifiers"
    invoice = SimpleNamespace(id="synthetic-invoice", invoice_number="QA-015", client_id="synthetic-client", client_name_snapshot="Synthetic client", order_id=None, project_id=None, quotation_id=None, status="cancelled", subject="Cancelled unissued invoice", issue_date=date(2026, 10, 20), due_date=None, currency="USD", total=Decimal("24.68"), amount_paid=Decimal("0"), balance_due=Decimal("24.68"), created_at=datetime.now(timezone.utc))
    assert _invoice_list_item(invoice, "UTC").balance_due == 0
    assert _invoice_response(invoice).balance_due == 0
    assert invoice.balance_due == Decimal("24.68"), "Display correction must not mutate accounting history"
    invoice.status = "sent"
    assert _invoice_list_item(invoice, "UTC").balance_due == Decimal("24.68")
    assert _invoice_response(invoice).balance_due == Decimal("24.68")
    print("PASS QA-014 tax-only, primary and tenant-isolated identifier selection; QA-015 internal/client cancelled due presentation")

if __name__ == "__main__":
    main()
