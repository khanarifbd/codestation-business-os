from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.capital import CompanyLoan, LoanRepayment
from app.models.finance import FinancialAccount
from app.models.loan_accounting import LoanDisbursement, LoanFee
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/accounting/loans", tags=["Accounting - Loans"])
AccountingViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]


@router.get("/{loan_id}/history")
def get_loan_history(loan_id: str, db: DbSession, tenant: AccountingViewer):
    loan = db.scalar(
        select(CompanyLoan).where(
            CompanyLoan.id == loan_id,
            CompanyLoan.organization_id == tenant.organization_id,
        )
    )
    if loan is None:
        from fastapi import HTTPException

        raise HTTPException(status_code=404, detail="Loan not found")

    disbursement_rows = db.execute(
        select(LoanDisbursement, FinancialAccount.name)
        .join(FinancialAccount, FinancialAccount.id == LoanDisbursement.account_id)
        .where(
            LoanDisbursement.organization_id == tenant.organization_id,
            LoanDisbursement.loan_id == loan.id,
        )
        .order_by(LoanDisbursement.disbursement_date.desc(), LoanDisbursement.created_at.desc())
    ).all()

    repayment_rows = db.execute(
        select(LoanRepayment, FinancialAccount.name)
        .join(FinancialAccount, FinancialAccount.id == LoanRepayment.account_id)
        .where(
            LoanRepayment.organization_id == tenant.organization_id,
            LoanRepayment.loan_id == loan.id,
        )
        .order_by(LoanRepayment.payment_date.desc(), LoanRepayment.created_at.desc())
    ).all()

    fee_rows = db.scalars(
        select(LoanFee)
        .where(
            LoanFee.organization_id == tenant.organization_id,
            LoanFee.loan_id == loan.id,
        )
        .order_by(LoanFee.fee_date.desc(), LoanFee.created_at.desc())
    ).all()

    return {
        "disbursements": [
            {
                "id": item.id,
                "date": item.disbursement_date,
                "account_id": item.account_id,
                "account_name": account_name,
                "principal_amount": item.principal_amount,
                "fee_withheld_amount": item.fee_withheld_amount,
                "net_received_amount": item.net_received_amount,
                "reference": item.reference,
                "notes": item.notes,
                "created_at": item.created_at,
            }
            for item, account_name in disbursement_rows
        ],
        "repayments": [
            {
                "id": item.id,
                "date": item.payment_date,
                "account_id": item.account_id,
                "account_name": account_name,
                "principal_amount": item.principal_amount,
                "interest_amount": item.interest_amount,
                "reference": item.reference,
                "notes": item.notes,
                "created_at": item.created_at,
            }
            for item, account_name in repayment_rows
        ],
        "fees": [
            {
                "id": item.id,
                "date": item.fee_date,
                "fee_type": item.fee_type,
                "amount": item.amount,
                "payment_status": item.payment_status,
                "reference": item.reference,
                "notes": item.notes,
                "created_at": item.created_at,
            }
            for item in fee_rows
        ],
    }
