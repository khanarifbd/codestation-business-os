from decimal import Decimal

from sqlalchemy import text

from app.db.session import engine
from app.main import app
from app.services.sales import calculate_line, calculate_totals


REVISION_COLUMNS = {
    "root_quotation_id",
    "supersedes_quotation_id",
    "revision_number",
    "revision_reason",
}

COMMERCIAL_COLUMNS = {
    "project_title",
    "executive_summary",
    "estimated_start_date",
    "estimated_end_date",
    "estimated_duration",
    "start_condition",
    "seller_phone_snapshot",
    "client_phone_snapshot",
    "prepared_by_name_snapshot",
    "prepared_by_email_snapshot",
    "prepared_by_designation_snapshot",
}


def main() -> None:
    with engine.begin() as connection:
        organization_id = connection.execute(
            text("SELECT id FROM organizations WHERE slug LIKE 'existing-tenant-fixture-%' ORDER BY created_at DESC LIMIT 1")
        ).scalar_one()
        sequence = connection.execute(
            text(
                "SELECT prefix FROM organization_document_sequences "
                "WHERE organization_id = :organization_id AND document_type = 'quotation'"
            ),
            {"organization_id": organization_id},
        ).scalar_one()
        if sequence != "QUO":
            raise AssertionError(f"quotation sequence prefix mismatch: {sequence}")

        for table_name in ("quotations", "quotation_items"):
            exists = connection.execute(
                text("SELECT to_regclass(:table_name)"),
                {"table_name": f"public.{table_name}"},
            ).scalar_one()
            if not exists:
                raise AssertionError(f"missing table: {table_name}")

        quotation_columns = set(
            connection.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_schema='public' AND table_name='quotations'"
                )
            ).scalars()
        )
        expected_columns = REVISION_COLUMNS | COMMERCIAL_COLUMNS
        missing_columns = expected_columns - quotation_columns
        if missing_columns:
            raise AssertionError(f"quotation V2 columns missing: {sorted(missing_columns)}")

        revision_family_index = connection.execute(
            text("SELECT to_regclass('public.uq_quotations_org_revision_family')")
        ).scalar_one()
        if not revision_family_index:
            raise AssertionError("quotation revision-family unique index is missing")

        constraint_names = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'public.quotations'::regclass"
                )
            ).scalars()
        )
        required_constraints = {
            "ck_quotations_revision_shape",
            "ck_quotations_revision_positive",
            "ck_quotations_revision_not_self",
            "ck_quotations_estimated_schedule",
            "fk_quotations_root_quotation",
            "fk_quotations_supersedes_quotation",
        }
        missing_constraints = required_constraints - constraint_names
        if missing_constraints:
            raise AssertionError(f"quotation V2 constraints missing: {sorted(missing_constraints)}")

        invalid_legacy_revision_rows = connection.execute(
            text(
                "SELECT count(*) FROM quotations "
                "WHERE revision_number <> 1 "
                "OR root_quotation_id IS NOT NULL "
                "OR supersedes_quotation_id IS NOT NULL"
            )
        ).scalar_one()
        if invalid_legacy_revision_rows:
            raise AssertionError("legacy quotations were not initialized as root revision 1")

        project_backfill_mismatch = connection.execute(
            text(
                "SELECT count(*) FROM quotations "
                "WHERE subject IS NOT NULL AND project_title IS DISTINCT FROM subject"
            )
        ).scalar_one()
        if project_backfill_mismatch:
            raise AssertionError("legacy quotation project-title backfill mismatch")

    client_option_parameters = app.openapi()["paths"]["/api/v1/sales/client-options"]["get"]["parameters"]
    client_option_limit = next(item for item in client_option_parameters if item["name"] == "limit")
    if client_option_limit["schema"].get("maximum") != 100:
        raise AssertionError(f"client-options limit contract mismatch: {client_option_limit}")

    exclusive = calculate_line(
        quantity=Decimal("2"),
        unit_price=Decimal("100"),
        discount_percent=Decimal("10"),
        tax_rate=Decimal("15"),
        tax_calculation_mode="exclusive",
    )
    if exclusive.line_subtotal != Decimal("200.00"):
        raise AssertionError(exclusive)
    if exclusive.discount_amount != Decimal("20.00"):
        raise AssertionError(exclusive)
    if exclusive.tax_amount != Decimal("27.00"):
        raise AssertionError(exclusive)
    if exclusive.line_total != Decimal("207.00"):
        raise AssertionError(exclusive)

    inclusive = calculate_line(
        quantity=Decimal("1"),
        unit_price=Decimal("115"),
        discount_percent=Decimal("0"),
        tax_rate=Decimal("15"),
        tax_calculation_mode="inclusive",
    )
    if inclusive.tax_amount != Decimal("15.00") or inclusive.line_total != Decimal("115.00"):
        raise AssertionError(inclusive)

    totals = calculate_totals([exclusive, inclusive])
    if totals.total != Decimal("322.00"):
        raise AssertionError(totals)

    print("quotation V2 revision/commercial model and calculation invariants verified")


if __name__ == "__main__":
    main()
