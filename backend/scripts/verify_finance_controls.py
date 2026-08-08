from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError
from starlette.requests import Request

from app.api.v1.finance import create_account
from app.api.v1.finance_controls import (
    close_accounting_period,
    create_accounting_period,
    create_recurring_expense,
    post_recurring_expense,
    reopen_accounting_period,
    update_recurring_expense,
)
from app.api.v1.finance_expenses import create_expense, create_vendor
from app.db.session import SessionLocal, engine
from app.models.expenses import ExpenseCategory
from app.schemas.expenses import ExpenseCreate, VendorCreate
from app.schemas.finance import FinancialAccountCreate
from app.schemas.finance_controls import (
    AccountingPeriodClose,
    AccountingPeriodCreate,
    AccountingPeriodReopen,
    RecurringExpenseCreate,
    RecurringExpensePost,
    RecurringExpenseUpdate,
)


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


def make_request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(), "headers": [],
        "query_string": b"", "scheme": "https", "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations WHERE name='Existing Tenant Fixture' ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        for table in ("recurring_expenses", "accounting_periods"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table}"}).scalar_one() is None:
                raise AssertionError(f"missing finance controls table: {table}")
        seeded = connection.execute(text("""
            SELECT cost_type FROM expense_categories
            WHERE organization_id=:org AND slug='marketplace-platform-fees'
        """), {"org": fixture["organization_id"]}).scalar_one_or_none()
        if seeded != "direct":
            raise AssertionError("Marketplace & Platform Fees category was not seeded as direct cost")

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]), user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            timezone=str(fixture["timezone"] or "UTC"), currency=str(fixture["currency"] or "USD"), name=str(fixture["name"]),
        ),
    )
    db = SessionLocal()
    try:
        account = create_account(
            FinancialAccountCreate(name="CI Recurring USD", account_type="bank", currency="USD", opening_balance=Decimal("10000.00")),
            make_request("POST", "/api/v1/finance/accounts"), db, tenant,  # type: ignore[arg-type]
        )
        vendor = create_vendor(
            VendorCreate(name="CI Fiverr", currency="USD"), make_request("POST", "/api/v1/finance/vendors"), db, tenant,  # type: ignore[arg-type]
        )
        platform = db.scalar(select(ExpenseCategory).where(
            ExpenseCategory.organization_id == tenant.organization_id,
            ExpenseCategory.slug == "marketplace-platform-fees",
        ))
        if platform is None:
            raise AssertionError("platform fee category missing")

        today = date.today()
        recurring = create_recurring_expense(
            RecurringExpenseCreate(
                name="CI Fiverr Platform Fee",
                description="Monthly marketplace platform fee",
                category_id=platform.id,
                account_id=account.id,
                vendor_id=vendor.id,
                expense_currency="USD",
                expense_amount=Decimal("100.00"),
                frequency="monthly",
                interval_count=1,
                next_due_date=today,
                payment_method="fiverr",
            ),
            make_request("POST", "/api/v1/finance/recurring-expenses"), db, tenant,  # type: ignore[arg-type]
        )
        updated = update_recurring_expense(
            recurring.id,
            RecurringExpenseUpdate(notes="CI recurring schedule"),
            make_request("PATCH", f"/api/v1/finance/recurring-expenses/{recurring.id}"), db, tenant,  # type: ignore[arg-type]
        )
        if updated.notes != "CI recurring schedule":
            raise AssertionError("recurring expense update failed")
        posted = post_recurring_expense(
            recurring.id,
            RecurringExpensePost(expense_date=today),
            make_request("POST", f"/api/v1/finance/recurring-expenses/{recurring.id}/post"), db, tenant,  # type: ignore[arg-type]
        )
        if not posted.expense_number.startswith("EXP-") or posted.next_due_date <= today:
            raise AssertionError("recurring expense posting/next due calculation failed")

        historical = create_expense(
            ExpenseCreate(
                description="CI historical close test",
                category_id=platform.id,
                account_id=account.id,
                vendor_id=vendor.id,
                expense_date=date(2020, 1, 15),
                expense_currency="USD",
                expense_amount=Decimal("25.00"),
                payment_method="fiverr",
            ),
            make_request("POST", "/api/v1/finance/expenses"), db, tenant,  # type: ignore[arg-type]
        )
        period = create_accounting_period(
            AccountingPeriodCreate(name="CI January 2020", start_date=date(2020, 1, 1), end_date=date(2020, 1, 31)),
            make_request("POST", "/api/v1/finance/accounting-periods"), db, tenant,  # type: ignore[arg-type]
        )
        closed = close_accounting_period(
            period.id, AccountingPeriodClose(notes="CI close"),
            make_request("POST", f"/api/v1/finance/accounting-periods/{period.id}/close"), db, tenant,  # type: ignore[arg-type]
        )
        if closed.status != "closed":
            raise AssertionError("accounting period did not close")

        try:
            db.execute(text("UPDATE expenses SET notes='should fail' WHERE id=:id"), {"id": historical.id})
            db.commit()
            raise AssertionError("closed period allowed historical expense mutation")
        except DBAPIError as exc:
            db.rollback()
            if "Accounting period is closed" not in str(exc):
                raise

        reopened = reopen_accounting_period(
            period.id, AccountingPeriodReopen(reason="CI correction verification"),
            make_request("POST", f"/api/v1/finance/accounting-periods/{period.id}/reopen"), db, tenant,  # type: ignore[arg-type]
        )
        if reopened.status != "open" or reopened.reopen_reason != "CI correction verification":
            raise AssertionError("accounting period reopen audit failed")
        db.execute(text("UPDATE expenses SET notes='allowed after reopen' WHERE id=:id"), {"id": historical.id})
        db.commit()
    finally:
        db.close()

    print("recurring expense platform fee and accounting period lock verification passed")


if __name__ == "__main__":
    main()
