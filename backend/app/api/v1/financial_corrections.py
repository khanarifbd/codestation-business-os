from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Annotated, Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import and_, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.accounting_money import AccountingMoneyEntry
from app.models.capital import CompanyLoan, LoanRepayment, OwnerEquityTransaction
from app.models.customer_advances import CustomerAdvance, CustomerAdvanceApplication
from app.models.expenses import Expense
from app.models.finance import AccountTransfer, FinancialTransaction, Invoice, Payment
from app.models.fixed_assets import AssetDepreciationEntry, FixedAsset
from app.models.loan_accounting import LoanDisbursement, LoanFee
from app.models.payables import PayableBill, PayablePayment
from app.models.payroll import PayrollPeriod, PayrollRun, PayrollWithholdingPayment
from app.models.tax import TaxSettlement
from app.services.activity_log import record_activity
from app.services.journal_reversal import reverse_source_journal
from app.services.loan_schedule import refresh_loan_schedule_payment_state
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/corrections", tags=["Accounting - Corrections"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
AccountingManager = Annotated[TenantContext, Depends(require_tenant_permission("finance.manage"))]
CorrectionType = Literal[
    "payment",
    "expense",
    "transfer",
    "money_entry",
    "customer_advance",
    "customer_advance_application",
    "payable_payment",
    "loan_disbursement",
    "loan_repayment",
    "fixed_asset",
    "asset_depreciation",
    "tax_settlement",
    "payroll_withholding_payment",
    "payroll_run",
    "owner_equity",
]


class CorrectionRequest(BaseModel):
    source_type: CorrectionType
    source_id: str
    reason: str = Field(min_length=3, max_length=500)
    reversal_date: date | None = None


def _today(timezone_name: str) -> date:
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _opposite(direction: str) -> str:
    if direction == "credit":
        return "debit"
    if direction == "debit":
        return "credit"
    raise HTTPException(status_code=409, detail=f"Unsupported financial transaction direction: {direction}")


def _already_reversed(db: DbSession, organization_id: str, source_id: str, reversal_prefix: str) -> bool:
    return db.scalar(
        select(FinancialTransaction.id).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.source_id == source_id,
            FinancialTransaction.source_type.like(f"{reversal_prefix}%"),
        )
    ) is not None


def _journal_reversed(
    db: DbSession,
    organization_id: str,
    source_type: str,
    source_id: str,
) -> bool:
    original_id = db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
        )
    )
    if original_id is None:
        return False
    return db.scalar(
        select(JournalEntry.id).where(
            JournalEntry.organization_id == organization_id,
            JournalEntry.reversed_entry_id == original_id,
        )
    ) is not None


def _mirror_transactions(
    db: DbSession,
    *,
    tenant: TenantContext,
    source_types: list[str],
    source_id: str,
    reversal_source_type: str,
    reversal_date: date,
    reason: str,
) -> int:
    originals = db.scalars(
        select(FinancialTransaction).where(
            FinancialTransaction.organization_id == tenant.organization_id,
            FinancialTransaction.source_id == source_id,
            FinancialTransaction.source_type.in_(source_types),
        )
    ).all()
    if not originals:
        return 0

    count = 0
    for index, original in enumerate(originals):
        suffix = "" if len(originals) == 1 else f"_{index + 1}"
        mapped_type = f"{reversal_source_type}{suffix}"
        if len(mapped_type) > 40:
            mapped_type = mapped_type[:40]
        existing = db.scalar(
            select(FinancialTransaction.id).where(
                FinancialTransaction.organization_id == tenant.organization_id,
                FinancialTransaction.account_id == original.account_id,
                FinancialTransaction.source_type == mapped_type,
                FinancialTransaction.source_id == source_id,
                FinancialTransaction.direction == _opposite(original.direction),
            )
        )
        if existing:
            raise HTTPException(status_code=409, detail="This financial movement was already reversed")
        db.add(
            FinancialTransaction(
                organization_id=tenant.organization_id,
                account_id=original.account_id,
                transaction_date=reversal_date,
                direction=_opposite(original.direction),
                amount=original.amount,
                currency=original.currency,
                source_type=mapped_type,
                source_id=source_id,
                reference=original.reference,
                description=f"Correction reversal: {reason.strip()}",
                created_by_user_id=tenant.user_id,
            )
        )
        count += 1
    db.flush()
    return count


def _source_cash_amount(db: DbSession, organization_id: str, source_type: str, source_id: str) -> Decimal:
    transaction = db.scalar(
        select(FinancialTransaction).where(
            FinancialTransaction.organization_id == organization_id,
            FinancialTransaction.source_type == source_type,
            FinancialTransaction.source_id == source_id,
        )
    )
    return Decimal(transaction.amount) if transaction is not None else Decimal("0")


def _source_ledger_amount(
    db: DbSession,
    organization_id: str,
    *,
    source_type: str,
    source_id: str,
    system_key: str,
    side: Literal["debit", "credit"],
) -> Decimal:
    value = db.scalar(
        select(func.coalesce(func.sum(getattr(JournalLine, side)), 0))
        .join(
            JournalEntry,
            (JournalEntry.id == JournalLine.journal_entry_id)
            & (JournalEntry.organization_id == JournalLine.organization_id),
        )
        .join(
            LedgerAccount,
            (LedgerAccount.id == JournalLine.ledger_account_id)
            & (LedgerAccount.organization_id == JournalLine.organization_id),
        )
        .where(
            JournalLine.organization_id == organization_id,
            JournalEntry.source_type == source_type,
            JournalEntry.source_id == source_id,
            JournalEntry.status == "posted",
            LedgerAccount.system_key == system_key,
        )
    ) or Decimal("0")
    return Decimal(value)


