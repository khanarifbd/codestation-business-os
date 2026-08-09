"""add payables

Revision ID: 0031_payables
Revises: 0030_accounting_money_entries
Create Date: 2026-08-09
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0031_payables"
down_revision: str | None = "0030_accounting_money_entries"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "payable_bills",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bill_number", sa.String(40), nullable=False),
        sa.Column("vendor_id", sa.String(36), sa.ForeignKey("vendors.id", ondelete="SET NULL")),
        sa.Column("supplier_name", sa.String(220), nullable=False),
        sa.Column("bill_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date()),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("original_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("balance_due", sa.Numeric(18, 2), nullable=False),
        sa.Column("expense_ledger_account_id", sa.String(36), sa.ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "bill_number", name="uq_payable_bills_org_number"),
    )
    op.create_index("ix_payable_bills_org_status_due", "payable_bills", ["organization_id", "status", "due_date"])
    op.create_index("ix_payable_bills_org_supplier_date", "payable_bills", ["organization_id", "supplier_name", "bill_date"])

    op.create_table(
        "payable_payments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bill_id", sa.String(36), sa.ForeignKey("payable_bills.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("financial_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_payable_payments_org_bill_date", "payable_payments", ["organization_id", "bill_id", "payment_date"])


def downgrade() -> None:
    op.drop_index("ix_payable_payments_org_bill_date", table_name="payable_payments")
    op.drop_table("payable_payments")
    op.drop_index("ix_payable_bills_org_supplier_date", table_name="payable_bills")
    op.drop_index("ix_payable_bills_org_status_due", table_name="payable_bills")
    op.drop_table("payable_bills")
