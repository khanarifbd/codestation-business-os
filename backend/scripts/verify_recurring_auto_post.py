from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, select, text

from app.db.session import SessionLocal, engine
from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.finance_controls import RecurringExpense
from app.services.activity_log import record_activity
from app.services.recurring_auto_post import process_due_auto_posts


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id
            FROM organizations WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        if connection.execute(text("SELECT to_regclass('public.recurring_expenses')")).scalar_one() is None:
            raise AssertionError("recurring_expenses table missing")
        columns = {row[0] for row in connection.execute(text("""
            SELECT column_name FROM information_schema.columns
            WHERE table_schema='public' AND table_name='recurring_expenses'
        """)).all()}
        if not {"auto_post", "auto_post_last_attempt_at", "auto_post_last_error"}.issubset(columns):
            raise AssertionError("auto-post columns missing")

    db = SessionLocal()
    try:
        organization_id = str(fixture["organization_id"])
        user_id = str(fixture["user_id"])
        category = db.scalar(select(ExpenseCategory).where(
            ExpenseCategory.organization_id == organization_id,
            ExpenseCategory.slug == "office-utilities",
        ))
        if category is None:
            raise AssertionError("office-utilities category missing")
        account = FinancialAccount(
            organization_id=organization_id,
            name="CI Auto Rent BDT",
            account_type="bank",
            currency="BDT",
            opening_balance=Decimal("100000.00"),
            is_active=True,
            created_by_user_id=user_id,
        )
        db.add(account); db.flush()
        recurring = RecurringExpense(
            organization_id=organization_id,
            name="CI Monthly Office Rent",
            description="Monthly office rent",
            category_id=category.id,
            account_id=account.id,
            expense_currency="BDT",
            expense_amount=Decimal("25000.00"),
            frequency="monthly",
            interval_count=1,
            next_due_date=date(2026, 8, 8),
            payment_method="bank_transfer",
            tax_amount=Decimal("0"),
            is_active=True,
            auto_post=True,
            created_by_user_id=user_id,
        )
        db.add(recurring); db.flush()
        record_activity(
            db,
            action="ci.recurring_auto_post.fixture_created",
            scope="tenant",
            actor_user_id=user_id,
            organization_id=organization_id,
            entity_type="recurring_expense",
            entity_id=recurring.id,
            after={"account_id": account.id, "auto_post": True},
            message="CI recurring auto-post fixture created",
        )
        db.commit()
        recurring_id = recurring.id
        run_at = datetime(2026, 8, 8, 12, 0, tzinfo=timezone.utc)

        posted, failed = process_due_auto_posts(db, now=run_at)
        if posted < 1 or failed != 0:
            raise AssertionError(f"unexpected auto-post result posted={posted} failed={failed}")
        db.expire_all()
        recurring = db.get(RecurringExpense, recurring_id)
        if recurring is None or recurring.next_due_date != date(2026, 9, 8) or recurring.last_posted_expense_id is None:
            raise AssertionError("recurring schedule did not advance")
        expense = db.get(Expense, recurring.last_posted_expense_id)
        if expense is None or expense.status != "posted" or expense.expense_amount != Decimal("25000.00"):
            raise AssertionError("auto-posted expense is incorrect")
        tx = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.source_type == "expense",
            FinancialTransaction.source_id == expense.id,
            FinancialTransaction.direction == "debit",
        ))
        if tx is None or tx.amount != Decimal("25000.00") or tx.currency != "BDT":
            raise AssertionError("auto-post ledger debit missing")

        expense_count_before = db.scalar(select(func.count(Expense.id)).where(
            Expense.organization_id == organization_id,
            Expense.id == expense.id,
        )) or 0
        second_posted, second_failed = process_due_auto_posts(db, now=run_at)
        if second_posted != 0 or second_failed != 0:
            raise AssertionError("scheduler reprocessed a recurring expense whose due date had already advanced")
        expense_count_after = db.scalar(select(func.count(Expense.id)).where(
            Expense.organization_id == organization_id,
            Expense.id == expense.id,
        )) or 0
        if expense_count_after != expense_count_before:
            raise AssertionError("scheduler idempotency regression created a duplicate expense")
    finally:
        db.close()

    print("recurring auto post scheduler verification passed")


if __name__ == "__main__":
    main()