def _active_payroll_withholding_payments_on_or_after(
    db: DbSession,
    organization_id: str,
    period_end: date,
) -> list[PayrollWithholdingPayment]:
    rows = db.scalars(
        select(PayrollWithholdingPayment).where(
            PayrollWithholdingPayment.organization_id == organization_id,
            PayrollWithholdingPayment.payment_date >= period_end,
        )
    ).all()
    return [
        item
        for item in rows
        if not _journal_reversed(
            db,
            organization_id,
            "payroll_withholding_payment",
            item.id,
        )
    ]


@router.get("/candidates")
def correction_candidates(db: DbSession, tenant: AccountingViewer, limit: int = 100):
    row_limit = min(max(limit, 1), 200)
    payments = db.execute(
        select(Payment, Invoice.invoice_number, Invoice.client_name_snapshot)
        .join(Invoice, Invoice.id == Payment.invoice_id)
        .where(Payment.organization_id == tenant.organization_id, Payment.status == "confirmed")
        .order_by(Payment.payment_date.desc(), Payment.created_at.desc())
        .limit(row_limit)
    ).all()
    expenses = db.scalars(
        select(Expense)
        .where(Expense.organization_id == tenant.organization_id, Expense.status == "posted")
        .order_by(Expense.expense_date.desc(), Expense.created_at.desc())
        .limit(row_limit)
    ).all()
    transfers = db.scalars(
        select(AccountTransfer)
        .where(AccountTransfer.organization_id == tenant.organization_id, AccountTransfer.status == "confirmed")
        .order_by(AccountTransfer.transfer_date.desc(), AccountTransfer.created_at.desc())
        .limit(row_limit)
    ).all()
    money_entries = db.scalars(
        select(AccountingMoneyEntry)
        .where(AccountingMoneyEntry.organization_id == tenant.organization_id)
        .order_by(AccountingMoneyEntry.entry_date.desc(), AccountingMoneyEntry.created_at.desc())
        .limit(row_limit)
    ).all()
    customer_advances = db.scalars(
        select(CustomerAdvance)
        .where(CustomerAdvance.organization_id == tenant.organization_id)
        .order_by(CustomerAdvance.advance_date.desc(), CustomerAdvance.created_at.desc())
        .limit(row_limit)
    ).all()
    advance_applications = db.execute(
        select(CustomerAdvanceApplication, Invoice.invoice_number)
        .join(
            Invoice,
            (Invoice.id == CustomerAdvanceApplication.invoice_id)
            & (Invoice.organization_id == tenant.organization_id),
        )
        .where(CustomerAdvanceApplication.organization_id == tenant.organization_id)
        .order_by(CustomerAdvanceApplication.application_date.desc(), CustomerAdvanceApplication.created_at.desc())
        .limit(row_limit)
    ).all()
    payable_payments = db.execute(
        select(PayablePayment, PayableBill.bill_number, PayableBill.supplier_name)
        .join(PayableBill, PayableBill.id == PayablePayment.bill_id)
        .where(PayablePayment.organization_id == tenant.organization_id)
        .order_by(PayablePayment.payment_date.desc(), PayablePayment.created_at.desc())
        .limit(row_limit)
    ).all()
    loan_disbursements = db.execute(
        select(LoanDisbursement, CompanyLoan.lender_name, CompanyLoan.currency)
        .join(CompanyLoan, CompanyLoan.id == LoanDisbursement.loan_id)
        .where(
            LoanDisbursement.organization_id == tenant.organization_id,
            LoanDisbursement.principal_amount > 0,
        )
        .order_by(LoanDisbursement.disbursement_date.desc(), LoanDisbursement.created_at.desc())
        .limit(row_limit)
    ).all()
    fixed_assets = db.scalars(
        select(FixedAsset)
        .where(
            FixedAsset.organization_id == tenant.organization_id,
            FixedAsset.status != "reversed",
        )
        .order_by(FixedAsset.acquisition_date.desc(), FixedAsset.created_at.desc())
        .limit(row_limit)
    ).all()
    depreciation_rows = db.execute(
        select(AssetDepreciationEntry, FixedAsset.asset_code, FixedAsset.name, FixedAsset.currency)
        .join(
            FixedAsset,
            (FixedAsset.id == AssetDepreciationEntry.asset_id)
            & (FixedAsset.organization_id == tenant.organization_id),
        )
        .where(
            AssetDepreciationEntry.organization_id == tenant.organization_id,
            AssetDepreciationEntry.status == "posted",
        )
        .order_by(AssetDepreciationEntry.period_date.desc(), AssetDepreciationEntry.created_at.desc())
        .limit(row_limit)
    ).all()
    tax_settlements = db.scalars(
        select(TaxSettlement)
        .where(TaxSettlement.organization_id == tenant.organization_id)
        .order_by(TaxSettlement.settlement_date.desc(), TaxSettlement.created_at.desc())
        .limit(row_limit)
    ).all()
    payroll_withholding_payments = db.scalars(
        select(PayrollWithholdingPayment)
        .where(PayrollWithholdingPayment.organization_id == tenant.organization_id)
        .order_by(PayrollWithholdingPayment.payment_date.desc(), PayrollWithholdingPayment.created_at.desc())
        .limit(row_limit)
    ).all()
    payroll_runs = db.execute(
        select(PayrollRun, PayrollPeriod)
        .join(
            PayrollPeriod,
            (PayrollPeriod.id == PayrollRun.period_id)
            & (PayrollPeriod.organization_id == tenant.organization_id),
        )
        .where(
            PayrollRun.organization_id == tenant.organization_id,
            PayrollRun.status.in_(["approved", "paid"]),
        )
        .order_by(PayrollPeriod.period_end.desc(), PayrollRun.created_at.desc())
        .limit(row_limit)
    ).all()
    owner_equity_rows = db.scalars(
        select(OwnerEquityTransaction)
        .where(OwnerEquityTransaction.organization_id == tenant.organization_id)
        .order_by(OwnerEquityTransaction.transaction_date.desc(), OwnerEquityTransaction.created_at.desc())
        .limit(row_limit)
    ).all()

    repayment_cash = FinancialTransaction.__table__.alias("repayment_cash")
    loan_repayments = db.execute(
        select(LoanRepayment, CompanyLoan.lender_name, CompanyLoan.currency, repayment_cash.c.amount)
        .join(CompanyLoan, CompanyLoan.id == LoanRepayment.loan_id)
        .join(
            repayment_cash,
            and_(
                repayment_cash.c.organization_id == tenant.organization_id,
                repayment_cash.c.source_type == "loan_repayment_accounting",
                repayment_cash.c.source_id == LoanRepayment.id,
            ),
        )
        .where(LoanRepayment.organization_id == tenant.organization_id)
        .order_by(LoanRepayment.payment_date.desc(), LoanRepayment.created_at.desc())
        .limit(row_limit)
    ).all()

    items: list[dict] = []
    for payment, invoice_number, client_name in payments:
        items.append({
            "source_type": "payment",
            "source_id": payment.id,
            "number": payment.payment_number,
            "date": payment.payment_date,
            "amount": payment.invoice_amount,
            "currency": payment.invoice_currency,
            "title": f"{payment.payment_number} · {invoice_number}",
            "subtitle": f"Customer payment · {client_name}",
        })
    for expense in expenses:
        items.append({
            "source_type": "expense",
            "source_id": expense.id,
            "number": expense.expense_number,
            "date": expense.expense_date,
            "amount": expense.expense_amount,
            "currency": expense.expense_currency,
            "title": f"{expense.expense_number} · {expense.description}",
            "subtitle": "Posted business expense",
        })
    for transfer in transfers:
        items.append({
            "source_type": "transfer",
            "source_id": transfer.id,
            "number": transfer.transfer_number,
            "date": transfer.transfer_date,
            "amount": transfer.source_amount,
            "currency": transfer.source_currency,
            "title": transfer.transfer_number,
            "subtitle": f"Own-account transfer · {transfer.source_currency} → {transfer.destination_currency}",
        })
    for entry in money_entries:
        if _already_reversed(db, tenant.organization_id, entry.id, "accounting_money_entry_reversal"):
            continue
        items.append({
            "source_type": "money_entry",
            "source_id": entry.id,
            "number": entry.reference or entry.id[:8].upper(),
            "date": entry.entry_date,
            "amount": entry.amount,
            "currency": entry.currency,
            "title": f"{entry.kind.title()} · {entry.description}",
            "subtitle": "Direct Money In/Out accounting entry",
        })
    for advance in customer_advances:
        if _already_reversed(db, tenant.organization_id, advance.id, "customer_advance_reversal"):
            continue
        items.append({
            "source_type": "customer_advance",
            "source_id": advance.id,
            "number": advance.reference or advance.id[:8].upper(),
            "date": advance.advance_date,
            "amount": advance.original_amount,
            "currency": advance.currency,
            "title": f"Customer advance · {advance.reference or advance.id[:8].upper()}",
            "subtitle": f"Advance receipt · remaining {advance.currency} {advance.remaining_amount}",
        })
    for application, invoice_number in advance_applications:
        if _journal_reversed(
            db,
            tenant.organization_id,
            "customer_advance_application",
            application.id,
        ):
            continue
        items.append({
            "source_type": "customer_advance_application",
            "source_id": application.id,
            "number": invoice_number,
            "date": application.application_date,
            "amount": application.amount,
            "currency": application.currency,
            "title": f"Advance applied · {invoice_number}",
            "subtitle": "Customer credit applied to invoice",
        })
    for payment, bill_number, supplier_name in payable_payments:
        if _already_reversed(db, tenant.organization_id, payment.id, "payable_payment_reversal"):
            continue
        items.append({
            "source_type": "payable_payment",
            "source_id": payment.id,
            "number": bill_number,
            "date": payment.payment_date,
            "amount": payment.amount,
            "currency": payment.currency,
            "title": f"{bill_number} · {supplier_name}",
            "subtitle": "Supplier bill payment",
        })
    for disbursement, lender_name, currency in loan_disbursements:
        if _already_reversed(db, tenant.organization_id, disbursement.id, "loan_disbursement_reversal"):
            continue
        items.append({
            "source_type": "loan_disbursement",
            "source_id": disbursement.id,
            "number": disbursement.reference or disbursement.id[:8].upper(),
            "date": disbursement.disbursement_date,
            "amount": disbursement.principal_amount,
            "currency": currency,
            "title": f"Loan received · {lender_name}",
            "subtitle": f"Principal {currency} {disbursement.principal_amount} · Net received {currency} {disbursement.net_received_amount}",
        })
    for repayment, lender_name, currency, cash_amount in loan_repayments:
        if _already_reversed(db, tenant.organization_id, repayment.id, "loan_repayment_reversal"):
            continue
        items.append({
            "source_type": "loan_repayment",
            "source_id": repayment.id,
            "number": repayment.reference or repayment.id[:8].upper(),
            "date": repayment.payment_date,
            "amount": Decimal(cash_amount),
            "currency": currency,
            "title": f"Loan repayment · {lender_name}",
            "subtitle": f"Principal {currency} {repayment.principal_amount} · Interest {currency} {repayment.interest_amount}",
        })

    for asset in fixed_assets:
        if _journal_reversed(db, tenant.organization_id, "fixed_asset_acquisition", asset.id):
            continue
        items.append({
            "source_type": "fixed_asset",
            "source_id": asset.id,
            "number": asset.asset_code,
            "date": asset.opening_balance_date if asset.record_mode == "opening" and asset.opening_balance_date else asset.acquisition_date,
            "amount": asset.acquisition_cost,
            "currency": asset.currency,
            "title": f"{asset.asset_code} · {asset.name}",
            "subtitle": "Fixed asset opening balance" if asset.record_mode == "opening" else "Fixed asset purchase",
        })
    for depreciation, asset_code, asset_name, currency in depreciation_rows:
        if _journal_reversed(db, tenant.organization_id, "asset_depreciation", depreciation.id):
            continue
        items.append({
            "source_type": "asset_depreciation",
            "source_id": depreciation.id,
            "number": f"{asset_code}-{depreciation.period_date.strftime('%Y-%m')}",
            "date": depreciation.period_date,
            "amount": depreciation.amount,
            "currency": currency,
            "title": f"Depreciation · {asset_code}",
            "subtitle": f"{asset_name} · {depreciation.period_date.strftime('%Y-%m')}",
        })
    for settlement in tax_settlements:
        if _journal_reversed(db, tenant.organization_id, "tax_settlement", settlement.id):
            continue
        items.append({
            "source_type": "tax_settlement",
            "source_id": settlement.id,
            "number": settlement.reference or settlement.id[:8].upper(),
            "date": settlement.settlement_date,
            "amount": settlement.amount,
            "currency": settlement.currency,
            "title": f"Tax settlement · {settlement.settlement_type.replace('_', ' ').title()}",
            "subtitle": "Tax liability / receivable settlement",
        })
    for payment in payroll_withholding_payments:
        if _journal_reversed(db, tenant.organization_id, "payroll_withholding_payment", payment.id):
            continue
        items.append({
            "source_type": "payroll_withholding_payment",
            "source_id": payment.id,
            "number": payment.reference or payment.id[:8].upper(),
            "date": payment.payment_date,
            "amount": payment.amount,
            "currency": payment.currency,
            "title": "Payroll withholding payment",
            "subtitle": "Employee deductions / payroll tax remittance",
        })
    for run, period in payroll_runs:
        source_type = "payroll_payment" if run.status == "paid" else "payroll_accrual"
        if _journal_reversed(db, tenant.organization_id, source_type, run.id):
            continue
        items.append({
            "source_type": "payroll_run",
            "source_id": run.id,
            "number": run.run_number,
            "date": period.pay_date if run.status == "paid" else period.period_end,
            "amount": run.net_total,
            "currency": run.currency,
            "title": f"Payroll · {run.run_number}",
            "subtitle": f"{period.name} · {run.status.title()}",
        })
    for item in owner_equity_rows:
        if _journal_reversed(db, tenant.organization_id, "owner_equity", item.id):
            continue
        items.append({
            "source_type": "owner_equity",
            "source_id": item.id,
            "number": item.reference or item.id[:8].upper(),
            "date": item.transaction_date,
            "amount": item.amount,
            "currency": item.currency,
            "title": f"Owner {item.transaction_type}",
            "subtitle": "Owner contribution / drawing",
        })
    items.sort(key=lambda item: (str(item["date"]), item["number"]), reverse=True)
    return items[:row_limit]


