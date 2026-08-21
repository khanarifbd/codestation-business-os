from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class OrderSettlementCreate(BaseModel):
    account_id: str
    settlement_date: date | None = None
    expense_amount: Decimal = Field(default=Decimal("0"), ge=0, max_digits=18, decimal_places=2)
    expense_category_id: str | None = None
    expense_description: str | None = Field(default=None, max_length=500)
    mark_invoice_sent_to_client: bool = False
    reference: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def validate_expense(self):
        if self.expense_amount > 0 and not self.expense_category_id:
            raise ValueError("Select an expense category when an expense amount is entered")
        return self


class OrderSettlementAccountOption(BaseModel):
    id: str
    name: str
    account_type: str
    currency: str
    current_balance: Decimal


class OrderSettlementCategoryOption(BaseModel):
    id: str
    name: str
    cost_type: str


class OrderSettlementMeta(BaseModel):
    order_id: str
    order_number: str
    currency: str
    total: Decimal
    accounts: list[OrderSettlementAccountOption]
    expense_categories: list[OrderSettlementCategoryOption]


class OrderSettlementExpenseRead(BaseModel):
    id: str
    expense_number: str
    category_name: str
    amount: Decimal
    currency: str


class OrderSettlementState(BaseModel):
    order_id: str
    eligible: bool
    reason: str | None = None
    invoice_id: str | None = None
    invoice_number: str | None = None
    invoice_status: str | None = None
    invoice_total: Decimal | None = None
    invoice_amount_paid: Decimal | None = None
    invoice_balance_due: Decimal | None = None
    invoice_sent_to_client: bool = False
    payment_id: str | None = None
    payment_number: str | None = None
    account_id: str | None = None
    account_name: str | None = None
    gross_amount: Decimal | None = None
    currency: str | None = None
    expenses: list[OrderSettlementExpenseRead] = Field(default_factory=list)


class OrderSettlementRead(BaseModel):
    order_id: str
    order_number: str
    project_id: str | None
    invoice_id: str
    invoice_number: str
    payment_id: str
    payment_number: str
    expense_id: str | None
    expense_number: str | None
    account_id: str
    account_name: str
    currency: str
    gross_amount: Decimal
    expense_amount: Decimal
    net_amount: Decimal
    settlement_date: date
    invoice_sent_to_client: bool
