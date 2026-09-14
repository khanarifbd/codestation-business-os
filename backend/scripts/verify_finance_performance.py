from dataclasses import dataclass

from sqlalchemy import event, select, text

from app.api.v1.finance import finance_summary, list_accounts, list_invoices, list_payments
from app.api.v1.finance_pagination import invoice_page, ledger_page, payment_page, receivable_page
from app.db.session import SessionLocal, engine
from app.models.organization import Organization
from app.services.performance_metrics import finish_request_metrics, start_request_metrics


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


def verify_request_metrics(db) -> None:
    metrics, token = start_request_metrics()
    try:
        value = db.execute(text("SELECT 1")).scalar_one()
    finally:
        finish_request_metrics(token)
    if value != 1:
        raise AssertionError("performance telemetry fixture query failed")
    if metrics.db_query_count != 1:
        raise AssertionError(
            f"request DB telemetry regression: expected one query, got {metrics.db_query_count}"
        )
    if metrics.db_total_ms < 0:
        raise AssertionError("request DB telemetry returned a negative duration")


def main() -> None:
    db = SessionLocal()
    try:
        verify_request_metrics(db)

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
        accounts, account_queries = count_selects(lambda: list_accounts(db, tenant))  # type: ignore[arg-type]
        _, invoice_queries = count_selects(
            lambda: list_invoices(db, tenant, search=None, invoice_status=None, client_id=None, limit=100)  # type: ignore[arg-type]
        )
        _, payment_queries = count_selects(
            lambda: list_payments(db, tenant, invoice_id=None, limit=100)  # type: ignore[arg-type]
        )
        invoice_cursor_result, invoice_cursor_queries = count_selects(
            lambda: invoice_page(db, tenant, search=None, invoice_status=None, client_id=None, limit=50, cursor=None)  # type: ignore[arg-type]
        )
        receivable_result, receivable_queries = count_selects(
            lambda: receivable_page(db, tenant, search=None, aging=None, currency=None, limit=50, cursor=None)  # type: ignore[arg-type]
        )
        payment_cursor_result, payment_cursor_queries = count_selects(
            lambda: payment_page(db, tenant, invoice_id=None, limit=50, cursor=None)  # type: ignore[arg-type]
        )
        ledger_cursor_queries = 0
        if accounts:
            _, ledger_cursor_queries = count_selects(
                lambda: ledger_page(accounts[0].id, db, tenant, limit=50, cursor=None)  # type: ignore[arg-type]
            )

        if summary_queries > 4:
            raise AssertionError(f"finance summary query regression: expected <=4 SELECTs, got {summary_queries}")
        if account_queries > 1:
            raise AssertionError(f"account list query regression: expected <=1 SELECT, got {account_queries}")
        if invoice_queries > 1:
            raise AssertionError(f"invoice list query regression: expected <=1 SELECT, got {invoice_queries}")
        if payment_queries > 1:
            raise AssertionError(f"payment list query regression: expected <=1 SELECT, got {payment_queries}")
        if invoice_cursor_queries > 1:
            raise AssertionError(f"invoice cursor query regression: expected <=1 SELECT, got {invoice_cursor_queries}")
        if receivable_queries > 6:
            raise AssertionError(f"receivable page query regression: expected <=6 SELECTs, got {receivable_queries}")
        if payment_cursor_queries > 1:
            raise AssertionError(f"payment cursor query regression: expected <=1 SELECT, got {payment_cursor_queries}")
        if accounts and ledger_cursor_queries > 2:
            raise AssertionError(f"ledger cursor query regression: expected <=2 SELECTs, got {ledger_cursor_queries}")
        if len(invoice_cursor_result.items) > 50 or len(payment_cursor_result.items) > 50 or len(receivable_result.items) > 50:
            raise AssertionError("finance cursor endpoint exceeded requested page size")
        if receivable_result.filtered_count < len(receivable_result.items):
            raise AssertionError("receivable filtered count is smaller than the returned page")
        if sum(1 for item in receivable_result.items if item.days_overdue > 0) > receivable_result.overdue_count:
            raise AssertionError("receivable overdue summary is inconsistent with the returned page")
    finally:
        db.close()

    print(
        "finance performance verification passed: request telemetry=1 query, "
        f"summary={summary_queries}, accounts={account_queries}, invoices={invoice_queries}, payments={payment_queries}, "
        f"invoice_cursor={invoice_cursor_queries}, receivables={receivable_queries}, "
        f"payment_cursor={payment_cursor_queries}, ledger_cursor={ledger_cursor_queries}"
    )


if __name__ == "__main__":
    main()
