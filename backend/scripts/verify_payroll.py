from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.financial_corrections import CorrectionRequest, reverse_business_transaction
from app.api.v1.payroll import (
    approve_run,
    create_period,
    create_run,
    create_salary_profile,
    list_periods,
    list_runs,
    list_salary_profiles,
    pay_run,
    payroll_meta,
    pay_payroll_withholding,
)
from app.api.v1.reports import reports_overview
from app.db.session import SessionLocal, engine
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.finance import FinancialTransaction
from app.models.payroll import PayrollEntry, PayrollRun
from app.schemas.payroll import PayrollComponent, PayrollEntryUpdate, PayrollPayRequest, PayrollPeriodCreate, PayrollRunCreate, PayrollWithholdingPaymentCreate, SalaryProfileCreate
from app.api.v1.payroll import update_entry


@dataclass(frozen=True)
class FixtureOrganization:
    id: str
    timezone: str
    currency: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def request(method: str, path: str) -> Request:
    return Request({
        "type": "http", "method": method, "path": path, "raw_path": path.encode(),
        "headers": [], "query_string": b"", "scheme": "https",
        "server": ("testserver", 443), "client": ("127.0.0.1", 50000),
    })


def main() -> None:
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        fixture = connection.execute(text("""
            SELECT id, created_by_user_id, timezone, currency
            FROM organizations
            WHERE name='Existing Tenant Fixture'
            ORDER BY created_at DESC LIMIT 1
        """)).mappings().one()
        role_id = connection.execute(text("""
            SELECT id FROM organization_roles
            WHERE organization_id=:org_id AND is_active=true
            ORDER BY is_system DESC, created_at ASC LIMIT 1
        """), {"org_id": fixture["id"]}).scalar_one()
        membership_id = connection.execute(text("""
            SELECT id FROM memberships WHERE organization_id=:org_id AND user_id=:user_id LIMIT 1
        """), {"org_id": fixture["id"], "user_id": fixture["created_by_user_id"]}).scalar_one_or_none()
        if membership_id is None:
            membership_id = str(uuid4())
            connection.execute(text("""
                INSERT INTO memberships (id, organization_id, user_id, role_id, role, status, created_at)
                VALUES (:id, :org_id, :user_id, :role_id, 'admin', 'active', :now)
            """), {"id": membership_id, "org_id": fixture["id"], "user_id": fixture["created_by_user_id"], "role_id": role_id, "now": now})
        employee_id = connection.execute(text("""
            SELECT id FROM employees WHERE organization_id=:org_id AND membership_id=:membership_id LIMIT 1
        """), {"org_id": fixture["id"], "membership_id": membership_id}).scalar_one_or_none()
        if employee_id is None:
            employee_id = str(uuid4())
            connection.execute(text("""
                INSERT INTO employees
                    (id, organization_id, membership_id, employee_code, employment_type, employment_status, join_date, created_at, updated_at)
                VALUES (:id, :org_id, :membership_id, 'EMP-PAY-CI', 'full_time', 'active', '2098-01-01', :now, :now)
            """), {"id": employee_id, "org_id": fixture["id"], "membership_id": membership_id, "now": now})
        account_id = str(uuid4())
        connection.execute(text("""
            INSERT INTO financial_accounts
                (id, organization_id, name, account_type, currency, opening_balance, is_active, created_by_user_id, created_at, updated_at)
            VALUES (:id, :org_id, :name, 'bank', 'BDT', 1000000.00, true, :user_id, :now, :now)
        """), {"id": account_id, "org_id": fixture["id"], "name": f"Payroll CI {account_id[:8]}", "user_id": fixture["created_by_user_id"], "now": now})

    tenant = FixtureTenant(
        organization_id=str(fixture["id"]), user_id=str(fixture["created_by_user_id"]),
        organization=FixtureOrganization(id=str(fixture["id"]), timezone=str(fixture["timezone"] or "UTC"), currency=str(fixture["currency"] or "BDT")),
    )
    db = SessionLocal()
    try:
        # Verify the exact four reads used by the Payroll page on initial load.
        bootstrap_meta = payroll_meta(db, tenant)  # type: ignore[arg-type]
        bootstrap_profiles = list_salary_profiles(db, tenant)  # type: ignore[arg-type]
        bootstrap_periods = list_periods(db, tenant)  # type: ignore[arg-type]
        bootstrap_runs = list_runs(db, tenant)  # type: ignore[arg-type]
        if not bootstrap_meta.currencies:
            raise AssertionError("payroll meta did not return a currency")
        if bootstrap_profiles or bootstrap_periods or bootstrap_runs:
            raise AssertionError("fresh payroll fixture unexpectedly contains transactional payroll data")

        profile = create_salary_profile(
            SalaryProfileCreate(employee_id=str(employee_id), currency="BDT", pay_frequency="monthly", base_salary=Decimal("50000"),
                default_allowances=[PayrollComponent(name="Housing", amount=Decimal("5000"))],
                default_deductions=[PayrollComponent(name="Provident fund", amount=Decimal("3000"))],
                effective_from=date(2098, 1, 1)),
            request("POST", "/api/v1/payroll/salary-profiles"), db, tenant,  # type: ignore[arg-type]
        )
        if profile.base_salary != Decimal("50000.00"):
            raise AssertionError("salary profile amount mismatch")

        period = create_period(
            PayrollPeriodCreate(name="CI January 2098", period_start=date(2098, 1, 1), period_end=date(2098, 1, 31), pay_date=date(2098, 1, 31)),
            request("POST", "/api/v1/payroll/periods"), db, tenant,  # type: ignore[arg-type]
        )
        run = create_run(PayrollRunCreate(period_id=period.id, currency="BDT"), request("POST", "/api/v1/payroll/runs"), db, tenant)  # type: ignore[arg-type]
        if run.employee_count != 1 or run.gross_total != Decimal("55000.00") or run.net_total != Decimal("52000.00"):
            raise AssertionError(f"payroll generation mismatch: count={run.employee_count}, gross={run.gross_total}, net={run.net_total}")
        entry_count = db.scalar(select(PayrollEntry).where(PayrollEntry.run_id == run.id).with_only_columns(text("count(*)")))
        if int(entry_count or 0) != 1:
            raise AssertionError("payroll entry not generated")
        entry_id = run.entries[0].id
        run = update_entry(
            run.id,
            entry_id,
            PayrollEntryUpdate(tax_amount=Decimal("2000")),
            request("PATCH", f"/api/v1/payroll/runs/{run.id}/entries/{entry_id}"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if run.gross_total != Decimal("55000.00") or run.deduction_total != Decimal("3000.00") or run.tax_total != Decimal("2000.00") or run.net_total != Decimal("50000.00"):
            raise AssertionError("payroll gross/deduction/tax/net totals do not reconcile")

        approved = approve_run(run.id, request("POST", f"/api/v1/payroll/runs/{run.id}/approve"), db, tenant)  # type: ignore[arg-type]
        if approved.status != "approved":
            raise AssertionError("payroll approval failed")
        accrual = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "payroll_accrual",
            JournalEntry.source_id == run.id,
            JournalEntry.status == "posted",
        ))
        if accrual is None:
            raise AssertionError("payroll approval did not create an accrual journal")
        accrual_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == accrual.id)
        ).all()
        by_key = {key: line for line, key in accrual_lines}
        if Decimal(by_key["payroll_expense"].debit) != Decimal("55000.00"):
            raise AssertionError("payroll expense accrual is incorrect")
        if Decimal(by_key["payroll_payable"].credit) != Decimal("50000.00"):
            raise AssertionError("net payroll payable accrual is incorrect")
        if Decimal(by_key["payroll_withholdings"].credit) != Decimal("5000.00"):
            raise AssertionError("payroll deductions/tax liability accrual is incorrect")
        paid = pay_run(run.id, PayrollPayRequest(account_id=account_id), request("POST", f"/api/v1/payroll/runs/{run.id}/pay"), db, tenant)  # type: ignore[arg-type]
        if paid.status != "paid":
            raise AssertionError("payroll payment failed")
        ledger = db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.organization_id == tenant.organization_id,
            FinancialTransaction.source_type == "payroll_run", FinancialTransaction.source_id == run.id,
        ))
        if ledger is None or ledger.direction != "debit" or ledger.amount != Decimal("50000.00"):
            raise AssertionError("payroll ledger debit missing or incorrect")
        payment_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "payroll_payment",
            JournalEntry.source_id == run.id,
            JournalEntry.status == "posted",
        ))
        if payment_journal is None:
            raise AssertionError("payroll payment journal is missing")
        payment_lines = db.execute(
            select(JournalLine, LedgerAccount.system_key)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(JournalLine.organization_id == tenant.organization_id, JournalLine.journal_entry_id == payment_journal.id)
        ).all()
        payment_by_key = {key: line for line, key in payment_lines}
        if Decimal(payment_by_key["payroll_payable"].debit) != Decimal("50000.00"):
            raise AssertionError("payroll payment did not clear net payroll payable")
        persisted = db.scalar(select(PayrollRun).where(PayrollRun.id == run.id))
        if persisted is None or persisted.paid_account_id != account_id:
            raise AssertionError("payroll paid account was not persisted")

        withholding_payment = pay_payroll_withholding(
            PayrollWithholdingPaymentCreate(
                account_id=account_id,
                payment_date=date(2098, 2, 1),
                amount=Decimal("5000"),
                reference=f"CI-PAYROLL-WH-{uuid4().hex[:8]}",
            ),
            request("POST", "/api/v1/payroll/withholdings/payments"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        withholding_journal = db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id == tenant.organization_id,
            JournalEntry.source_type == "payroll_withholding_payment",
            JournalEntry.source_id == withholding_payment.id,
            JournalEntry.status == "posted",
        ))
        if withholding_journal is None:
            raise AssertionError("payroll withholding payment journal is missing")
        withholding_line = db.scalar(
            select(JournalLine)
            .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
            .where(
                JournalLine.organization_id == tenant.organization_id,
                JournalLine.journal_entry_id == withholding_journal.id,
                LedgerAccount.system_key == "payroll_withholdings",
            )
        )
        if withholding_line is None or Decimal(withholding_line.debit) != Decimal("5000.00"):
            raise AssertionError("payroll withholding liability was not cleared")

        report = reports_overview(
            db=db,
            tenant=tenant,  # type: ignore[arg-type]
            date_from=date(2098, 1, 1),
            date_to=date(2098, 1, 31),
            currency="BDT",
            client_id=None,
            project_id=None,
        )
        bdt = next((row for row in report.financials if row.currency == "BDT"), None)
        if bdt is None or bdt.expenses < Decimal("55000.00"):
            raise AssertionError("approved/paid payroll cost is missing from Reports expenses")

        reverse_business_transaction(
            CorrectionRequest(
                source_type="payroll_withholding_payment",
                source_id=withholding_payment.id,
                reason="CI reverse withholding remittance",
                reversal_date=date(2098,2,2),
            ),
            request("POST","/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        reverse_business_transaction(
            CorrectionRequest(
                source_type="payroll_run",
                source_id=run.id,
                reason="CI reverse payroll",
                reversal_date=date(2098,2,3),
            ),
            request("POST","/accounting/corrections/reverse"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        db.expire_all()
        reversed_run=db.scalar(select(PayrollRun).where(PayrollRun.id==run.id))
        payroll_cash_reversal=db.scalar(select(FinancialTransaction).where(
            FinancialTransaction.organization_id==tenant.organization_id,
            FinancialTransaction.source_type=="payroll_run_reversal",
            FinancialTransaction.source_id==run.id,
        ))
        payment_reversal=db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id==tenant.organization_id,
            JournalEntry.reversed_entry_id==payment_journal.id,
        ))
        accrual_reversal=db.scalar(select(JournalEntry).where(
            JournalEntry.organization_id==tenant.organization_id,
            JournalEntry.reversed_entry_id==accrual.id,
        ))
        if reversed_run is None or reversed_run.status!="reversed" or payroll_cash_reversal is None or payment_reversal is None or accrual_reversal is None:
            raise AssertionError("payroll controlled reversal did not restore journals/cash/status")
        replacement=create_run(
            PayrollRunCreate(period_id=period.id,currency="BDT"),
            request("POST","/api/v1/payroll/runs"),
            db,
            tenant,  # type: ignore[arg-type]
        )
        if replacement.id==run.id or replacement.status!="draft":
            raise AssertionError("reversed payroll did not allow a replacement run")
    finally:
        db.close()

    print("payroll verification passed: accrual -> pay -> withholdings -> reports -> controlled reversal -> replacement")


if __name__ == "__main__":
    main()
