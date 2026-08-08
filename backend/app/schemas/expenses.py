from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

CostType = Literal["direct", "operating", "financial", "tax", "other"]
ExpenseStatus = Literal["posted", "voided"]
PaymentMethod = Literal["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "fiverr", "other"]


class VendorCreate(BaseModel):
    name: str = Field(min_length=1, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=80)
    website: str | None = Field(default=None, max_length=1000)
    tax_identifier: str | None = Field(default=None, max_length=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = None


class VendorUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: EmailStr | None = None
    phone: str | None = Field(default=None, max_length=80)
    website: str | None = Field(default=None, max_length=1000)
    tax_identifier: str | None = Field(default=None, max_length=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = None
    is_active: bool | None = None


class VendorRead(BaseModel):
    id: str
    vendor_code: str
    name: str
    contact_name: str | None
    email: str | None
    phone: str | None
    website: str | None
    tax_identifier: str | None
    country_code: str | None
    currency: str | None
    notes: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ExpenseCategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=140)
    cost_type: CostType = "operating"
    sort_order: int = Field(default=0, ge=0, le=100000)


class ExpenseCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=140)
    cost_type: CostType | None = None
    sort_order: int | None = Field(default=None, ge=0, le=100000)
    is_active: bool | None = None


class ExpenseCategoryRead(BaseModel):
    id: str
    name: str
    slug: str
    cost_type: str
    is_active: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class ExpenseCreate(BaseModel):
    description: str = Field(min_length=1, max_length=500)
    category_id: str
    account_id: str
    vendor_id: str | None = None
    client_id: str | None = None
    project_id: str | None = None
    expense_date: date | None = None
    expense_currency: str = Field(min_length=3, max_length=3)
    expense_amount: Decimal = Field(gt=0, le=Decimal("1000000000000"))
    account_amount: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000000"))
    exchange_rate: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000"))
    profitability_amount: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000000"))
    profitability_exchange_rate: Decimal | None = Field(default=None, gt=0, le=Decimal("1000000000"))
    tax_amount: Decimal = Field(default=Decimal("0"), ge=0, le=Decimal("1000000000000"))
    payment_method: PaymentMethod = "bank_transfer"
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class ExpenseUpdate(BaseModel):
    description: str | None = Field(default=None, min_length=1, max_length=500)
    vendor_id: str | None = None
    category_id: str | None = None
    payment_method: PaymentMethod | None = None
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None


class ExpenseDocumentRead(BaseModel):
    id: str
    expense_id: str
    title: str
    document_type: str
    original_filename: str
    content_type: str | None
    size_bytes: int
    notes: str | None
    uploaded_by_user_id: str
    created_at: datetime


class ExpenseListItem(BaseModel):
    id: str
    expense_number: str
    description: str
    expense_date: date
    vendor_id: str | None
    vendor_name: str | None
    category_id: str
    category_name: str
    cost_type: str
    account_id: str
    account_name: str
    client_id: str | None
    client_name: str | None
    project_id: str | None
    project_number: str | None
    project_name: str | None
    expense_currency: str
    expense_amount: Decimal
    account_currency: str
    account_amount: Decimal
    exchange_rate: Decimal
    profitability_currency: str
    profitability_amount: Decimal
    tax_amount: Decimal
    payment_method: str
    reference: str | None
    status: str
    document_count: int
    created_at: datetime


class ExpenseDetail(ExpenseListItem):
    profitability_exchange_rate: Decimal
    notes: str | None
    voided_at: datetime | None
    documents: list[ExpenseDocumentRead]


class ExpensePage(BaseModel):
    items: list[ExpenseListItem]


class ExpenseMetaAccount(BaseModel):
    id: str
    name: str
    currency: str
    current_balance: Decimal
    is_active: bool


class ExpenseMetaClient(BaseModel):
    id: str
    code: str
    name: str
    currency: str | None


class ExpenseMetaProject(BaseModel):
    id: str
    number: str
    name: str
    client_id: str
    client_name: str
    currency: str
    status: str


class ExpenseMeta(BaseModel):
    vendors: list[VendorRead]
    categories: list[ExpenseCategoryRead]
    accounts: list[ExpenseMetaAccount]
    clients: list[ExpenseMetaClient]
    projects: list[ExpenseMetaProject]


class ExpenseCurrencySummary(BaseModel):
    currency: str
    posted_expenses: Decimal
    transfer_fees: Decimal


class ExpenseSummary(BaseModel):
    expense_count: int
    posted_count: int
    voided_count: int
    vendor_count: int
    receipt_count: int
    project_expense_count: int
    by_currency: list[ExpenseCurrencySummary]


class ProfitLossCurrencyRow(BaseModel):
    currency: str
    invoice_revenue: Decimal
    operating_expenses: Decimal
    transfer_fees: Decimal
    net_profit: Decimal


class ProjectProfitabilityRow(BaseModel):
    project_id: str
    project_number: str
    project_name: str
    client_name: str
    currency: str
    contract_value: Decimal
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    direct_expenses: Decimal
    estimated_profit: Decimal
    margin_percent: Decimal | None


class ClientProfitabilityRow(BaseModel):
    client_id: str
    client_name: str
    currency: str
    invoiced_revenue: Decimal
    collected_revenue: Decimal
    direct_expenses: Decimal
    estimated_profit: Decimal
    margin_percent: Decimal | None


class ProfitabilityReport(BaseModel):
    profit_loss_by_currency: list[ProfitLossCurrencyRow]
    projects: list[ProjectProfitabilityRow]
    clients: list[ClientProfitabilityRow]
