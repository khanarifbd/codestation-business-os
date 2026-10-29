"""Inventory obligations share the payable subledger, not a second expense posting."""
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.inventory import PurchaseReceipt
from app.models.payables import PayableBill


def create_purchase_payable(db: Session, receipt: PurchaseReceipt, inventory_account_id: str) -> PayableBill:
    bill = PayableBill(
        organization_id=receipt.organization_id,
        purchase_receipt_id=receipt.id,
        bill_number=receipt.receipt_number,
        vendor_id=receipt.vendor_id,
        supplier_name=receipt.supplier_name,
        bill_date=receipt.receipt_date,
        currency=receipt.currency,
        subtotal_amount=receipt.subtotal,
        input_tax_amount=receipt.tax_total,
        recoverable_tax_amount=receipt.recoverable_tax_total,
        withholding_tax_amount=Decimal("0"),
        original_amount=receipt.total,
        net_payable_amount=receipt.total,
        amount_paid=receipt.amount_paid,
        balance_due=receipt.balance_due,
        expense_ledger_account_id=inventory_account_id,
        description=f"Inventory purchase {receipt.receipt_number}",
        reference=receipt.reference,
        notes=receipt.notes,
        status="paid" if receipt.balance_due == 0 else "partially_paid" if receipt.amount_paid > 0 else "open",
        created_by_user_id=receipt.created_by_user_id,
    )
    db.add(bill)
    db.flush()
    return bill


def sync_purchase_settlement(db: Session, bill: PayableBill) -> None:
    if not bill.purchase_receipt_id:
        return
    receipt = db.scalar(select(PurchaseReceipt).where(
        PurchaseReceipt.id == bill.purchase_receipt_id,
        PurchaseReceipt.organization_id == bill.organization_id,
    ).with_for_update())
    if receipt is None:
        raise ValueError("Linked inventory purchase receipt is missing")
    receipt.amount_paid = bill.amount_paid
    receipt.balance_due = bill.balance_due
    # Receipt status describes receipt of stock, not the payment lifecycle.
