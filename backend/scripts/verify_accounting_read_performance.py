from dataclasses import dataclass
from datetime import date

from sqlalchemy import event, text

from app.api.v1.accounting import list_journals
from app.api.v1.accounting_loans import list_accounting_loans
from app.api.v1.accounting_money import list_money_entries
from app.api.v1.accounting_read_fast import (
    list_journals_fast,
    list_money_entries_fast,
    list_reconciliations_fast,
    reconciliation_meta_fast,
)
from app.api.v1.accounting_read_fast_extra import (
    list_accounting_loans_fast,
    list_customer_advances_fast,
    list_payable_bills_fast,
    tax_report_fast,
)
from app.api.v1.accounting_reconciliation import list_reconciliations, meta
from app.api.v1.customer_advances import list_advances
from app.api.v1.payables import list_payable_bills
from app.api.v1.tax import tax_report
from app.db.session import SessionLocal, engine
from app.schemas.accounting_reconciliation import ReconciliationRead


@dataclass(frozen=True)
class Tenant:
    organization_id: str


def count_selects(fn):
    count = 0

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        if statement.lstrip().upper().startswith("SELECT"):
            count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    return result, count


def reconciliation_dump(rows):
    return [ReconciliationRead.model_validate(row).model_dump() for row in rows]


def model_dump(rows):
    return [row.model_dump() if hasattr(row, "model_dump") else dict(row) for row in rows]


def main() -> None:
    with engine.begin() as connection:
        organization_id = str(
            connection.execute(
                text(
                    """
                    SELECT id
                    FROM organizations
                    WHERE name='Existing Tenant Fixture'
                    ORDER BY created_at DESC
                    LIMIT 1
                    """
                )
            ).scalar_one()
        )

    tenant = Tenant(organization_id=organization_id)
    db = SessionLocal()
    try:
        legacy_money = list_money_entries(db, tenant, limit=100)  # type: ignore[arg-type]
        fast_money, money_queries = count_selects(
            lambda: list_money_entries_fast(db, tenant, limit=100)  # type: ignore[arg-type]
        )
        if model_dump(legacy_money) != model_dump(fast_money):
            raise AssertionError("batched money list changed API output")
        if money_queries != 1:
            raise AssertionError(f"money list query regression: expected 1 SELECT, got {money_queries}")

        legacy_meta = meta(db, tenant)  # type: ignore[arg-type]
        fast_meta, reconciliation_meta_queries = count_selects(
            lambda: reconciliation_meta_fast(db, tenant)  # type: ignore[arg-type]
        )
        if legacy_meta != fast_meta:
            raise AssertionError("batched reconciliation meta changed API output")
        if reconciliation_meta_queries != 1:
            raise AssertionError(
                "reconciliation meta query regression: "
                f"expected 1 SELECT, got {reconciliation_meta_queries}"
            )

        legacy_reconciliations = list_reconciliations(db, tenant)  # type: ignore[arg-type]
        fast_reconciliations, reconciliation_queries = count_selects(
            lambda: list_reconciliations_fast(db, tenant)  # type: ignore[arg-type]
        )
        if reconciliation_dump(legacy_reconciliations) != reconciliation_dump(fast_reconciliations):
            raise AssertionError("batched reconciliation list changed API output")
        if reconciliation_queries != 1:
            raise AssertionError(
                "reconciliation list query regression: "
                f"expected 1 SELECT, got {reconciliation_queries}"
            )

        legacy_journals = list_journals(db, tenant, limit=100)  # type: ignore[arg-type]
        fast_journals, journal_queries = count_selects(
            lambda: list_journals_fast(db, tenant, limit=100)  # type: ignore[arg-type]
        )
        if model_dump(legacy_journals) != model_dump(fast_journals):
            raise AssertionError("batched journal list changed API output")
        expected_journal_queries = 2 if fast_journals else 1
        if journal_queries != expected_journal_queries:
            raise AssertionError(
                "journal list query regression: "
                f"expected {expected_journal_queries} SELECTs, got {journal_queries}"
            )

        legacy_advances = list_advances(db, tenant, open_only=False)  # type: ignore[arg-type]
        fast_advances, advance_queries = count_selects(
            lambda: list_customer_advances_fast(db, tenant, open_only=False)  # type: ignore[arg-type]
        )
        if model_dump(legacy_advances) != model_dump(fast_advances):
            raise AssertionError("batched customer advance list changed API output")
        if advance_queries != 1:
            raise AssertionError(
                f"customer advance query regression: expected 1 SELECT, got {advance_queries}"
            )

        legacy_payables = list_payable_bills(db, tenant, include_paid=False, limit=200)  # type: ignore[arg-type]
        fast_payables, payable_queries = count_selects(
            lambda: list_payable_bills_fast(db, tenant, include_paid=False, limit=200)  # type: ignore[arg-type]
        )
        if model_dump(legacy_payables) != model_dump(fast_payables):
            raise AssertionError("batched payable list changed API output")
        if payable_queries != 1:
            raise AssertionError(f"payable query regression: expected 1 SELECT, got {payable_queries}")

        legacy_loans = list_accounting_loans(db, tenant)  # type: ignore[arg-type]
        fast_loans, loan_queries = count_selects(
            lambda: list_accounting_loans_fast(db, tenant)  # type: ignore[arg-type]
        )
        if model_dump(legacy_loans) != model_dump(fast_loans):
            raise AssertionError("batched loan list changed API output")
        if loan_queries != 1:
            raise AssertionError(f"loan list query regression: expected 1 SELECT, got {loan_queries}")

        report_from = date(2020, 1, 1)
        report_to = date(2035, 12, 31)
        legacy_tax = tax_report(db, tenant, report_from, report_to)  # type: ignore[arg-type]
        fast_tax, tax_queries = count_selects(
            lambda: tax_report_fast(db, tenant, report_from, report_to)  # type: ignore[arg-type]
        )
        if legacy_tax != fast_tax:
            raise AssertionError("batched tax report changed API output")
        if tax_queries != 3:
            raise AssertionError(f"tax report query regression: expected 3 SELECTs, got {tax_queries}")
    finally:
        db.close()

    print(
        "accounting read performance verification passed: "
        f"money={money_queries}, reconciliation_meta={reconciliation_meta_queries}, "
        f"reconciliations={reconciliation_queries}, journals={journal_queries}, "
        f"advances={advance_queries}, payables={payable_queries}, loans={loan_queries}, tax={tax_queries}"
    )


if __name__ == "__main__":
    main()
