from dataclasses import dataclass

from sqlalchemy import event, text

from app.api.v1.accounting import list_journals
from app.api.v1.accounting_money import list_money_entries
from app.api.v1.accounting_read_fast import (
    list_journals_fast,
    list_money_entries_fast,
    list_reconciliations_fast,
    reconciliation_meta_fast,
)
from app.api.v1.accounting_reconciliation import list_reconciliations, meta
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
        if [row.model_dump() for row in legacy_money] != [row.model_dump() for row in fast_money]:
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
        if [row.model_dump() for row in legacy_journals] != [row.model_dump() for row in fast_journals]:
            raise AssertionError("batched journal list changed API output")
        expected_journal_queries = 2 if fast_journals else 1
        if journal_queries != expected_journal_queries:
            raise AssertionError(
                "journal list query regression: "
                f"expected {expected_journal_queries} SELECTs, got {journal_queries}"
            )
    finally:
        db.close()

    print(
        "accounting read performance verification passed: "
        f"money={money_queries}, reconciliation_meta={reconciliation_meta_queries}, "
        f"reconciliations={reconciliation_queries}, journals={journal_queries}"
    )


if __name__ == "__main__":
    main()
