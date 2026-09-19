"""track fixed asset opening balance basis

Revision ID: 0080_fixed_asset_opening_basis
Revises: 0079_loan_fee_repayment_link
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0080_fixed_asset_opening_basis"
down_revision: str | None = "0079_loan_fee_repayment_link"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "fixed_assets",
        sa.Column("opening_accumulated_depreciation", sa.Numeric(18, 2), nullable=False, server_default="0"),
    )
    op.add_column(
        "fixed_assets",
        sa.Column("record_mode", sa.String(length=16), nullable=False, server_default="purchase"),
    )
    op.add_column(
        "fixed_assets",
        sa.Column("opening_balance_date", sa.Date(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("fixed_assets", "opening_balance_date")
    op.drop_column("fixed_assets", "record_mode")
    op.drop_column("fixed_assets", "opening_accumulated_depreciation")
