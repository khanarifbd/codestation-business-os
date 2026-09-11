from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP


MONEY = Decimal("0.01")
HUNDRED = Decimal("100")


def money(value: Decimal) -> Decimal:
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
    subtotal = money(quantity * unit_price)
    discount = money(subtotal * discount_percent / HUNDRED)
    taxable = money(subtotal - discount)

    if tax_calculation_mode == "inclusive":
        if tax_rate > 0:
            net_without_tax = money(taxable / (Decimal("1") + tax_rate / HUNDRED))
            tax = money(taxable - net_without_tax)
        else:
            tax = Decimal("0.00")
        line_total = taxable
    else:
        tax = money(taxable * tax_rate / HUNDRED)
        line_total = money(taxable + tax)

    return CalculatedLine(
        line_subtotal=subtotal,
        discount_amount=discount,
        taxable_amount=taxable,
        tax_amount=tax,
        line_total=line_total,
    )


def calculate_totals(lines: list[CalculatedLine]) -> QuotationTotals:
    return QuotationTotals(
        subtotal=money(sum((line.line_subtotal for line in lines), Decimal("0"))),
        discount_total=money(sum((line.discount_amount for line in lines), Decimal("0"))),
        tax_total=money(sum((line.tax_amount for line in lines), Decimal("0"))),
        total=money(sum((line.line_total for line in lines), Decimal("0"))),
    )


def calculate_payment_amount(
    *,
    quotation_total: Decimal,
    payment_type: str,
    percentage: Decimal | None,
    amount: Decimal | None,
) -> Decimal:
    if payment_type == "percentage":
        if percentage is None:
            raise ValueError("Percentage is required for percentage payment schedule entries")
        return money(quotation_total * percentage / HUNDRED)
    if payment_type == "fixed":
        if amount is None:
            raise ValueError("Amount is required for fixed payment schedule entries")
        return money(amount)
    raise ValueError(f"Unsupported payment schedule type: {payment_type}")
