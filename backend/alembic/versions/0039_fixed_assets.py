"""add fixed asset register and depreciation

Revision ID: 0039_fixed_assets
Revises: 0038_bank_reconciliation
"""

import sqlalchemy as sa
from alembic import op

revision = "0039_fixed_assets"
down_revision = "0038_bank_reconciliation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fixed_assets",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("asset_code", sa.String(length=50), nullable=False),
        sa.Column("name", sa.String(length=220), nullable=False),
        sa.Column("category", sa.String(length=80), nullable=False, server_default="equipment"),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("acquisition_cost", sa.Numeric(18,2), nullable=False),
        sa.Column("salvage_value", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("accumulated_depreciation", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("acquisition_date", sa.Date(), nullable=False),
        sa.Column("in_service_date", sa.Date(), nullable=False),
        sa.Column("useful_life_months", sa.Integer(), nullable=False),
        sa.Column("depreciation_method", sa.String(length=32), nullable=False, server_default="straight_line"),
        sa.Column("purchase_account_id", sa.String(length=36), nullable=True),
        sa.Column("reference", sa.String(length=180), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"],["organizations.id"],ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["purchase_account_id"],["financial_accounts.id"],ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"],["users.id"],ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id","asset_code",name="uq_fixed_assets_org_code"),
    )
    op.create_index("ix_fixed_assets_organization_id","fixed_assets",["organization_id"])
    op.create_index("ix_fixed_assets_org_status","fixed_assets",["organization_id","status"])
    op.create_index("ix_fixed_assets_org_in_service","fixed_assets",["organization_id","in_service_date"])

    op.create_table(
        "asset_depreciation_entries",
        sa.Column("id",sa.String(length=36),nullable=False),
        sa.Column("organization_id",sa.String(length=36),nullable=False),
        sa.Column("asset_id",sa.String(length=36),nullable=False),
        sa.Column("period_date",sa.Date(),nullable=False),
        sa.Column("amount",sa.Numeric(18,2),nullable=False),
        sa.Column("journal_entry_id",sa.String(length=36),nullable=False),
        sa.Column("created_by_user_id",sa.String(length=36),nullable=False),
        sa.Column("created_at",sa.DateTime(timezone=True),nullable=False),
        sa.ForeignKeyConstraint(["organization_id"],["organizations.id"],ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["asset_id"],["fixed_assets.id"],ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["journal_entry_id"],["journal_entries.id"],ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"],["users.id"],ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id","asset_id","period_date",name="uq_asset_depreciation_period"),
    )
    op.create_index("ix_asset_depreciation_entries_organization_id","asset_depreciation_entries",["organization_id"])
    op.create_index("ix_asset_depreciation_org_period","asset_depreciation_entries",["organization_id","period_date"])


def downgrade() -> None:
    op.drop_index("ix_asset_depreciation_org_period",table_name="asset_depreciation_entries")
    op.drop_index("ix_asset_depreciation_entries_organization_id",table_name="asset_depreciation_entries")
    op.drop_table("asset_depreciation_entries")
    op.drop_index("ix_fixed_assets_org_in_service",table_name="fixed_assets")
    op.drop_index("ix_fixed_assets_org_status",table_name="fixed_assets")
    op.drop_index("ix_fixed_assets_organization_id",table_name="fixed_assets")
    op.drop_table("fixed_assets")
