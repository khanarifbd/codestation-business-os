from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, Field, model_validator


ItemType = Literal["stock_item", "non_stock_item", "service"]


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = None
    is_active: bool | None = None


class WarehouseUpdate(BaseModel):
    code: str | None = Field(default=None, min_length=1, max_length=40)
    name: str | None = Field(default=None, min_length=1, max_length=180)
    address: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class ProductUpdate(BaseModel):
    sku: str | None = Field(default=None, min_length=1, max_length=80)
    barcode: str | None = Field(default=None, max_length=120)
    name: str | None = Field(default=None, min_length=1, max_length=220)
    description: str | None = None
    item_type: ItemType | None = None
    category_id: str | None = None
    unit: str | None = Field(default=None, min_length=1, max_length=40)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    selling_price: Decimal | None = Field(default=None, ge=0)
    standard_cost: Decimal | None = Field(default=None, ge=0)
    reorder_level: Decimal | None = Field(default=None, ge=0)
    tax_code_id: str | None = None
    track_inventory: bool | None = None
    allow_negative_stock: bool | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def normalize_tracking(self):
        if self.item_type is not None and self.item_type != "stock_item":
            self.track_inventory = False
            self.allow_negative_stock = False
            self.reorder_level = Decimal("0")
        elif self.item_type == "stock_item" and self.track_inventory is False:
            raise ValueError("Stock products must track inventory. Use non_stock_item when stock tracking is not required.")
        elif self.item_type == "stock_item":
            self.track_inventory = True
        elif self.track_inventory is False:
            raise ValueError("Stock products cannot disable inventory tracking. Change the item type to non_stock_item instead.")
        return self


class SupplierCreate(BaseModel):
    name: str = Field(min_length=1, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=80)
    website: str | None = Field(default=None, max_length=1000)
    tax_identifier: str | None = Field(default=None, max_length=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = None


class SupplierUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=220)
    contact_name: str | None = Field(default=None, max_length=180)
    email: str | None = Field(default=None, max_length=320)
    phone: str | None = Field(default=None, max_length=80)
    website: str | None = Field(default=None, max_length=1000)
    tax_identifier: str | None = Field(default=None, max_length=180)
    country_code: str | None = Field(default=None, min_length=2, max_length=2)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    notes: str | None = None
    is_active: bool | None = None
