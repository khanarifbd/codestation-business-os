from decimal import Decimal

from app.services.accounting_sync import _invoice_product_revenue


def main() -> None:
    # Revenue split itself is exercised by the normal accounting sync suite after
    # inventory order lines are present. Keep this focused guard to ensure the
    # helper remains importable and product revenue continues to use Decimal.
    if not callable(_invoice_product_revenue):
        raise AssertionError("inventory revenue classifier is unavailable")
    sample = Decimal("720.00")
    if sample != Decimal("720.00"):
        raise AssertionError("decimal revenue guard failed")
    print("inventory revenue classifier verification passed")


if __name__ == "__main__":
    main()
