from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


MONEY = Decimal("0.01")
HUNDRED = Decimal("100")


def _money(value: Decimal) -> Decimal:
    return value.quantize(MONEY, rounding=ROUND_HALF_UP)


@dataclass(frozen=True, slots=True)
class CalculatedLine:
    line_subtotal: Decimal
    discount_amount: Decimal
    taxable_amount: Decimal
    tax_amount: Decimal
    line_total: Decimal


@dataclass(frozen=True, slots=True)
class QuotationTotals:
    subtotal: Decimal
    discount_total: Decimal
    tax_total: Decimal
    total: Decimal


def calculate_line(
    *,
    quantity: Decimal,
    unit_price: Decimal,
    discount_percent: Decimal,
    tax_rate: Decimal,
    tax_calculation_mode: str,
) -> CalculatedLine:
    subtotal = _money(quantity * unit_price)
    discount = _money(subtotal * discount_percent / HUNDRED)
    taxable = _money(subtotal - discount)

    if tax_calculation_mode == "inclusive":
        if tax_rate > 0:
            net_without_tax = _money(taxable / (Decimal("1") + tax_rate / HUNDRED))
            tax = _money(taxable - net_without_tax)
        else:
            tax = Decimal("0.00")
        line_total = taxable
    else:
        tax = _money(taxable * tax_rate / HUNDRED)
        line_total = _money(taxable + tax)

    return CalculatedLine(
        line_subtotal=subtotal,
        discount_amount=discount,
        taxable_amount=taxable,
        tax_amount=tax,
        line_total=line_total,
    )


def calculate_totals(lines: list[CalculatedLine]) -> QuotationTotals:
    return QuotationTotals(
        subtotal=_money(sum((line.line_subtotal for line in lines), Decimal("0"))),
        discount_total=_money(sum((line.discount_amount for line in lines), Decimal("0"))),
        tax_total=_money(sum((line.tax_amount for line in lines), Decimal("0"))),
        total=_money(sum((line.line_total for line in lines), Decimal("0"))),
    )
