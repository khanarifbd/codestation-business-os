"""harden financial corrections

Revision ID: 0084_corrections
Revises: 0083_payroll_withholding
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0084_corrections"
down_revision: str | None = "0083_payroll_withholding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("uq_payroll_runs_org_period_currency", "payroll_runs", type_="unique")
    op.create_index(
        "ix_payroll_runs_org_period_currency",
        "payroll_runs",
        ["organization_id", "period_id", "currency"],
    )

    op.add_column(
        "asset_depreciation_entries",
        sa.Column("status", sa.String(length=16), nullable=False, server_default="posted"),
    )
    op.drop_constraint("uq_asset_depreciation_period", "asset_depreciation_entries", type_="unique")
    op.create_index(
        "ix_asset_depreciation_org_asset_period_status",
        "asset_depreciation_entries",
        ["organization_id", "asset_id", "period_date", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_asset_depreciation_org_asset_period_status", table_name="asset_depreciation_entries")
    op.create_unique_constraint(
        "uq_asset_depreciation_period",
        "asset_depreciation_entries",
        ["organization_id", "asset_id", "period_date"],
    )
    op.drop_column("asset_depreciation_entries", "status")

    op.drop_index("ix_payroll_runs_org_period_currency", table_name="payroll_runs")
    op.create_unique_constraint(
        "uq_payroll_runs_org_period_currency",
        "payroll_runs",
        ["organization_id", "period_id", "currency"],
    )
