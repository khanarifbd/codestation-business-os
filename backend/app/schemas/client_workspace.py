from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel

from app.schemas.client_detail import ClientDetailRead


class ClientWorkspaceAccess(BaseModel):
    clients_manage: bool
    quotations: bool
    quotations_manage: bool
    orders: bool
    projects: bool
    finance: bool
    finance_manage: bool


class ClientWorkspaceCounts(BaseModel):
    quotations: int | None = None
    orders: int | None = None
    projects: int | None = None
    active_projects: int | None = None
    invoices: int | None = None
    overdue_invoices: int | None = None


class ClientCurrencyAmount(BaseModel):
    currency: str
    amount: Decimal


class ClientInvoiceCurrencySummary(BaseModel):
    currency: str
    invoiced: Decimal
    paid: Decimal
    outstanding: Decimal


class ClientQuotationSummary(BaseModel):
    id: str
    quotation_number: str
    status: str
    subject: str | None
    issue_date: date
    valid_until: date | None
    currency: str
    total: Decimal
    created_at: datetime


class ClientOrderSummary(BaseModel):
    id: str
    order_number: str
    quotation_id: str | None
    status: str
    subject: str | None
    order_date: date
    currency: str
    total: Decimal
    created_at: datetime


class ClientProjectSummary(BaseModel):
    id: str
    project_number: str
    order_id: str
    quotation_id: str
    name: str
    status: str
    priority: str
    progress_percent: int
    due_date: date | None
    currency: str
    contract_value: Decimal
    created_at: datetime


class ClientInvoiceSummary(BaseModel):
    id: str
    invoice_number: str
    order_id: str | None
    project_id: str | None
    status: str
    display_status: str
    subject: str | None
    issue_date: date
    due_date: date | None
    currency: str
    total: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    created_at: datetime


class ClientPaymentSummary(BaseModel):
    id: str
    payment_number: str
    invoice_id: str
    invoice_number: str
    payment_date: date
    invoice_currency: str
    invoice_amount: Decimal
    account_currency: str
    account_amount: Decimal
    method: str
    reference: str | None
    created_at: datetime


class ClientTimelineEvent(BaseModel):
    kind: str
    title: str
    subtitle: str | None = None
    occurred_at: datetime
    href: str | None = None


class ClientWorkspaceRead(BaseModel):
    client: ClientDetailRead
    access: ClientWorkspaceAccess
    counts: ClientWorkspaceCounts
    business_value: list[ClientCurrencyAmount]
    invoice_summary: list[ClientInvoiceCurrencySummary]
    quotations: list[ClientQuotationSummary]
    orders: list[ClientOrderSummary]
    projects: list[ClientProjectSummary]
    invoices: list[ClientInvoiceSummary]
    payments: list[ClientPaymentSummary]
    timeline: list[ClientTimelineEvent]
