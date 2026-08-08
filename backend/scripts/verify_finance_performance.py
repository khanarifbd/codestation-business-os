from dataclasses import dataclass

from sqlalchemy import event, select

from app.api.v1.finance import finance_summary, list_accounts, list_invoices, list_payments
from app.db.session import SessionLocal, engine
from app.models.organization import Organization


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


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


def main() -> None:
    db = SessionLocal()
    try:
        organization = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        if organization is None:
            raise AssertionError("existing tenant fixture missing")
        tenant = FixtureTenant(
            organization_id=organization.id,
            user_id=organization.created_by_user_id,
            organization=FixtureOrganization(
                timezone=organization.timezone or "UTC",
                currency=organization.currency or "USD",
                name=organization.name,
            ),
        )

        _, summary_queries = count_selects(lambda: finance_summary(db, tenant))  # type: ignore[arg-type]
        _, account_queries = count_selects(lambda: list_accounts(db, tenant))  # type: ignore[arg-type]
        _, invoice_queries = count_selects(lambda: list_invoices(db, tenant, limit=100))  # type: ignore[arg-type]
        _, payment_queries = count_selects(lambda: list_payments(db, tenant, limit=100))  # type: ignore[arg-type]

        if summary_queries > 4:
            raise AssertionError(f"finance summary query regression: expected <=4 SELECTs, got {summary_queries}")
        if account_queries > 1:
            raise AssertionError(f"account list query regression: expected <=1 SELECT, got {account_queries}")
        if invoice_queries > 1:
            raise AssertionError(f"invoice list query regression: expected <=1 SELECT, got {invoice_queries}")
        if payment_queries > 1:
            raise AssertionError(f"payment list query regression: expected <=1 SELECT, got {payment_queries}")
    finally:
        db.close()

    print(
        "finance performance verification passed: "
        f"summary={summary_queries}, accounts={account_queries}, invoices={invoice_queries}, payments={payment_queries}"
    )


if __name__ == "__main__":
    main()
