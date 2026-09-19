"""add tax settlements

Revision ID: 0081_tax_settlements
Revises: 0080_fixed_asset_opening_basis
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0081_tax_settlements"
down_revision: str | None = "0080_fixed_asset_opening_basis"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "tax_settlements",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("settlement_type", sa.String(length=32), nullable=False),
        sa.Column("settlement_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=True),
        sa.Column("reference", sa.String(length=180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tax_settlements_organization_id", "tax_settlements", ["organization_id"])
    op.create_index("ix_tax_settlements_org_date", "tax_settlements", ["organization_id", "settlement_date"])
    op.create_index("ix_tax_settlements_org_type_date", "tax_settlements", ["organization_id", "settlement_type", "settlement_date"])


def downgrade() -> None:
    op.drop_index("ix_tax_settlements_org_type_date", table_name="tax_settlements")
    op.drop_index("ix_tax_settlements_org_date", table_name="tax_settlements")
    op.drop_index("ix_tax_settlements_organization_id", table_name="tax_settlements")
    op.drop_table("tax_settlements")