@router.post("/reverse", status_code=status.HTTP_201_CREATED)
def reverse_business_transaction(payload: CorrectionRequest, request: Request, db: DbSession, tenant: AccountingManager):
    reversal_date = payload.reversal_date or _today(tenant.organization.timezone)
    reason = payload.reason.strip()
    reversed_number: str
    journal = None
    before_status = "posted_or_confirmed"
    after_status = "reversed"

    if payload.source_type == "payment":
        payment = db.scalar(
            select(Payment).where(
                Payment.id == payload.source_id,
                Payment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Payment not found")
        if payment.status != "confirmed":
            raise HTTPException(status_code=409, detail="Only confirmed payments can be reversed")
        invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == payment.invoice_id,
                Invoice.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if invoice is None:
            raise HTTPException(status_code=409, detail="Payment invoice is no longer available")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="invoice_payment",
            source_id=payment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["payment"],
            source_id=payment.id,
            reversal_source_type="payment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        payment.status = "reversed"
        invoice.amount_paid = max(Decimal("0"), Decimal(invoice.amount_paid) - Decimal(payment.invoice_amount))
        invoice.balance_due = max(Decimal("0"), Decimal(invoice.total) - Decimal(invoice.amount_paid))
        invoice.paid_at = None
        if invoice.balance_due == 0:
            invoice.status = "paid"
        elif invoice.amount_paid > 0:
            invoice.status = "partially_paid"
        else:
            invoice.status = "sent"
        reversed_number = payment.payment_number

    elif payload.source_type == "expense":
        expense = db.scalar(
            select(Expense).where(
                Expense.id == payload.source_id,
                Expense.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if expense is None:
            raise HTTPException(status_code=404, detail="Expense not found")
        if expense.status != "posted":
            raise HTTPException(status_code=409, detail="Only posted expenses can be reversed")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="expense_post",
            source_id=expense.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["expense"],
            source_id=expense.id,
            reversal_source_type="expense_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        expense.status = "voided"
        expense.voided_at = datetime.now(timezone.utc)
        reversed_number = expense.expense_number
        after_status = "voided"

    elif payload.source_type == "transfer":
        transfer = db.scalar(
            select(AccountTransfer).where(
                AccountTransfer.id == payload.source_id,
                AccountTransfer.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if transfer is None:
            raise HTTPException(status_code=404, detail="Transfer not found")
        if transfer.status != "confirmed":
            raise HTTPException(status_code=409, detail="Only confirmed transfers can be reversed")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="account_transfer",
            source_id=transfer.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["transfer", "transfer_fee"],
            source_id=transfer.id,
            reversal_source_type="transfer_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        transfer.status = "reversed"
        reversed_number = transfer.transfer_number

    elif payload.source_type == "money_entry":
        entry = db.scalar(
            select(AccountingMoneyEntry).where(
                AccountingMoneyEntry.id == payload.source_id,
                AccountingMoneyEntry.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if entry is None:
            raise HTTPException(status_code=404, detail="Money entry not found")
        if _already_reversed(db, tenant.organization_id, entry.id, "accounting_money_entry_reversal"):
            raise HTTPException(status_code=409, detail="This money entry was already reversed")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="accounting_money_entry",
            source_id=entry.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        mirrored = _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["accounting_money_entry"],
            source_id=entry.id,
            reversal_source_type="accounting_money_entry_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        if mirrored != 1:
            raise HTTPException(
                status_code=409,
                detail="Money entry does not have exactly one operational financial-account movement to reverse",
            )
        reversed_number = entry.reference or f"Money {entry.id[:8].upper()}"
        before_status = "posted"
        after_status = "reversed"

    elif payload.source_type == "customer_advance":
        advance = db.scalar(
            select(CustomerAdvance).where(
                CustomerAdvance.id == payload.source_id,
                CustomerAdvance.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if advance is None:
            raise HTTPException(status_code=404, detail="Customer advance not found")
        if _already_reversed(db, tenant.organization_id, advance.id, "customer_advance_reversal"):
            raise HTTPException(status_code=409, detail="This customer advance was already reversed")

        applications = db.scalars(
            select(CustomerAdvanceApplication).where(
                CustomerAdvanceApplication.organization_id == tenant.organization_id,
                CustomerAdvanceApplication.advance_id == advance.id,
            )
        ).all()
        active_applications = [
            application
            for application in applications
            if not _journal_reversed(
                db,
                tenant.organization_id,
                "customer_advance_application",
                application.id,
            )
        ]
        if active_applications:
            raise HTTPException(
                status_code=409,
                detail="Reverse the dependent customer advance application(s) before reversing this advance receipt",
            )

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="customer_advance",
            source_id=advance.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        mirrored = _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["customer_advance"],
            source_id=advance.id,
            reversal_source_type="customer_advance_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        if mirrored != 1:
            raise HTTPException(
                status_code=409,
                detail="Customer advance does not have exactly one financial-account receipt to reverse",
            )
        advance.remaining_amount = Decimal("0")
        reversed_number = advance.reference or f"Advance {advance.id[:8].upper()}"
        before_status = "open_advance"
        after_status = "reversed"

    elif payload.source_type == "customer_advance_application":
        application = db.scalar(
            select(CustomerAdvanceApplication).where(
                CustomerAdvanceApplication.id == payload.source_id,
                CustomerAdvanceApplication.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if application is None:
            raise HTTPException(status_code=404, detail="Customer advance application not found")
        if _journal_reversed(
            db,
            tenant.organization_id,
            "customer_advance_application",
            application.id,
        ):
            raise HTTPException(status_code=409, detail="This customer advance application was already reversed")

        advance = db.scalar(
            select(CustomerAdvance).where(
                CustomerAdvance.id == application.advance_id,
                CustomerAdvance.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        invoice = db.scalar(
            select(Invoice).where(
                Invoice.id == application.invoice_id,
                Invoice.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if advance is None or invoice is None:
            raise HTTPException(status_code=409, detail="Advance or invoice is no longer available")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="customer_advance_application",
            source_id=application.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        advance.remaining_amount = min(
            Decimal(advance.original_amount),
            Decimal(advance.remaining_amount) + Decimal(application.amount),
        )
        invoice.amount_paid = max(
            Decimal("0"),
            Decimal(invoice.amount_paid) - Decimal(application.amount),
        )
        invoice.balance_due = max(
            Decimal("0"),
            Decimal(invoice.total) - Decimal(invoice.amount_paid),
        )
        invoice.paid_at = None
        if invoice.balance_due == 0:
            invoice.status = "paid"
        elif invoice.amount_paid > 0:
            invoice.status = "partially_paid"
        else:
            invoice.status = "sent"

        reversed_number = invoice.invoice_number
        before_status = "applied"
        after_status = invoice.status

    elif payload.source_type == "payable_payment":
        payment = db.scalar(
            select(PayablePayment).where(
                PayablePayment.id == payload.source_id,
                PayablePayment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Payable payment not found")
        if _already_reversed(db, tenant.organization_id, payment.id, "payable_payment_reversal"):
            raise HTTPException(status_code=409, detail="This payable payment was already reversed")
        bill = db.scalar(
            select(PayableBill).where(
                PayableBill.id == payment.bill_id,
                PayableBill.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if bill is None:
            raise HTTPException(status_code=409, detail="Supplier bill is no longer available")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="payable_payment",
            source_id=payment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["payable_payment"],
            source_id=payment.id,
            reversal_source_type="payable_payment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        bill.amount_paid = max(Decimal("0"), Decimal(bill.amount_paid) - Decimal(payment.amount))
        bill.balance_due = max(Decimal("0"), Decimal(bill.net_payable_amount) - Decimal(bill.amount_paid))
        bill.status = "paid" if bill.balance_due == 0 else "partially_paid" if bill.amount_paid > 0 else "open"
        reversed_number = f"Payment for {bill.bill_number}"
        before_status = "paid_or_partially_paid"
        after_status = bill.status

    elif payload.source_type == "loan_disbursement":
        disbursement = db.scalar(
            select(LoanDisbursement).where(
                LoanDisbursement.id == payload.source_id,
                LoanDisbursement.organization_id == tenant.organization_id,
                LoanDisbursement.principal_amount > 0,
            ).with_for_update()
        )
        if disbursement is None:
            raise HTTPException(status_code=404, detail="Loan disbursement not found")
        if _already_reversed(db, tenant.organization_id, disbursement.id, "loan_disbursement_reversal"):
            raise HTTPException(status_code=409, detail="This loan disbursement was already reversed")
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == disbursement.loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if loan is None:
            raise HTTPException(status_code=409, detail="Loan agreement is no longer available")
        principal = Decimal(disbursement.principal_amount)
        if principal > Decimal(loan.outstanding_principal):
            raise HTTPException(
                status_code=409,
                detail="This disbursement has principal that was already repaid. Reverse the dependent loan repayment(s) first, then reverse this disbursement.",
            )

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="loan_disbursement",
            source_id=disbursement.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["loan_disbursement"],
            source_id=disbursement.id,
            reversal_source_type="loan_disbursement_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        db.add(
            LoanDisbursement(
                organization_id=tenant.organization_id,
                loan_id=loan.id,
                account_id=disbursement.account_id,
                disbursement_date=reversal_date,
                principal_amount=-principal,
                fee_withheld_amount=-Decimal(disbursement.fee_withheld_amount),
                net_received_amount=-Decimal(disbursement.net_received_amount),
                reference=f"REV-{disbursement.id}",
                notes=f"Reversal of disbursement {disbursement.reference or disbursement.id[:8]}: {reason}",
                created_by_user_id=tenant.user_id,
            )
        )
        if Decimal(disbursement.fee_withheld_amount) > 0:
            db.add(
                LoanFee(
                    organization_id=tenant.organization_id,
                    loan_id=loan.id,
                    account_id=None,
                    fee_date=reversal_date,
                    fee_type="disbursement_fee_reversal",
                    amount=-Decimal(disbursement.fee_withheld_amount),
                    payment_status="reversed",
                    reference=f"REV-{disbursement.id}",
                    notes=f"Reversal: {reason}",
                    created_by_user_id=tenant.user_id,
                )
            )
        loan.outstanding_principal = max(Decimal("0"), Decimal(loan.outstanding_principal) - principal)
        loan.status = "active" if loan.outstanding_principal > 0 else "approved"
        reversed_number = disbursement.reference or f"Disbursement {disbursement.id[:8].upper()}"
        before_status = "active_disbursement"
        after_status = loan.status

    elif payload.source_type == "loan_repayment":
        repayment = db.scalar(
            select(LoanRepayment).where(
                LoanRepayment.id == payload.source_id,
                LoanRepayment.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if repayment is None:
            raise HTTPException(status_code=404, detail="Loan repayment not found")
        if _already_reversed(db, tenant.organization_id, repayment.id, "loan_repayment_reversal"):
            raise HTTPException(status_code=409, detail="This loan repayment was already reversed")
        loan = db.scalar(
            select(CompanyLoan).where(
                CompanyLoan.id == repayment.loan_id,
                CompanyLoan.organization_id == tenant.organization_id,
            ).with_for_update()
        )
        if loan is None:
            raise HTTPException(status_code=409, detail="Loan agreement is no longer available")
        if _source_cash_amount(db, tenant.organization_id, "loan_repayment_accounting", repayment.id) <= 0:
            raise HTTPException(status_code=409, detail="Only repayments posted through the accounting loan workflow can be reversed here")

        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="loan_repayment_accounting",
            source_id=repayment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        cash_amount = _source_cash_amount(db, tenant.organization_id, "loan_repayment_accounting", repayment.id)
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["loan_repayment_accounting"],
            source_id=repayment.id,
            reversal_source_type="loan_repayment_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        loan.outstanding_principal = Decimal(loan.outstanding_principal) + Decimal(repayment.principal_amount)
        if loan.outstanding_principal > Decimal(loan.principal_amount):
            raise HTTPException(status_code=409, detail="Reversal would make outstanding principal exceed the approved loan amount")
        loan.status = "active" if loan.outstanding_principal > 0 else "approved"

        derived_fee = max(
            Decimal("0"),
            cash_amount - Decimal(repayment.principal_amount) - Decimal(repayment.interest_amount),
        )
        if derived_fee > 0:
            fee = db.scalar(
                select(LoanFee)
                .where(
                    LoanFee.organization_id == tenant.organization_id,
                    LoanFee.repayment_id == repayment.id,
                    LoanFee.payment_status == "paid",
                )
                .with_for_update()
            )
            if fee is not None and Decimal(fee.amount) != derived_fee:
                raise HTTPException(
                    status_code=409,
                    detail="Linked loan fee does not match the repayment cash split",
                )
            if fee is None:
                # Existing pre-0079 rows do not have repayment_id. Keep a guarded
                # compatibility lookup for those records only.
                fee = db.scalar(
                    select(LoanFee)
                    .where(
                        LoanFee.organization_id == tenant.organization_id,
                        LoanFee.repayment_id.is_(None),
                        LoanFee.loan_id == loan.id,
                        LoanFee.account_id == repayment.account_id,
                        LoanFee.fee_date == repayment.payment_date,
                        LoanFee.amount == derived_fee,
                        LoanFee.payment_status == "paid",
                    )
                    .order_by(LoanFee.created_at.desc())
                    .with_for_update()
                )
            if fee is not None:
                fee.payment_status = "reversed"
                fee.notes = f"{fee.notes + ' · ' if fee.notes else ''}Reversed: {reason}"

        db.flush()
        refresh_loan_schedule_payment_state(
            db,
            organization_id=tenant.organization_id,
            loan_id=loan.id,
        )

        reversed_number = repayment.reference or f"Repayment {repayment.id[:8].upper()}"
        before_status = "posted_repayment"
        after_status = loan.status

    elif payload.source_type == "asset_depreciation":
        depreciation = db.scalar(
            select(AssetDepreciationEntry)
            .where(
                AssetDepreciationEntry.id == payload.source_id,
                AssetDepreciationEntry.organization_id == tenant.organization_id,
                AssetDepreciationEntry.status == "posted",
            )
            .with_for_update()
        )
        if depreciation is None:
            raise HTTPException(status_code=404, detail="Posted asset depreciation entry not found")
        if _journal_reversed(db, tenant.organization_id, "asset_depreciation", depreciation.id):
            raise HTTPException(status_code=409, detail="This depreciation entry was already reversed")
        asset = db.scalar(
            select(FixedAsset)
            .where(
                FixedAsset.id == depreciation.asset_id,
                FixedAsset.organization_id == tenant.organization_id,
            )
            .with_for_update()
        )
        if asset is None:
            raise HTTPException(status_code=409, detail="Fixed asset is no longer available")
        later_entry = db.scalar(
            select(AssetDepreciationEntry.id).where(
                AssetDepreciationEntry.organization_id == tenant.organization_id,
                AssetDepreciationEntry.asset_id == asset.id,
                AssetDepreciationEntry.status == "posted",
                AssetDepreciationEntry.period_date > depreciation.period_date,
            )
        )
        if later_entry is not None:
            raise HTTPException(
                status_code=409,
                detail="Reverse later depreciation periods first so the asset schedule remains chronological",
            )
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="asset_depreciation",
            source_id=depreciation.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        depreciation.status = "reversed"
        minimum_accumulated = Decimal(asset.opening_accumulated_depreciation or 0)
        asset.accumulated_depreciation = max(
            minimum_accumulated,
            Decimal(asset.accumulated_depreciation) - Decimal(depreciation.amount),
        )
        maximum = Decimal(asset.acquisition_cost) - Decimal(asset.salvage_value)
        asset.status = "fully_depreciated" if Decimal(asset.accumulated_depreciation) >= maximum else "active"
        reversed_number = f"{asset.asset_code}-{depreciation.period_date.strftime('%Y-%m')}"
        before_status = "posted"
        after_status = depreciation.status

    elif payload.source_type == "fixed_asset":
        asset = db.scalar(
            select(FixedAsset)
            .where(
                FixedAsset.id == payload.source_id,
                FixedAsset.organization_id == tenant.organization_id,
                FixedAsset.status != "reversed",
            )
            .with_for_update()
        )
        if asset is None:
            raise HTTPException(status_code=404, detail="Fixed asset not found")
        if _journal_reversed(db, tenant.organization_id, "fixed_asset_acquisition", asset.id):
            raise HTTPException(status_code=409, detail="This fixed asset acquisition was already reversed")
        active_depreciation = db.scalar(
            select(AssetDepreciationEntry.id).where(
                AssetDepreciationEntry.organization_id == tenant.organization_id,
                AssetDepreciationEntry.asset_id == asset.id,
                AssetDepreciationEntry.status == "posted",
            )
        )
        if active_depreciation is not None:
            raise HTTPException(
                status_code=409,
                detail="Reverse all posted depreciation entries before reversing the fixed asset acquisition",
            )
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="fixed_asset_acquisition",
            source_id=asset.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        mirrored = _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["fixed_asset_acquisition"],
            source_id=asset.id,
            reversal_source_type="fixed_asset_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        if asset.record_mode == "purchase" and mirrored != 1:
            raise HTTPException(status_code=409, detail="Fixed asset purchase does not have exactly one cash movement to reverse")
        if asset.record_mode == "opening" and mirrored != 0:
            raise HTTPException(status_code=409, detail="Opening fixed asset unexpectedly has a cash movement")
        before_status = asset.status
        asset.status = "reversed"
        reversed_number = asset.asset_code
        after_status = asset.status

    elif payload.source_type == "tax_settlement":
        settlement = db.scalar(
            select(TaxSettlement)
            .where(
                TaxSettlement.id == payload.source_id,
                TaxSettlement.organization_id == tenant.organization_id,
            )
            .with_for_update()
        )
        if settlement is None:
            raise HTTPException(status_code=404, detail="Tax settlement not found")
        if _journal_reversed(db, tenant.organization_id, "tax_settlement", settlement.id):
            raise HTTPException(status_code=409, detail="This tax settlement was already reversed")
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="tax_settlement",
            source_id=settlement.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["tax_settlement"],
            source_id=settlement.id,
            reversal_source_type="tax_settlement_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        reversed_number = settlement.reference or f"Tax {settlement.id[:8].upper()}"
        before_status = "posted"
        after_status = "reversed"

    elif payload.source_type == "payroll_withholding_payment":
        payment = db.scalar(
            select(PayrollWithholdingPayment)
            .where(
                PayrollWithholdingPayment.id == payload.source_id,
                PayrollWithholdingPayment.organization_id == tenant.organization_id,
            )
            .with_for_update()
        )
        if payment is None:
            raise HTTPException(status_code=404, detail="Payroll withholding payment not found")
        if _journal_reversed(db, tenant.organization_id, "payroll_withholding_payment", payment.id):
            raise HTTPException(status_code=409, detail="This payroll withholding payment was already reversed")
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="payroll_withholding_payment",
            source_id=payment.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        mirrored = _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["payroll_withholding_payment"],
            source_id=payment.id,
            reversal_source_type="payroll_withholding_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        if mirrored != 1:
            raise HTTPException(status_code=409, detail="Payroll withholding payment does not have exactly one cash movement to reverse")
        reversed_number = payment.reference or f"Payroll WH {payment.id[:8].upper()}"
        before_status = "posted"
        after_status = "reversed"

    elif payload.source_type == "payroll_run":
        run = db.scalar(
            select(PayrollRun)
            .where(
                PayrollRun.id == payload.source_id,
                PayrollRun.organization_id == tenant.organization_id,
                PayrollRun.status.in_(["approved", "paid"]),
            )
            .with_for_update()
        )
        if run is None:
            raise HTTPException(status_code=404, detail="Approved or paid payroll run not found")
        period = db.scalar(
            select(PayrollPeriod).where(
                PayrollPeriod.id == run.period_id,
                PayrollPeriod.organization_id == tenant.organization_id,
            )
        )
        if period is None:
            raise HTTPException(status_code=409, detail="Payroll period is no longer available")
        active_remittances = _active_payroll_withholding_payments_on_or_after(
            db,
            tenant.organization_id,
            period.period_end,
        )
        withheld = _source_ledger_amount(
            db,
            tenant.organization_id,
            source_type="payroll_accrual",
            source_id=run.id,
            system_key="payroll_withholdings",
            side="credit",
        )
        if withheld > 0 and active_remittances:
            raise HTTPException(
                status_code=409,
                detail="Reverse payroll withholding remittance(s) dated on or after this payroll period before reversing the payroll run",
            )

        payment_reversal = None
        if run.status == "paid":
            if _journal_reversed(db, tenant.organization_id, "payroll_payment", run.id):
                raise HTTPException(status_code=409, detail="This payroll payment was already reversed")
            payment_reversal = reverse_source_journal(
                db,
                organization_id=tenant.organization_id,
                user_id=tenant.user_id,
                source_type="payroll_payment",
                source_id=run.id,
                reversal_date=reversal_date,
                reason=reason,
            )
            mirrored = _mirror_transactions(
                db,
                tenant=tenant,
                source_types=["payroll_run"],
                source_id=run.id,
                reversal_source_type="payroll_run_reversal",
                reversal_date=reversal_date,
                reason=reason,
            )
            if mirrored != 1:
                raise HTTPException(status_code=409, detail="Paid payroll does not have exactly one cash movement to reverse")

        if _journal_reversed(db, tenant.organization_id, "payroll_accrual", run.id):
            raise HTTPException(status_code=409, detail="This payroll accrual was already reversed")
        accrual_reversal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="payroll_accrual",
            source_id=run.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        journal = payment_reversal or accrual_reversal
        before_status = run.status
        run.status = "reversed"
        reversed_number = run.run_number
        after_status = run.status

    elif payload.source_type == "owner_equity":
        item = db.scalar(
            select(OwnerEquityTransaction)
            .where(
                OwnerEquityTransaction.id == payload.source_id,
                OwnerEquityTransaction.organization_id == tenant.organization_id,
            )
            .with_for_update()
        )
        if item is None:
            raise HTTPException(status_code=404, detail="Owner equity transaction not found")
        if _journal_reversed(db, tenant.organization_id, "owner_equity", item.id):
            raise HTTPException(status_code=409, detail="This owner equity transaction was already reversed")
        journal = reverse_source_journal(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            source_type="owner_equity",
            source_id=item.id,
            reversal_date=reversal_date,
            reason=reason,
        )
        mirrored = _mirror_transactions(
            db,
            tenant=tenant,
            source_types=["owner_equity"],
            source_id=item.id,
            reversal_source_type="owner_equity_reversal",
            reversal_date=reversal_date,
            reason=reason,
        )
        if mirrored != 1:
            raise HTTPException(status_code=409, detail="Owner equity transaction does not have exactly one cash movement to reverse")
        reversed_number = item.reference or f"Owner equity {item.id[:8].upper()}"
        before_status = "posted"
        after_status = "reversed"

    db.flush()
    record_activity(
        db,
        action=f"finance.{payload.source_type}.reversed",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type=payload.source_type,
        entity_id=payload.source_id,
        before={"status": before_status},
        after={
            "status": after_status,
            "reversal_date": reversal_date.isoformat(),
            "reason": reason,
            "reversal_journal_id": journal.id if journal else None,
        },
        message=f"{payload.source_type.replace('_', ' ').title()} {reversed_number} reversed: {reason}",
        request=request,
    )
    db.commit()
    return {
        "ok": True,
        "source_type": payload.source_type,
        "source_id": payload.source_id,
        "number": reversed_number,
        "reversal_date": reversal_date,
        "reversal_journal_id": journal.id if journal else None,
        "accounting_note": "Accounting journal reversed" if journal else "No posted accounting journal existed; future sync will ignore the reversed source",
    }
