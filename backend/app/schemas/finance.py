from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

AccountType = Literal["bank", "cash", "mobile_wallet", "credit_card", "payment_gateway", "petty_cash", "other"]
InvoiceLifecycleAction = Literal["send", "cancel"]
PaymentMethod = Literal["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "other"]

LEGACY_ACCOUNT_TYPE_ALIASES = {
    "wallet": "mobile_wallet",
    "gateway": "payment_gateway",
}


def _canonical_account_type(value):
    if isinstance(value, str):
        return LEGACY_ACCOUNT_TYPE_ALIASES.get(value.strip().lower(), value.strip().lower())
    return value


class FinancialAccountCreate(BaseModel):
    name: str = Field(min_length=1, max_length=180)
    account_type: AccountType = "bank"
    provider_name: str | None = Field(default=None, max_length=120)
    account_holder_name: str | None = Field(default=None, max_length=180)
    account_reference: str | None = Field(default=None, max_length=180)
    currency: str = Field(min_length=3, max_length=3)
    opening_balance: Decimal = Field(default=Decimal("0"))
    notes: str | None = None

    @field_validator("account_type", mode="before")
    @classmethod
    def normalize_account_type(cls, value):
        return _canonical_account_type(value)


class FinancialAccountUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=180)
    account_type: AccountType | None = None
    provider_name: str | None = Field(default=None, max_length=120)
    account_holder_name: str | None = Field(default=None, max_length=180)
    account_reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    is_active: bool | None = None

    @field_validator("account_type", mode="before")
    @classmethod
    def normalize_account_type(cls, value):
        return _canonical_account_type(value)


class FinancialAccountRead(BaseModel):
    id: str
    name: str
    account_type: str
    provider_name: str | None
    account_holder_name: str | None
    account_reference: str | None
    currency: str
    opening_balance: Decimal
    current_balance: Decimal
    is_active: bool
    notes: str | None
    created_at: datetime
    updated_at: datetime


class LedgerTransactionRead(BaseModel):
    id: str
    transaction_date: date
    direction: str
    amount: Decimal
    currency: str
    source_type: str
    source_id: str
    reference: str | None
    description: str | None
    created_at: datetime


class AccountTransferCreate(BaseModel):
    from_account_id: str
    to_account_id: str
    transfer_date: date | None = None
    source_amount: Decimal = Field(gt=0, le=Decimal("1000000000000"))
    fee_amount: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("1000000000000"))
    destination_amount: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000000000"))
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class AccountTransferRead(BaseModel):
    id: str
    transfer_number: str
    from_account_id: str
    from_account_name: str
    to_account_id: str
    to_account_name: str
    transfer_date: date
    source_currency: str
    destination_currency: str
    source_amount: Decimal
    fee_amount: Decimal
    net_source_amount: Decimal
    destination_amount: Decimal
    exchange_rate: Decimal
    reference: str | None
    notes: str | None
    status: str
    created_at: datetime


class InvoiceItemInput(BaseModel):
    description: str = Field(min_length=1, max_length=5000)
    quantity: Decimal = Field(gt=0, le=Decimal("100000000"))
    unit_price: Decimal = Field(ge=0, le=Decimal("1000000000000"))
    discount_percent: Decimal = Field(default=Decimal("0"), ge=0, le=100)
    tax_rate: Decimal = Field(default=Decimal("0"), ge=0, le=1000)


class InvoiceCreate(BaseModel):
    client_id: str
    subject: str | None = Field(default=None, max_length=220)
    issue_date: date | None = None
    due_date: date | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    tax_calculation_mode: Literal["exclusive", "inclusive"] = "exclusive"
    assigned_employee_id: str | None = None
    notes: str | None = None
    terms_conditions: str | None = None
    internal_notes: str | None = None
    items: list[InvoiceItemInput] = Field(min_length=1, max_length=200)


class InvoiceStatusAction(BaseModel):
    action: InvoiceLifecycleAction


class InvoiceItemRead(BaseModel):
    id: str
    source_order_item_id: str | None
    sort_order: int
    description: str
    quantity: Decimal
    unit_price: Decimal
    discount_percent: Decimal
    tax_rate: Decimal
    line_subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal


class InvoiceListItem(BaseModel):
    id: str
    invoice_number: str
    client_id: str
    client_name: str
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


class InvoiceDetail(InvoiceListItem):
    quotation_id: str | None
    tax_calculation_mode: str
    seller_name_snapshot: str
    seller_email_snapshot: str | None
    seller_address_snapshot: str | None
    seller_tax_identifier_snapshot: str | None
    client_name_snapshot: str
    client_contact_snapshot: str | None
    client_email_snapshot: str | None
    client_address_snapshot: str | None
    client_tax_identifier_snapshot: str | None
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    notes: str | None
    terms_conditions: str | None
    internal_notes: str | None
    sent_at: datetime | None
    paid_at: datetime | None
    cancelled_at: datetime | None
    items: list[InvoiceItemRead]


class InvoicePage(BaseModel):
    items: list[InvoiceListItem]
    next_cursor: str | None = None


class PaymentCreate(BaseModel):
    invoice_id: str
    account_id: str
    payment_date: date | None = None
    invoice_amount: Decimal = Field(gt=0)
    account_amount: Decimal | None = Field(default=None, gt=0)
    exchange_rate: Decimal | None = Field(default=None, gt=0)
    method: PaymentMethod = "bank_transfer"
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None

    @model_validator(mode="after")
    def normalize_conversion(self):
        if self.exchange_rate is None and self.account_amount is not None:
            self.exchange_rate = self.account_amount / self.invoice_amount
        if self.account_amount is None and self.exchange_rate is not None:
            self.account_amount = self.invoice_amount * self.exchange_rate
        return self


class PaymentRead(BaseModel):
    id: str
    payment_number: str
    invoice_id: str
    invoice_number: str
    client_name: str
    account_id: str
    account_name: str
    payment_date: date
    invoice_currency: str
    account_currency: str
    invoice_amount: Decimal
    account_amount: Decimal
    exchange_rate: Decimal
    method: str
    reference: str | None
    notes: str | None
    status: str
    created_at: datetime


class CurrencyInvoiceSummary(BaseModel):
    currency: str
    invoiced: Decimal
    paid: Decimal
    outstanding: Decimal


class FinanceSummary(BaseModel):
    invoice_count: int
    draft_count: int
    sent_count: int
    partially_paid_count: int
    paid_count: int
    overdue_count: int
    payment_count: int
    account_count: int
    by_currency: list[CurrencyInvoiceSummary]


class FinanceMetaClient(BaseModel):
    id: str
    code: str
    name: str
    currency: str | None


class FinanceMetaOrder(BaseModel):
    id: str
    number: str
    client_id: str
    client_name: str
    currency: str
    total: Decimal
    status: str


class FinanceMetaProject(BaseModel):
    id: str
    number: str
    order_id: str | None
    client_id: str
    name: str
    currency: str
    contract_value: Decimal
    status: str


class FinanceMeta(BaseModel):
    clients: list[FinanceMetaClient]
    orders: list[FinanceMetaOrder]
    projects: list[FinanceMetaProject]
    accounts: list[FinancialAccountRead]
