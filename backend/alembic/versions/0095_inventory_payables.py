"""Link inventory obligations to the settlement-capable payable subledger.

Revision ID: 0095_inventory_payables
Revises: 0094_hr_gps_attendance
"""
from alembic import op
import sqlalchemy as sa

revision = "0095_inventory_payables"
down_revision = "0094_hr_gps_attendance"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("payable_bills", sa.Column("purchase_receipt_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_payable_purchase_receipt", "payable_bills", "purchase_receipts", ["purchase_receipt_id"], ["id"], ondelete="RESTRICT")
    op.create_unique_constraint("uq_payable_purchase_receipt", "payable_bills", ["purchase_receipt_id"])
    # Preserve the original receipt journal and balances. Never post another AP or expense.
    op.execute("""
        INSERT INTO payable_bills (
            id, organization_id, purchase_receipt_id, bill_number, vendor_id,
            supplier_name, bill_date, currency, subtotal_amount, input_tax_amount,
            recoverable_tax_amount, withholding_tax_amount, original_amount,
            net_payable_amount, amount_paid, balance_due, expense_ledger_account_id,
            description, reference, notes, status, created_by_user_id, created_at, updated_at
        )
        SELECT r.id, r.organization_id, r.id, r.receipt_number, r.vendor_id,
            r.supplier_name, r.receipt_date, r.currency, r.subtotal, r.tax_total,
            r.recoverable_tax_total, 0, r.total, r.total, r.amount_paid, r.balance_due,
            a.id, 'Inventory purchase ' || r.receipt_number, r.reference, r.notes,
            CASE WHEN r.balance_due = 0 THEN 'paid' WHEN r.amount_paid > 0 THEN 'partially_paid' ELSE 'open' END,
            r.created_by_user_id, r.created_at, r.created_at
        FROM purchase_receipts r
        JOIN ledger_accounts a ON a.organization_id = r.organization_id AND a.system_key = 'inventory_asset'
        WHERE r.status != 'cancelled'
    """)


def downgrade() -> None:
    # A used subledger must not be silently discarded by schema rollback.
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM payable_payments p JOIN payable_bills b ON b.id = p.bill_id WHERE b.purchase_receipt_id IS NOT NULL)
        THEN RAISE EXCEPTION 'Inventory payables have payments; rollback requires an explicit data migration'; END IF;
    END $$""")
    op.execute("DELETE FROM payable_bills WHERE purchase_receipt_id IS NOT NULL")
    op.drop_constraint("uq_payable_purchase_receipt", "payable_bills", type_="unique")
    op.drop_constraint("fk_payable_purchase_receipt", "payable_bills", type_="foreignkey")
    op.drop_column("payable_bills", "purchase_receipt_id")
