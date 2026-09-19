from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel


class AccountingLoanRead(BaseModel):
    id: str
    lender_name: str
    lender_type: str
    currency: str
    approved_amount: Decimal
    disbursed_amount: Decimal
    undisbursed_amount: Decimal
    outstanding_principal: Decimal
    annual_interest_rate: Decimal
    approval_date: date
    maturity_date: date | None = None
    status: str
    reference: str | None = None
    notes: str | None = None


class LoanDisbursementRead(BaseModel):
    id: str
    loan: AccountingLoanRead
    principal_amount: Decimal
    fee_withheld_amount: Decimal
    net_received_amount: Decimal
    journal_entry_id: str


class LoanRepaymentRead(BaseModel):
    id: str
    loan: AccountingLoanRead
    principal_amount: Decimal
    interest_amount: Decimal
    fee_amount: Decimal
    cash_paid: Decimal
    journal_entry_id: str


class LoanScheduleItemRead(BaseModel):
    id: str
    installment_number: int
    due_date: date
    principal_due: Decimal
    interest_due: Decimal
    fee_due: Decimal
    principal_paid: Decimal
    interest_paid: Decimal
    fee_paid: Decimal
    status: str


class LoanHistoryDisbursementRead(BaseModel):
    id: str
    date: date
    account_id: str
    account_name: str
    principal_amount: Decimal
    fee_withheld_amount: Decimal
    net_received_amount: Decimal
    reference: str | None = None
    notes: str | None = None
    status: str
    created_at: datetime


class LoanHistoryRepaymentRead(BaseModel):
    id: str
    date: date
    account_id: str
    account_name: str
    principal_amount: Decimal
    interest_amount: Decimal
    reference: str | None = None
    notes: str | None = None
    status: str
    created_at: datetime


class LoanHistoryFeeRead(BaseModel):
    id: str
    date: date
    fee_type: str
    amount: Decimal
    payment_status: str
    reference: str | None = None
    notes: str | None = None
    created_at: datetime


class LoanHistoryRead(BaseModel):
    disbursements: list[LoanHistoryDisbursementRead]
    repayments: list[LoanHistoryRepaymentRead]
    fees: list[LoanHistoryFeeRead]
