"""classify accounting money expenses with business expense metadata

Revision ID: 0072_money_expense_classify
Revises: 0071_order_billing_invoice_links
Create Date: 2026-09-11
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0072_money_expense_classify"
down_revision: str | None = "0071_order_billing_invoice_links"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("accounting_money_entries", sa.Column("expense_category_id", sa.String(36), nullable=True))
    op.add_column("accounting_money_entries", sa.Column("vendor_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_accounting_money_entries_expense_category",
        "accounting_money_entries",
        "expense_categories",
        ["expense_category_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_accounting_money_entries_vendor",
        "accounting_money_entries",
        "vendors",
        ["vendor_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_accounting_money_entries_org_expense_category",
        "accounting_money_entries",
        ["organization_id", "expense_category_id"],
    )
    op.create_index(
        "ix_accounting_money_entries_org_vendor",
        "accounting_money_entries",
        ["organization_id", "vendor_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_accounting_money_entries_org_vendor", table_name="accounting_money_entries")
    op.drop_index("ix_accounting_money_entries_org_expense_category", table_name="accounting_money_entries")
    op.drop_constraint("fk_accounting_money_entries_vendor", "accounting_money_entries", type_="foreignkey")
    op.drop_constraint("fk_accounting_money_entries_expense_category", "accounting_money_entries", type_="foreignkey")
    op.drop_column("accounting_money_entries", "vendor_id")
    op.drop_column("accounting_money_entries", "expense_category_id")
