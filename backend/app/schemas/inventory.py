from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, ValidationInfo, field_validator, model_validator


ItemType = Literal["stock_item", "non_stock_item", "service"]


class InventoryRequiredText(BaseModel):
    """Normalize required catalog labels before their existing length constraints."""

    @field_validator("name", "code", "sku", "unit", "currency", mode="before", check_fields=False)
    @classmethod
    def trim_required_text(cls, value, info: ValidationInfo):
        if isinstance(value, str):
            value = value.strip()
            if info.field_name == "currency":
                value = value.upper()
        return value


class CategoryCreate(InventoryRequiredText):
    name: str = Field(min_length=1, max_length=160)
    description: str | None = None


class WarehouseCreate(InventoryRequiredText):
    code: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=180)
    address: str | None = None
    is_default: bool = False


class ProductCreate(InventoryRequiredText):
    sku: str = Field(min_length=1, max_length=80)
    barcode: str | None = Field(default=None, max_length=120)
    name: str = Field(min_length=1, max_length=220)
    description: str | None = None
    item_type: ItemType = "stock_item"
    category_id: str | None = None
    unit: str = Field(default="unit", min_length=1, max_length=40)
    currency: str = Field(min_length=3, max_length=3)
    selling_price: Decimal = Field(default=0, ge=0)
    standard_cost: Decimal = Field(default=0, ge=0)
    reorder_level: Decimal = Field(default=0, ge=0)
    tax_code_id: str | None = None
    track_inventory: bool | None = None
    allow_negative_stock: bool = False

    @model_validator(mode="after")
    def normalize_tracking(self):
        if self.item_type == "stock_item":
            if self.track_inventory is False:
                raise ValueError("Stock products must track inventory. Use non_stock_item when stock tracking is not required.")
            self.track_inventory = True
        else:
            self.track_inventory = False
            self.allow_negative_stock = False
            self.reorder_level = Decimal("0")
        return self


class PurchaseLineInput(BaseModel):
    product_id: str
    quantity: Decimal = Field(gt=0)
    unit_cost: Decimal = Field(ge=0)
    tax_code_id: str | None = None

    @model_validator(mode="after")
    def positive_stored_quantity(self):
        # Match four-decimal HALF_UP zero floor without changing input precision.
        if self.quantity < Decimal("0.00005"):
            raise ValueError("Purchase quantity must be at least 0.0001 after rounding")
        return self


class PurchaseReceiptCreate(BaseModel):
    supplier_name: str = Field(min_length=1, max_length=220)
    vendor_id: str | None = None
    warehouse_id: str
    receipt_date: date
    currency: str = Field(min_length=3, max_length=3)
    reference: str | None = Field(default=None, max_length=180)
    notes: str | None = None
    items: list[PurchaseLineInput] = Field(min_length=1, max_length=200)


class AdjustmentCreate(BaseModel):
    product_id: str
    warehouse_id: str
    adjustment_date: date
    quantity_delta: Decimal
    reason: str = Field(min_length=3, max_length=500)
    unit_cost: Decimal | None = Field(default=None, ge=0)
    reference: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def non_zero(self):
        # Both signs below half a storage unit become zero with HALF_UP.
        if -Decimal("0.00005") < self.quantity_delta < Decimal("0.00005"):
            raise ValueError("Adjustment quantity cannot be zero")
        return self
