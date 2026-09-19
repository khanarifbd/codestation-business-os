from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import case, func, or_, select

from app.models.accounting import (
    JournalEntry,
    JournalLine,
    LedgerAccount,
    OrganizationFunctionalCurrencyPeriod,
)
from app.models.capital import CompanyLoan, LoanRepayment, OwnerEquityTransaction
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, Payment
from app.models.fixed_assets import AssetDepreciationEntry, FixedAsset
from app.models.loan_accounting import LoanDisbursement
from app.models.organization import Organization
from app.models.payables import PayableBill, PayablePayment
from app.models.payroll import PayrollRun, PayrollWithholdingPayment
from app.models.tax import TaxSettlement

MONEY = Decimal("0.01")


def money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class AccountingIntegrityIssue:
    code: str
    message: str


@dataclass
class AccountingIntegrityReport:
    organization_id: str
    organization_name: str
    issues: list[AccountingIntegrityIssue] = field(default_factory=list)
    stats: dict[str, int | str] = field(default_factory=dict)

    @property
    def ok(self) -> bool:
        return not self.issues

    def add(self, code: str, message: str) -> None:
        self.issues.append(AccountingIntegrityIssue(code=code, message=message))


def audit_organization_accounting(db, organization_id: str) -> AccountingIntegrityReport:
    """Audit accounting integrity without changing any tenant data.

    The audit deliberately avoids accounting sync helpers and mapped-ledger
    creation helpers. It only reads persisted operational and GL state so it is
    safe to run against staging or production data.
    """

    organization = db.scalar(select(Organization).where(Organization.id == organization_id))
    if organization is None:
        raise ValueError(f"Organization not found: {organization_id}")

    report = AccountingIntegrityReport(
        organization_id=organization.id,
        organization_name=organization.name,
    )

    # 1) Every posted journal must be a real, balanced double-entry posting.
    journal_rows = db.execute(
        select(
            JournalEntry.id,
            JournalEntry.entry_number,
            JournalEntry.source_type,
            JournalEntry.source_id,
            func.count(JournalLine.id),
            func.coalesce(func.sum(JournalLine.debit), 0),
            func.coalesce(func.sum(JournalLine.credit), 0),
        )
        .outerjoin(JournalLine, JournalLine.journal_entry_id == JournalEntry.id)
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
        )
        .group_by(
            JournalEntry.id,
            JournalEntry.entry_number,
            JournalEntry.source_type,
            JournalEntry.source_id,
        )
    ).all()
    report.stats["posted_journals"] = len(journal_rows)
    for journal_id, number, source_type, source_id, line_count, debit, credit in journal_rows:
        debit_value = money(Decimal(debit or 0))
        credit_value = money(Decimal(credit or 0))
        if int(line_count or 0) < 2:
            report.add("journal_too_few_lines", f"{number} ({journal_id}) has fewer than two journal lines")
        if debit_value <= 0 or debit_value != credit_value:
            report.add(
                "journal_unbalanced",
                f"{number} ({source_type}/{source_id or 'n/a'}) debit={debit_value} credit={credit_value}",
            )

    # A line may never bridge tenant boundaries through its journal or ledger account.
    cross_tenant_lines = db.execute(
        select(
            JournalLine.id,
            JournalLine.organization_id,
            JournalEntry.organization_id,
            LedgerAccount.organization_id,
        )
        .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
        .join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id)
        .where(
            or_(
                JournalLine.organization_id == organization_id,
                JournalEntry.organization_id == organization_id,
                LedgerAccount.organization_id == organization_id,
            )
        )
    ).all()
    for line_id, line_org, entry_org, ledger_org in cross_tenant_lines:
        if line_org != entry_org or line_org != ledger_org:
            report.add(
                "journal_tenant_mismatch",
                f"Journal line {line_id} crosses organizations: line={line_org}, entry={entry_org}, ledger={ledger_org}",
            )

    duplicate_sources = db.execute(
        select(
            JournalEntry.source_type,
            JournalEntry.source_id,
            func.count(JournalEntry.id),
        )
        .where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.status == "posted",
            JournalEntry.source_id.is_not(None),
        )
        .group_by(JournalEntry.source_type, JournalEntry.source_id)
        .having(func.count(JournalEntry.id) > 1)
    ).all()
    for source_type, source_id, count in duplicate_sources:
        report.add(
            "duplicate_source_journal",
            f"{source_type}/{source_id} has {count} posted source journals",
        )

    source_journals = set(
        db.execute(
            select(JournalEntry.source_type, JournalEntry.source_id).where(
                JournalEntry.organization_id == organization_id,
                JournalEntry.status == "posted",
                JournalEntry.source_id.is_not(None),
            )
        ).all()
    )

    # 2) Operational document/subledger state must have its source journal.
    invoices = db.execute(
        select(
            Invoice.id,
            Invoice.invoice_number,
            Invoice.status,
            Invoice.total,
            Invoice.amount_paid,
            Invoice.balance_due,
        ).where(Invoice.organization_id == organization_id)
    ).all()
    report.stats["invoices"] = len(invoices)
    for invoice_id, number, status, total, amount_paid, balance_due in invoices:
        if money(total) != money(amount_paid) + money(balance_due):
            report.add(
                "invoice_balance_mismatch",
                f"Invoice {number} total={money(total)} paid={money(amount_paid)} due={money(balance_due)}",
            )
        if money(amount_paid) < 0 or money(balance_due) < 0:
            report.add("invoice_negative_balance", f"Invoice {number} has a negative paid/due amount")
        if status not in {"draft", "cancelled"} and ("invoice_issue", invoice_id) not in source_journals:
            report.add("invoice_missing_journal", f"Invoice {number} ({status}) has no posted invoice_issue journal")
        if status == "paid" and money(balance_due) != Decimal("0.00"):
            report.add("invoice_paid_with_balance", f"Invoice {number} is paid but balance_due={money(balance_due)}")

    confirmed_payments = db.scalars(
        select(Payment.id).where(
            Payment.organization_id == organization_id,
            Payment.status == "confirmed",
        )
    ).all()
    report.stats["confirmed_invoice_payments"] = len(confirmed_payments)
    for payment_id in confirmed_payments:
        if ("invoice_payment", payment_id) not in source_journals:
            report.add("payment_missing_journal", f"Confirmed invoice payment {payment_id} has no posted invoice_payment journal")

    bills = db.execute(
        select(
            PayableBill.id,
            PayableBill.bill_number,
            PayableBill.status,
            PayableBill.net_payable_amount,
            PayableBill.amount_paid,
            PayableBill.balance_due,
        ).where(PayableBill.organization_id == organization_id)
    ).all()
    report.stats["payable_bills"] = len(bills)
    for bill_id, number, status, net_payable, amount_paid, balance_due in bills:
        if money(net_payable) != money(amount_paid) + money(balance_due):
            report.add(
                "payable_balance_mismatch",
                f"Bill {number} payable={money(net_payable)} paid={money(amount_paid)} due={money(balance_due)}",
            )
        if money(amount_paid) < 0 or money(balance_due) < 0:
            report.add("payable_negative_balance", f"Bill {number} has a negative paid/due amount")
        if ("payable_bill", bill_id) not in source_journals:
            report.add("payable_missing_journal", f"Bill {number} ({status}) has no posted payable_bill journal")
        if status == "paid" and money(balance_due) != Decimal("0.00"):
            report.add("payable_paid_with_balance", f"Bill {number} is paid but balance_due={money(balance_due)}")

    payable_payments = db.scalars(
        select(PayablePayment.id).where(PayablePayment.organization_id == organization_id)
    ).all()
    report.stats["payable_payments"] = len(payable_payments)
    for payment_id in payable_payments:
        if ("payable_payment", payment_id) not in source_journals:
            report.add("payable_payment_missing_journal", f"Payable payment {payment_id} has no posted payable_payment journal")

    disbursements = db.execute(
        select(
            LoanDisbursement.id,
            LoanDisbursement.loan_id,
            LoanDisbursement.principal_amount,
        ).where(LoanDisbursement.organization_id == organization_id)
    ).all()
    report.stats["loan_disbursements"] = len(disbursements)
    disbursed_by_loan: dict[str, Decimal] = {}
    for disbursement_id, loan_id, principal in disbursements:
        principal_value = Decimal(principal)
        disbursed_by_loan[loan_id] = money(disbursed_by_loan.get(loan_id, Decimal("0")) + principal_value)
        # Controlled disbursement reversal rows are negative subledger trackers.
        # The accounting reversal journal points to the original positive source,
        # so the negative tracker intentionally has no loan_disbursement journal.
        if principal_value < 0:
            continue
        if ("loan_disbursement", disbursement_id) not in source_journals:
            report.add(
                "loan_disbursement_missing_journal",
                f"Loan disbursement {disbursement_id} has no posted loan_disbursement journal",
            )

    reversed_repayment_ids = set(
        db.scalars(
            select(FinancialTransaction.source_id).where(
                FinancialTransaction.organization_id == organization_id,
                FinancialTransaction.source_type.like("loan_repayment_reversal%"),
            )
        ).all()
    )

    repayment_rows = db.execute(
        select(LoanRepayment.id, LoanRepayment.loan_id, LoanRepayment.principal_amount).where(
            LoanRepayment.organization_id == organization_id
        )
    ).all()
    repaid_by_loan: dict[str, Decimal] = {}
    accounting_repayment_count = 0
    for repayment_id, loan_id, principal in repayment_rows:
        if loan_id not in disbursed_by_loan:
            # Legacy CompanyLoan repayments predate the accounting-loan lifecycle.
            continue
        if ("loan_repayment_accounting", repayment_id) not in source_journals:
            report.add(
                "loan_repayment_missing_journal",
                f"Accounting loan repayment {repayment_id} has no posted loan_repayment_accounting journal",
            )
        if repayment_id in reversed_repayment_ids:
            continue
        accounting_repayment_count += 1
        repaid_by_loan[loan_id] = money(repaid_by_loan.get(loan_id, Decimal("0")) + Decimal(principal))
    report.stats["accounting_loan_repayments"] = accounting_repayment_count

    if disbursed_by_loan:
        loans = db.execute(
            select(
                CompanyLoan.id,
                CompanyLoan.lender_name,
                CompanyLoan.principal_amount,
                CompanyLoan.outstanding_principal,
                CompanyLoan.status,
            ).where(
                CompanyLoan.organization_id == organization_id,
                CompanyLoan.id.in_(list(disbursed_by_loan)),
            )
        ).all()
        for loan_id, lender, approved, outstanding, status in loans:
            disbursed = money(disbursed_by_loan.get(loan_id, Decimal("0")))
            repaid = money(repaid_by_loan.get(loan_id, Decimal("0")))
            expected_outstanding = money(disbursed - repaid)
            if disbursed > money(approved):
                report.add(
                    "loan_over_disbursed",
                    f"Loan {lender} disbursed={disbursed} exceeds approved={money(approved)}",
                )
            if expected_outstanding != money(outstanding):
                report.add(
                    "loan_principal_mismatch",
                    f"Loan {lender} expected outstanding={expected_outstanding}, stored={money(outstanding)}",
                )
            if money(outstanding) < 0:
                report.add("loan_negative_principal", f"Loan {lender} has negative outstanding principal")
            if status in {"paid", "closed"} and money(outstanding) != Decimal("0.00"):
                report.add(
                    "loan_closed_with_principal",
                    f"Loan {lender} status={status} but outstanding={money(outstanding)}",
                )

    # Fixed assets: acquisition + depreciation subledger must reconcile to GL-backed state.
    assets = db.execute(
        select(
            FixedAsset.id,
            FixedAsset.asset_code,
            FixedAsset.acquisition_cost,
            FixedAsset.salvage_value,
            FixedAsset.accumulated_depreciation,
            FixedAsset.opening_accumulated_depreciation,
        ).where(FixedAsset.organization_id == organization_id)
    ).all()
    report.stats["fixed_assets"] = len(assets)
    depreciation_by_asset = {
        asset_id: money(Decimal(total or 0))
        for asset_id, total in db.execute(
            select(
                AssetDepreciationEntry.asset_id,
                func.coalesce(func.sum(AssetDepreciationEntry.amount), 0),
            )
            .where(
                AssetDepreciationEntry.organization_id == organization_id,
                AssetDepreciationEntry.status == "posted",
            )
            .group_by(AssetDepreciationEntry.asset_id)
        ).all()
    }
    for asset_id, asset_code, cost, salvage, accumulated, opening_accumulated in assets:
        if ("fixed_asset_acquisition", asset_id) not in source_journals:
            report.add("fixed_asset_missing_journal", f"Fixed asset {asset_code} has no acquisition/opening journal")
        expected_accumulated = money(Decimal(opening_accumulated or 0) + depreciation_by_asset.get(asset_id, Decimal("0")))
        if money(accumulated) != expected_accumulated:
            report.add(
                "fixed_asset_depreciation_mismatch",
                f"Fixed asset {asset_code} accumulated depreciation={money(accumulated)} expected={expected_accumulated}",
            )
        maximum = money(Decimal(cost) - Decimal(salvage))
        if money(accumulated) < Decimal("0.00") or money(accumulated) > maximum:
            report.add(
                "fixed_asset_depreciation_out_of_range",
                f"Fixed asset {asset_code} accumulated depreciation={money(accumulated)} depreciable={maximum}",
            )

    depreciation_entries = db.scalars(
        select(AssetDepreciationEntry.id).where(
            AssetDepreciationEntry.organization_id == organization_id,
            AssetDepreciationEntry.status == "posted",
        )
    ).all()
    report.stats["asset_depreciation_entries"] = len(depreciation_entries)
    for entry_id in depreciation_entries:
        if ("asset_depreciation", entry_id) not in source_journals:
            report.add("asset_depreciation_missing_journal", f"Asset depreciation {entry_id} has no posted journal")

    # Payroll: approved runs accrue liabilities; paid runs clear net payroll payable.
    payroll_runs = db.execute(
        select(
            PayrollRun.id,
            PayrollRun.run_number,
            PayrollRun.status,
            PayrollRun.gross_total,
            PayrollRun.deduction_total,
            PayrollRun.tax_total,
            PayrollRun.net_total,
            PayrollRun.paid_account_id,
        ).where(PayrollRun.organization_id == organization_id)
    ).all()
    report.stats["payroll_runs"] = len(payroll_runs)
    for run_id, run_number, status, gross, deductions, tax, net, paid_account_id in payroll_runs:
        if money(gross) != money(Decimal(net) + Decimal(deductions) + Decimal(tax)):
            report.add(
                "payroll_total_mismatch",
                f"Payroll {run_number} gross={money(gross)} net={money(net)} deductions={money(deductions)} tax={money(tax)}",
            )
        has_accrual = ("payroll_accrual", run_id) in source_journals
        has_payment = ("payroll_payment", run_id) in source_journals
        if status == "approved" and not has_accrual:
            report.add("payroll_accrual_missing_journal", f"Approved payroll {run_number} has no accrual journal")
        if status == "paid":
            if not has_payment:
                report.add("payroll_payment_missing_journal", f"Paid payroll {run_number} has no payment journal")
            if paid_account_id is None:
                report.add("payroll_paid_account_missing", f"Paid payroll {run_number} has no paid financial account")
            # Legacy paid payrolls may have a single payroll_payment journal that
            # directly recognized expense. New runs always have a separate accrual.
            if not has_accrual and has_payment:
                report.stats["legacy_paid_payroll_journals"] = int(report.stats.get("legacy_paid_payroll_journals", 0)) + 1

    withholding_payments = db.scalars(
        select(PayrollWithholdingPayment.id).where(PayrollWithholdingPayment.organization_id == organization_id)
    ).all()
    report.stats["payroll_withholding_payments"] = len(withholding_payments)
    for payment_id in withholding_payments:
        if ("payroll_withholding_payment", payment_id) not in source_journals:
            report.add(
                "payroll_withholding_payment_missing_journal",
                f"Payroll withholding payment {payment_id} has no posted journal",
            )

    # Tax settlements and owner equity are canonical financial movements and must
    # always retain their source journals.
    tax_settlements = db.scalars(
        select(TaxSettlement.id).where(TaxSettlement.organization_id == organization_id)
    ).all()
    report.stats["tax_settlements"] = len(tax_settlements)
    for settlement_id in tax_settlements:
        if ("tax_settlement", settlement_id) not in source_journals:
            report.add("tax_settlement_missing_journal", f"Tax settlement {settlement_id} has no posted journal")

    owner_equity_rows = db.scalars(
        select(OwnerEquityTransaction.id).where(OwnerEquityTransaction.organization_id == organization_id)
    ).all()
    report.stats["owner_equity_transactions"] = len(owner_equity_rows)
    for transaction_id in owner_equity_rows:
        if ("owner_equity", transaction_id) not in source_journals:
            report.add("owner_equity_missing_journal", f"Owner equity transaction {transaction_id} has no posted journal")

    # 3) Financial-account transaction currency and mapped GL protection.
    transaction_rows = db.execute(
        select(
            FinancialTransaction.id,
            FinancialTransaction.account_id,
            FinancialTransaction.currency,
            FinancialAccount.currency,
            FinancialAccount.organization_id,
        )
        .join(FinancialAccount, FinancialAccount.id == FinancialTransaction.account_id)
        .where(FinancialTransaction.organization_id == organization_id)
    ).all()
    report.stats["financial_transactions"] = len(transaction_rows)
    for transaction_id, account_id, tx_currency, account_currency, account_org in transaction_rows:
        if account_org != organization_id:
            report.add(
                "financial_transaction_tenant_mismatch",
                f"Transaction {transaction_id} points to account {account_id} in organization {account_org}",
            )
        if tx_currency.upper() != account_currency.upper():
            report.add(
                "financial_transaction_currency_mismatch",
                f"Transaction {transaction_id} currency={tx_currency} account currency={account_currency}",
            )

    tx_net_rows = db.execute(
        select(
            FinancialTransaction.account_id,
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            ),
            func.count(FinancialTransaction.id),
        )
        .where(FinancialTransaction.organization_id == organization_id)
        .group_by(FinancialTransaction.account_id)
    ).all()
    transaction_net = {account_id: Decimal(net or 0) for account_id, net, _ in tx_net_rows}
    transaction_count = {account_id: int(count or 0) for account_id, _, count in tx_net_rows}

    accounts = db.scalars(
        select(FinancialAccount).where(FinancialAccount.organization_id == organization_id)
    ).all()
    report.stats["financial_accounts"] = len(accounts)
    mappings = db.scalars(
        select(LedgerAccount).where(
            LedgerAccount.organization_id == organization_id,
            LedgerAccount.system_key.like("financial_account:%"),
        )
    ).all()
    mapping_by_key = {item.system_key: item for item in mappings if item.system_key}

    account_mapping: dict[str, LedgerAccount] = {}
    for account in accounts:
        required = account.is_active or money(account.opening_balance) != Decimal("0.00") or transaction_count.get(account.id, 0) > 0
        mapping = mapping_by_key.get(f"financial_account:{account.id}")
        if mapping is None:
            if required:
                report.add("financial_account_missing_gl", f"Account {account.name} ({account.id}) has no mapped GL account")
            continue
        account_mapping[account.id] = mapping
        expected_category = "liability" if account.account_type == "credit_card" else "asset"
        expected_normal = "credit" if account.account_type == "credit_card" else "debit"
        if mapping.category != expected_category or mapping.normal_balance != expected_normal:
            report.add(
                "financial_account_gl_classification",
                f"Account {account.name} maps to {mapping.category}/{mapping.normal_balance}; expected {expected_category}/{expected_normal}",
            )
        if mapping.allow_manual_posting:
            report.add("financial_account_gl_manual_posting", f"Mapped GL {mapping.name} allows manual posting")
        if account.is_active and not mapping.is_active:
            report.add("financial_account_gl_inactive", f"Active account {account.name} maps to an inactive GL account")

    # A functional-currency transition creates opening GL lines in the new
    # functional currency. Local-currency account-to-GL original-amount
    # comparison is therefore only exact while the organization has one
    # functional-currency period. Other checks remain valid after transitions.
    functional_period_count = int(
        db.scalar(
            select(func.count(OrganizationFunctionalCurrencyPeriod.id)).where(
                OrganizationFunctionalCurrencyPeriod.organization_id == organization_id
            )
        )
        or 0
    )
    report.stats["functional_currency_periods"] = functional_period_count

    if functional_period_count <= 1 and account_mapping:
        ledger_ids = [mapping.id for mapping in account_mapping.values()]
        gl_rows = db.execute(
            select(
                JournalLine.ledger_account_id,
                func.coalesce(
                    func.sum(case((JournalLine.debit > 0, JournalLine.original_amount), else_=0)),
                    0,
                ),
                func.coalesce(
                    func.sum(case((JournalLine.credit > 0, JournalLine.original_amount), else_=0)),
                    0,
                ),
            )
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == organization_id,
                JournalEntry.organization_id == organization_id,
                JournalEntry.status == "posted",
                JournalLine.ledger_account_id.in_(ledger_ids),
            )
            .group_by(JournalLine.ledger_account_id)
        ).all()
        gl_original = {
            ledger_id: (Decimal(debit or 0), Decimal(credit or 0))
            for ledger_id, debit, credit in gl_rows
        }

        currency_rows = db.execute(
            select(JournalLine.ledger_account_id, JournalLine.currency, func.count(JournalLine.id))
            .join(JournalEntry, JournalEntry.id == JournalLine.journal_entry_id)
            .where(
                JournalLine.organization_id == organization_id,
                JournalEntry.organization_id == organization_id,
                JournalEntry.status == "posted",
                JournalLine.ledger_account_id.in_(ledger_ids),
            )
            .group_by(JournalLine.ledger_account_id, JournalLine.currency)
        ).all()
        currencies_by_ledger: dict[str, set[str]] = {}
        for ledger_id, currency, _ in currency_rows:
            currencies_by_ledger.setdefault(ledger_id, set()).add(currency.upper())

        for account in accounts:
            mapping = account_mapping.get(account.id)
            if mapping is None:
                continue
            unexpected_currencies = currencies_by_ledger.get(mapping.id, set()) - {account.currency.upper()}
            if unexpected_currencies:
                report.add(
                    "financial_account_gl_currency_mismatch",
                    f"Account {account.name} ({account.currency}) has mapped GL lines in {sorted(unexpected_currencies)}",
                )
                continue
            operational = money(Decimal(account.opening_balance) + transaction_net.get(account.id, Decimal("0")))
            debit_original, credit_original = gl_original.get(mapping.id, (Decimal("0"), Decimal("0")))
            if account.account_type == "credit_card":
                ledger_local = money(credit_original - debit_original)
            else:
                ledger_local = money(debit_original - credit_original)
            if operational != ledger_local:
                report.add(
                    "financial_account_gl_balance_mismatch",
                    f"Account {account.name} operational={operational} {account.currency}, mapped GL={ledger_local} {account.currency}",
                )
        report.stats["financial_account_gl_balance_check"] = "performed"
    else:
        report.stats["financial_account_gl_balance_check"] = "skipped_after_functional_currency_transition"

    report.stats["issues"] = len(report.issues)
    return report
