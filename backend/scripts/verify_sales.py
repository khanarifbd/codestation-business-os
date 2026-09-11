from decimal import Decimal

from sqlalchemy import text

from app.db.session import engine
from app.services.sales import calculate_line, calculate_payment_amount, calculate_totals


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

        for table_name in (
            "quotations",
            "quotation_items",
            "quotation_sections",
            "quotation_milestones",
            "quotation_payment_schedules",
        ):
            exists = connection.execute(
                text("SELECT to_regclass(:table_name)"),
                {"table_name": f"public.{table_name}"},
            ).scalar_one()
            if not exists:
                raise AssertionError(f"missing table: {table_name}")

        revision_column = connection.execute(
            text(
                """
                SELECT is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='quotations' AND column_name='revision_number'
                """
            )
        ).mappings().one()
        if revision_column["is_nullable"] != "NO":
            raise AssertionError("quotations.revision_number must be NOT NULL")

        item_unit_column = connection.execute(
            text(
                """
                SELECT is_nullable
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='quotation_items' AND column_name='unit'
                """
            )
        ).scalar_one()
        if item_unit_column != "NO":
            raise AssertionError("quotation_items.unit must be NOT NULL")

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

    deposit = calculate_payment_amount(
        quotation_total=totals.total,
        payment_type="percentage",
        percentage=Decimal("30"),
        amount=None,
    )
    if deposit != Decimal("96.60"):
        raise AssertionError(f"percentage payment calculation mismatch: {deposit}")

    fixed = calculate_payment_amount(
        quotation_total=totals.total,
        payment_type="fixed",
        percentage=None,
        amount=Decimal("100"),
    )
    if fixed != Decimal("100.00"):
        raise AssertionError(f"fixed payment calculation mismatch: {fixed}")

    print("quotation V2 migration and calculation invariants verified")


if __name__ == "__main__":
    main()
