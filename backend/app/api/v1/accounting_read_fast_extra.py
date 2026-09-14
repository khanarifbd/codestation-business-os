from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import and_, case, func, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.capital import CompanyLoan
from app.models.crm import Client
from app.models.customer_advances import CustomerAdvance
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice
from app.models.inventory import PurchaseReceipt
from app.models.loan_accounting import LoanDisbursement
from app.models.payables import PayableBill
from app.schemas.accounting_loans import AccountingLoanRead
from app.schemas.customer_advances import CustomerAdvanceRead
from app.schemas.payables import PayableBillRead
from app.tenancy.context import TenantContext

router = APIRouter(tags=["Accounting - Fast Reads"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


@router.get("/accounting/customer-advances", response_model=list[CustomerAdvanceRead])
def list_customer_advances_fast(
    db: DbSession,
    tenant: AccountingViewer,
    open_only: bool = False,
):
    org_id = tenant.organization_id
    query = (
        select(CustomerAdvance, Client.display_name, FinancialAccount.name)
        .join(
            Client,
            and_(
                Client.id == CustomerAdvance.client_id,
                Client.organization_id == org_id,
            ),
        )
        .join(
            FinancialAccount,
            and_(
                FinancialAccount.id == CustomerAdvance.financial_account_id,
                FinancialAccount.organization_id == org_id,
            ),
        )
        .where(CustomerAdvance.organization_id == org_id)
    )
    if open_only:
        query = query.where(CustomerAdvance.remaining_amount > 0)

    rows = db.execute(
        query.order_by(
            CustomerAdvance.advance_date.desc(),
            CustomerAdvance.created_at.desc(),
        ).limit(300)
    ).all()
    return [
        CustomerAdvanceRead(
            id=item.id,
            client_id=item.client_id,
            client_name=client_name,
            financial_account_id=item.financial_account_id,
            financial_account_name=account_name,
            advance_date=item.advance_date,
            currency=item.currency,
            original_amount=item.original_amount,
            remaining_amount=item.remaining_amount,
            reference=item.reference,
            notes=item.notes,
            created_at=item.created_at,
        )
        for item, client_name, account_name in rows
    ]


@router.get("/accounting/payables", response_model=list[PayableBillRead])
def list_payable_bills_fast(
    db: DbSession,
    tenant: AccountingViewer,
    include_paid: bool = False,
    limit: int = 200,
):
    org_id = tenant.organization_id
    query = (
        select(PayableBill, LedgerAccount.name)
        .join(
            LedgerAccount,
            and_(
                LedgerAccount.id == PayableBill.expense_ledger_account_id,
                LedgerAccount.organization_id == org_id,
            ),
        )
        .where(PayableBill.organization_id == org_id)
    )
    if not include_paid:
        query = query.where(PayableBill.balance_due > 0)

    rows = db.execute(
        query.order_by(
            PayableBill.due_date.asc().nulls_last(),
            PayableBill.bill_date.desc(),
        ).limit(min(max(limit, 1), 500))
    ).all()
    return [
        PayableBillRead(
            id=bill.id,
            bill_number=bill.bill_number,
            supplier_name=bill.supplier_name,
            bill_date=bill.bill_date,
            due_date=bill.due_date,
            currency=bill.currency,
            subtotal_amount=bill.subtotal_amount,
            tax_code_id=bill.tax_code_id,
            tax_rate_snapshot=bill.tax_rate_snapshot,
            input_tax_amount=bill.input_tax_amount,
            recoverable_tax_amount=bill.recoverable_tax_amount,
            withholding_tax_code_id=bill.withholding_tax_code_id,
            withholding_rate_snapshot=bill.withholding_rate_snapshot,
            withholding_tax_amount=bill.withholding_tax_amount,
            original_amount=bill.original_amount,
            net_payable_amount=bill.net_payable_amount,
            amount_paid=bill.amount_paid,
            balance_due=bill.balance_due,
            expense_ledger_account_id=bill.expense_ledger_account_id,
            expense_ledger_account_name=account_name,
            description=bill.description,
            reference=bill.reference,
            notes=bill.notes,
            status=bill.status,
            created_at=bill.created_at,
        )
        for bill, account_name in rows
    ]


@router.get("/accounting/loans", response_model=list[AccountingLoanRead])
def list_accounting_loans_fast(db: DbSession, tenant: AccountingViewer):
    org_id = tenant.organization_id
    tracked_disbursement = (
        select(func.coalesce(func.sum(LoanDisbursement.principal_amount), 0))
        .where(
            LoanDisbursement.organization_id == org_id,
            LoanDisbursement.loan_id == CompanyLoan.id,
        )
        .correlate(CompanyLoan)
        .scalar_subquery()
    )
    legacy_received = (
        select(func.coalesce(func.sum(FinancialTransaction.amount), 0))
        .where(
            FinancialTransaction.organization_id == org_id,
            FinancialTransaction.source_type == "company_loan",
            FinancialTransaction.source_id == CompanyLoan.id,
            FinancialTransaction.direction == "credit",
        )
        .correlate(CompanyLoan)
        .scalar_subquery()
    )
    rows = db.execute(
        select(
            CompanyLoan,
            tracked_disbursement.label("tracked_disbursement"),
            legacy_received.label("legacy_received"),
        )
        .where(CompanyLoan.organization_id == org_id)
        .order_by(CompanyLoan.loan_date.desc(), CompanyLoan.created_at.desc())
    ).all()

    result: list[AccountingLoanRead] = []
    for item, tracked, legacy in rows:
        tracked_amount = _money(tracked)
        if tracked_amount > 0:
            disbursed = tracked_amount
        else:
            disbursed = _money(item.principal_amount if Decimal(legacy or 0) > 0 else Decimal("0"))
        approved = _money(item.principal_amount)
        result.append(
            AccountingLoanRead(
                id=item.id,
                lender_name=item.lender_name,
                lender_type=item.lender_type,
                currency=item.currency,
                approved_amount=approved,
                disbursed_amount=disbursed,
                undisbursed_amount=_money(max(Decimal("0"), approved - disbursed)),
                outstanding_principal=item.outstanding_principal,
                annual_interest_rate=item.annual_interest_rate,
                approval_date=item.loan_date,
                maturity_date=item.maturity_date,
                status=item.status,
                reference=item.reference,
                notes=item.notes,
            )
        )
    return result


@router.get("/accounting/tax/report")
def tax_report_fast(
    db: DbSession,
    tenant: AccountingViewer,
    date_from: date,
    date_to: date,
):
    if date_from > date_to:
        date_from, date_to = date_to, date_from
    org_id = tenant.organization_id

    invoice_rows = db.execute(
        select(
            Invoice.currency,
            func.coalesce(
                func.sum(
                    case(
                        (Invoice.status.not_in(["draft", "cancelled"]), Invoice.tax_total),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .where(
            Invoice.organization_id == org_id,
            Invoice.issue_date >= date_from,
            Invoice.issue_date <= date_to,
        )
        .group_by(Invoice.currency)
    ).all()

    payable_rows = db.execute(
        select(
            PayableBill.currency,
            func.coalesce(func.sum(PayableBill.input_tax_amount), 0),
            func.coalesce(func.sum(PayableBill.recoverable_tax_amount), 0),
            func.coalesce(func.sum(PayableBill.withholding_tax_amount), 0),
        )
        .where(
            PayableBill.organization_id == org_id,
            PayableBill.bill_date >= date_from,
            PayableBill.bill_date <= date_to,
        )
        .group_by(PayableBill.currency)
    ).all()

    purchase_rows = db.execute(
        select(
            PurchaseReceipt.currency,
            func.coalesce(
                func.sum(
                    case(
                        (PurchaseReceipt.status != "cancelled", PurchaseReceipt.tax_total),
                        else_=0,
                    )
                ),
                0,
            ),
            func.coalesce(
                func.sum(
                    case(
                        (PurchaseReceipt.status != "cancelled", PurchaseReceipt.recoverable_tax_total),
                        else_=0,
                    )
                ),
                0,
            ),
        )
        .where(
            PurchaseReceipt.organization_id == org_id,
            PurchaseReceipt.receipt_date >= date_from,
            PurchaseReceipt.receipt_date <= date_to,
        )
        .group_by(PurchaseReceipt.currency)
    ).all()

    data: dict[str, dict[str, Decimal]] = defaultdict(
        lambda: {
            "output": Decimal("0"),
            "payable_input": Decimal("0"),
            "payable_recoverable": Decimal("0"),
            "withholding": Decimal("0"),
            "inventory_input": Decimal("0"),
            "inventory_recoverable": Decimal("0"),
        }
    )
    for currency, output_tax in invoice_rows:
        data[currency]["output"] = _money(output_tax)
    for currency, input_tax, recoverable, withholding in payable_rows:
        data[currency]["payable_input"] = _money(input_tax)
        data[currency]["payable_recoverable"] = _money(recoverable)
        data[currency]["withholding"] = _money(withholding)
    for currency, input_tax, recoverable in purchase_rows:
        data[currency]["inventory_input"] = _money(input_tax)
        data[currency]["inventory_recoverable"] = _money(recoverable)

    rows = []
    for currency in sorted(data):
        values = data[currency]
        output_tax = _money(values["output"])
        input_tax = _money(values["payable_input"] + values["inventory_input"])
        recoverable = _money(values["payable_recoverable"] + values["inventory_recoverable"])
        withholding = _money(values["withholding"])
        rows.append(
            {
                "currency": currency,
                "output_tax": output_tax,
                "input_tax": input_tax,
                "recoverable_input_tax": recoverable,
                "withholding_tax": withholding,
                "net_indirect_tax_payable": _money(output_tax - recoverable),
            }
        )
    return {"date_from": date_from, "date_to": date_to, "rows": rows}
