from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select

from app.models.inventory import Product
from app.models.tax import TaxCode


CUSTOM_ITEM_TYPES = {"service", "non_stock_item"}


@dataclass(frozen=True)
class SalesLineSnapshot:
    product_id: str | None
    item_name: str
    sku: str | None
    item_type: str
    unit: str
    description: str
    suggested_unit_price: Decimal | None
    suggested_tax_rate: Decimal | None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _fallback_name(description: str) -> str:
    value = description.strip().splitlines()[0].strip()
    if not value:
        raise HTTPException(status_code=400, detail="Line name or description is required")
    return value[:220]


def resolve_sales_line(
    db,
    *,
    organization_id: str,
    currency: str,
    product_id: str | None,
    item_name: str | None,
    item_type: str | None,
    unit: str | None,
    description: str,
) -> SalesLineSnapshot:
    document_currency = currency.upper()
    clean_description = description.strip()
    if not clean_description:
        raise HTTPException(status_code=400, detail="Line description is required")

    if product_id:
        product = db.scalar(
            select(Product).where(
                Product.id == product_id,
                Product.organization_id == organization_id,
                Product.is_active.is_(True),
            )
        )
        if product is None:
            raise HTTPException(status_code=404, detail="Active catalog product or service not found")
        if product.currency.upper() != document_currency:
            raise HTTPException(
                status_code=400,
                detail=f"Catalog item {product.sku} uses {product.currency}; document uses {document_currency}",
            )
        tax_rate = None
        if product.tax_code_id:
            tax_rate = db.scalar(
                select(TaxCode.rate).where(
                    TaxCode.id == product.tax_code_id,
                    TaxCode.organization_id == organization_id,
                    TaxCode.tax_kind == "sales",
                    TaxCode.is_active.is_(True),
                )
            )
        return SalesLineSnapshot(
            product_id=product.id,
            item_name=product.name,
            sku=product.sku,
            item_type=product.item_type,
            unit=product.unit,
            description=clean_description,
            suggested_unit_price=Decimal(product.selling_price),
            suggested_tax_rate=Decimal(tax_rate) if tax_rate is not None else None,
        )

    custom_type = (item_type or "service").strip().lower()
    if custom_type not in CUSTOM_ITEM_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Custom sales lines can be service or non-stock item. Stock items must be selected from the catalog.",
        )
    clean_name = _clean(item_name) or _fallback_name(clean_description)
    clean_unit = _clean(unit) or "unit"
    return SalesLineSnapshot(
        product_id=None,
        item_name=clean_name[:220],
        sku=None,
        item_type=custom_type,
        unit=clean_unit[:40],
        description=clean_description,
        suggested_unit_price=None,
        suggested_tax_rate=None,
    )
