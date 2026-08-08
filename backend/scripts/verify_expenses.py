from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.finance import create_account
from app.api.v1.finance_expenses import (
    create_expense,
    create_vendor,
    expense_summary,
    profitability_report,
    void_expense,
)
from app.db.session import SessionLocal, engine
from app.models.expenses import ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.projects import Project
from app.schemas.expenses import ExpenseCreate, VendorCreate
from app.schemas.finance import FinancialAccountCreate


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
        "type": "http",
        "method": method,
        "path": path,
        "raw_path": path.encode(),
        "headers": [],
        "query_string": b"",
        "scheme": "https",
        "server": ("testserver", 443),
        "client": ("127.0.0.1", 50000),
    })


def balance(db, account: FinancialAccount) -> Decimal:
    credits = db.scalar(select(text("COALESCE(SUM(amount), 0)")).select_from(FinancialTransaction).where(
        FinancialTransaction.organization_id == account.organization_id,
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "credit",
    )) or Decimal("0")
    debits = db.scalar(select(text("COALESCE(SUM(amount), 0)")).select_from(FinancialTransaction).where(
        FinancialTransaction.organization_id == account.organization_id,
        FinancialTransaction.account_id == account.id,
        FinancialTransaction.direction == "debit",
    )) or Decimal("0")
    return Decimal(account.opening_balance) + Decimal(credits) - Decimal(debits)


def main() -> None:
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id AS organization_id, created_by_user_id AS user_id, timezone, currency, name
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        for table_name in ("vendors", "expense_categories", "expenses", "expense_documents"):
            if connection.execute(text("SELECT to_regclass(:name)"), {"name": f"public.{table_name}"}).scalar_one() is None:
                raise AssertionError(f"missing expense table: {table_name}")
        sequences = dict(connection.execute(text("""
            SELECT document_type, prefix
            FROM organization_document_sequences
            WHERE organization_id=:organization_id AND document_type IN ('expense', 'vendor')
        """), {"organization_id": fixture["organization_id"]}).all())
        if sequences.get("expense") != "EXP" or sequences.get("vendor") != "VND":
            raise AssertionError("expense/vendor sequences were not backfilled")
        category_count = connection.execute(text("""
            SELECT COUNT(*) FROM expense_categories WHERE organization_id=:organization_id
        """), {"organization_id": fixture["organization_id"]}).scalar_one()
        if category_count < 10:
            raise AssertionError("default expense categories were not seeded")

    tenant = FixtureTenant(
        organization_id=str(fixture["organization_id"]),
        user_id=str(fixture["user_id"]),
        organization=FixtureOrganization(
            timezone=str(fixture["timezone"] or "UTC"),
            currency=str(fixture["currency"] or "USD"),
            name=str(fixture["name"]),
        ),
    )
    db = SessionLocal()
    try:
        project = db.scalar(select(Project).where(Project.organization_id == tenant.organization_id).order_by(Project.created_at.desc()))
        if project is None:
            raise AssertionError("expense verification requires a project fixture")
        account_currency = "BDT" if project.currency != "BDT" else "USD"
        account = create_account(
            FinancialAccountCreate(
                name=f"CI Expense {account_currency} Bank",
                account_type="bank",
                currency=account_currency,
                opening_balance=Decimal("50000.00"),
            ),
            make_request("POST", "/api/v1/finance/accounts"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        vendor = create_vendor(
            VendorCreate(name="CI Cloud Vendor", currency=project.currency),
            make_request("POST", "/api/v1/finance/vendors"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if not vendor.vendor_code.startswith("VND-"):
            raise AssertionError("vendor numbering is incorrect")
        category = db.scalar(select(ExpenseCategory).where(
            ExpenseCategory.organization_id == tenant.organization_id,
            ExpenseCategory.slug == "hosting-cloud",
        ))
        if category is None:
            raise AssertionError("hosting-cloud category missing")

        first = create_expense(
            ExpenseCreate(
                description="CI cloud hosting cost",
                category_id=category.id,
                account_id=account.id,
                vendor_id=vendor.id,
                project_id=project.id,
                expense_currency=project.currency,
                expense_amount=Decimal("100.00"),
                account_amount=Decimal("12000.00"),
                tax_amount=Decimal("0.00"),
                payment_method="bank_transfer",
                reference="CI-EXP-1",
            ),
            make_request("POST", "/api/v1/finance/expenses"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if not first.expense_number.startswith("EXP-") or first.status != "posted":
            raise AssertionError("expense was not posted/numbered correctly")
        if first.profitability_currency != project.currency or first.profitability_amount != Decimal("100.00"):
            raise AssertionError("project profitability normalization is incorrect")
        db.expire_all()
        account_row = db.get(FinancialAccount, account.id)
        if account_row is None or balance(db, account_row) != Decimal("38000.00"):
            raise AssertionError("expense did not debit the account ledger")
        expense_tx = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.source_type == "expense",
            FinancialTransaction.source_id == first.id,
            FinancialTransaction.direction == "debit",
        ))
        if expense_tx is None or expense_tx.amount != Decimal("12000.00"):
            raise AssertionError("expense ledger transaction is missing or incorrect")

        report = profitability_report(db, tenant)  # type: ignore[arg-type]
        project_row = next((row for row in report.projects if row.project_id == project.id), None)
        if project_row is None or project_row.direct_expenses < Decimal("100.00"):
            raise AssertionError("project profitability did not include direct expense")

        voided = void_expense(
            first.id,
            make_request("POST", f"/api/v1/finance/expenses/{first.id}/void"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if voided.status != "voided" or voided.voided_at is None:
            raise AssertionError("expense did not void")
        db.expire_all()
        account_row = db.get(FinancialAccount, account.id)
        if account_row is None or balance(db, account_row) != Decimal("50000.00"):
            raise AssertionError("void did not restore account balance")
        reversal = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.source_type == "expense_void",
            FinancialTransaction.source_id == first.id,
            FinancialTransaction.direction == "credit",
        ))
        if reversal is None or reversal.amount != Decimal("12000.00"):
            raise AssertionError("expense void reversal transaction is missing")

        second = create_expense(
            ExpenseCreate(
                description="CI retained project cost",
                category_id=category.id,
                account_id=account.id,
                vendor_id=vendor.id,
                project_id=project.id,
                expense_currency=project.currency,
                expense_amount=Decimal("50.00"),
                account_amount=Decimal("6000.00"),
                payment_method="bank_transfer",
                reference="CI-EXP-2",
            ),
            make_request("POST", "/api/v1/finance/expenses"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if second.status != "posted":
            raise AssertionError("second expense did not remain posted")

        summary = expense_summary(db, tenant)  # type: ignore[arg-type]
        if summary.posted_count < 1 or summary.voided_count < 1 or summary.vendor_count < 1:
            raise AssertionError("expense summary counts are incorrect")
        final_report = profitability_report(db, tenant)  # type: ignore[arg-type]
        final_project = next((row for row in final_report.projects if row.project_id == project.id), None)
        if final_project is None or final_project.direct_expenses < Decimal("50.00"):
            raise AssertionError("posted project expense missing from final profitability report")
    finally:
        db.close()

    print("expense vendor ledger void and profitability verification passed")


if __name__ == "__main__":
    main()
