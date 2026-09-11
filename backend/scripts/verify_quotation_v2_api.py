from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import text

from app.db.session import engine
from app.main import app
from app.models.sales import Quotation
from app.schemas.quotation_v2 import QuotationPaymentMilestoneInput
from app.services.quotation_v2 import _payment_amounts


REQUIRED_PATHS = {
    "/api/v1/sales/quotations/{quotation_id}/commercial": {"get", "patch"},
    "/api/v1/sales/quotations/{quotation_id}/revisions": {"get", "post"},
}


def main() -> None:
    with engine.begin() as connection:
        tables = {
            name: connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{name}"}).scalar_one()
            for name in ("quotation_sections", "quotation_milestones", "quotation_payment_milestones")
        }
        missing_tables = [name for name, value in tables.items() if value is None]
        if missing_tables:
            raise AssertionError(f"quotation V2 tables missing: {missing_tables}")

        constraints = set(
            connection.execute(
                text("SELECT conname FROM pg_constraint WHERE conrelid = 'public.quotations'::regclass")
            ).scalars()
        )
        if "uq_quotations_org_number_revision" not in constraints:
            raise AssertionError("revision-aware quotation-number uniqueness is missing")
        if "uq_quotations_org_number" in constraints:
            raise AssertionError("legacy quotation-number-only uniqueness still exists")

        trigger = connection.execute(
            text(
                "SELECT tgname FROM pg_trigger "
                "WHERE tgrelid = 'public.quotations'::regclass "
                "AND NOT tgisinternal AND tgname = 'trg_quotations_prevent_reopen_to_draft'"
            )
        ).scalar_one_or_none()
        if trigger is None:
            raise AssertionError("quotation immutable-revision trigger is missing")

    openapi_paths = app.openapi()["paths"]
    for path, methods in REQUIRED_PATHS.items():
        if path not in openapi_paths:
            raise AssertionError(f"quotation V2 API path missing: {path}")
        actual = set(openapi_paths[path])
        if not methods.issubset(actual):
            raise AssertionError(f"quotation V2 API methods missing for {path}: expected {methods}, got {actual}")

    quotation = Quotation(total=Decimal("100.00"))
    percentage_payloads = [
        QuotationPaymentMilestoneInput(
            title="Advance",
            payment_type="percentage",
            percentage=Decimal("50"),
        ),
        QuotationPaymentMilestoneInput(
            title="Final",
            payment_type="percentage",
            percentage=Decimal("50"),
        ),
    ]
    amounts = _payment_amounts(quotation, percentage_payloads)
    if amounts != [Decimal("50.00"), Decimal("50.00")]:
        raise AssertionError(f"percentage milestone calculation mismatch: {amounts}")

    mixed_payloads = [
        QuotationPaymentMilestoneInput(
            title="Advance",
            payment_type="fixed",
            amount=Decimal("30.00"),
        ),
        QuotationPaymentMilestoneInput(
            title="Final",
            payment_type="fixed",
            amount=Decimal("60.00"),
        ),
    ]
    try:
        _payment_amounts(quotation, mixed_payloads)
    except HTTPException as exc:
        if exc.status_code != 400:
            raise AssertionError(f"unexpected payment validation status: {exc.status_code}") from exc
    else:
        raise AssertionError("incomplete payment schedule was accepted")

    print("quotation V2 structured API, revision workflow, and payment validation verified")


if __name__ == "__main__":
    main()
