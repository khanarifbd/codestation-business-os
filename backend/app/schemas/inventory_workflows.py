from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator


class InventoryTransferCreate(BaseModel):
    product_id: str
    from_warehouse_id: str
    to_warehouse_id: str
    transfer_date: date
    quantity: Decimal = Field(gt=0)
    reason: str = Field(min_length=3, max_length=500)
    reference: str | None = Field(default=None, max_length=180)

    @model_validator(mode="after")
    def different_warehouses(self):
        if self.from_warehouse_id == self.to_warehouse_id:
            raise ValueError("Source and destination warehouses must be different")
        return self
