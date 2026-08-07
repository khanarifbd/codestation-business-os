from decimal import Decimal

from sqlalchemy import text

from app.db.session import engine
from app.services.sales import calculate_line, calculate_totals


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

    print("quotation migration and calculation invariants verified")


if __name__ == "__main__":
    main()
