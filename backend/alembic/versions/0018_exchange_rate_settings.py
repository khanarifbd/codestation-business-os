"""add global exchange rate settings

Revision ID: 0018_exchange_rate_settings
Revises: 0017_expenses_profitability
Create Date: 2026-08-08
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0018_exchange_rate_settings"
down_revision: str | None = "0017_expenses_profitability"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("organization_system_defaults", sa.Column("exchange_rate_mode", sa.String(32), nullable=False, server_default="automatic"))
    op.add_column("organization_system_defaults", sa.Column("exchange_rate_provider", sa.String(64), nullable=False, server_default="frankfurter"))
    op.add_column("organization_system_defaults", sa.Column("exchange_rate_adjustment_percent", sa.Numeric(10, 4), nullable=False, server_default="0"))
    op.add_column("organization_system_defaults", sa.Column("exchange_rate_sync_frequency", sa.String(16), nullable=False, server_default="daily"))
    op.add_column("organization_system_defaults", sa.Column("exchange_rate_last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "organization_exchange_rates",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("base_currency", sa.String(3), nullable=False),
        sa.Column("quote_currency", sa.String(3), nullable=False),
        sa.Column("reference_rate", sa.Numeric(24, 10), nullable=True),
        sa.Column("manual_rate", sa.Numeric(24, 10), nullable=True),
        sa.Column("effective_rate", sa.Numeric(24, 10), nullable=False),
        sa.Column("source", sa.String(64), nullable=False, server_default="manual"),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("organization_id", "base_currency", "quote_currency", name="uq_org_exchange_rate_pair"),
        sa.CheckConstraint("base_currency <> quote_currency", name="ck_exchange_rate_distinct_pair"),
        sa.CheckConstraint("effective_rate > 0", name="ck_exchange_rate_positive"),
    )
    op.create_index("ix_exchange_rates_org_pair", "organization_exchange_rates", ["organization_id", "base_currency", "quote_currency"])


def downgrade() -> None:
    op.drop_index("ix_exchange_rates_org_pair", table_name="organization_exchange_rates")
    op.drop_table("organization_exchange_rates")
    op.drop_column("organization_system_defaults", "exchange_rate_last_synced_at")
    op.drop_column("organization_system_defaults", "exchange_rate_sync_frequency")
    op.drop_column("organization_system_defaults", "exchange_rate_adjustment_percent")
    op.drop_column("organization_system_defaults", "exchange_rate_provider")
    op.drop_column("organization_system_defaults", "exchange_rate_mode")
