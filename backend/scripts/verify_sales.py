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

STRUCTURED_TABLE_COLUMNS = {
    "quotation_sections": {
        "organization_id",
        "id",
        "quotation_id",
        "section_type",
        "title",
        "content",
        "sort_order",
        "is_visible",
        "created_at",
        "updated_at",
    },
    "quotation_milestones": {
        "organization_id",
        "id",
        "quotation_id",
        "title",
        "description",
        "estimated_start_date",
        "estimated_end_date",
        "estimated_duration",
        "acceptance_criteria",
        "sort_order",
        "created_at",
        "updated_at",
    },
    "quotation_payment_milestones": {
        "organization_id",
        "id",
        "quotation_id",
        "quotation_milestone_id",
        "title",
        "description",
        "payment_type",
        "percentage",
        "amount",
        "due_condition",
        "due_date",
        "sort_order",
        "created_at",
        "updated_at",
    },
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

        for table_name in ("quotations", "quotation_items", *STRUCTURED_TABLE_COLUMNS):
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

        for table_name, expected_table_columns in STRUCTURED_TABLE_COLUMNS.items():
            table_columns = set(
                connection.execute(
                    text(
                        "SELECT column_name FROM information_schema.columns "
                        "WHERE table_schema='public' AND table_name=:table_name"
                    ),
                    {"table_name": table_name},
                ).scalars()
            )
            missing_table_columns = expected_table_columns - table_columns
            if missing_table_columns:
                raise AssertionError(
                    f"{table_name} columns missing: {sorted(missing_table_columns)}"
                )

        revision_family_index = connection.execute(
            text("SELECT to_regclass('public.uq_quotations_org_revision_family')")
        ).scalar_one()
        if not revision_family_index:
            raise AssertionError("quotation revision-family unique index is missing")

        quotation_constraint_names = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'public.quotations'::regclass"
                )
            ).scalars()
        )
        required_quotation_constraints = {
            "ck_quotations_revision_shape",
            "ck_quotations_revision_positive",
            "ck_quotations_revision_not_self",
            "ck_quotations_estimated_schedule",
            "fk_quotations_root_quotation",
            "fk_quotations_supersedes_quotation",
        }
        missing_constraints = required_quotation_constraints - quotation_constraint_names
        if missing_constraints:
            raise AssertionError(f"quotation V2 constraints missing: {sorted(missing_constraints)}")

        milestone_constraint_names = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'public.quotation_milestones'::regclass"
                )
            ).scalars()
        )
        if "ck_quotation_milestones_estimated_schedule" not in milestone_constraint_names:
            raise AssertionError("quotation milestone schedule constraint is missing")

        payment_constraint_names = set(
            connection.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'public.quotation_payment_milestones'::regclass"
                )
            ).scalars()
        )
        required_payment_constraints = {
            "ck_quotation_payment_amount_nonnegative",
            "ck_quotation_payment_percentage_range",
            "ck_quotation_payment_type_shape",
        }
        missing_payment_constraints = required_payment_constraints - payment_constraint_names
        if missing_payment_constraints:
            raise AssertionError(
                f"quotation payment milestone constraints missing: {sorted(missing_payment_constraints)}"
            )

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

        notes_backfill_mismatch = connection.execute(
            text(
                "SELECT count(*) FROM quotations q "
                "WHERE q.notes IS NOT NULL AND btrim(q.notes) <> '' "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM quotation_sections s "
                "  WHERE s.organization_id = q.organization_id "
                "    AND s.quotation_id = q.id "
                "    AND s.section_type = 'additional_notes' "
                "    AND s.content = q.notes"
                ")"
            )
        ).scalar_one()
        if notes_backfill_mismatch:
            raise AssertionError("legacy quotation notes were not backfilled into structured sections")

        terms_backfill_mismatch = connection.execute(
            text(
                "SELECT count(*) FROM quotations q "
                "WHERE q.terms_conditions IS NOT NULL AND btrim(q.terms_conditions) <> '' "
                "AND NOT EXISTS ("
                "  SELECT 1 FROM quotation_sections s "
                "  WHERE s.organization_id = q.organization_id "
                "    AND s.quotation_id = q.id "
                "    AND s.section_type = 'terms_conditions' "
                "    AND s.content = q.terms_conditions"
                ")"
            )
        ).scalar_one()
        if terms_backfill_mismatch:
            raise AssertionError("legacy quotation terms were not backfilled into structured sections")

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

    print("quotation V2 revision/commercial/structured model and calculation invariants verified")


if __name__ == "__main__":
    main()
