"""add historical FX rates and protect financial-account ledgers

Revision ID: 0051_fx_history_and_gl_integrity
Revises: 0050_user_avatar
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0051_fx_history_and_gl_integrity"
down_revision: str | None = "0050_user_avatar"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organization_exchange_rate_history",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("base_currency", sa.String(length=3), nullable=False),
        sa.Column("quote_currency", sa.String(length=3), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=False),
        sa.Column("reference_rate", sa.Numeric(precision=24, scale=10), nullable=True),
        sa.Column("effective_rate", sa.Numeric(precision=24, scale=10), nullable=False),
        sa.Column("source", sa.String(length=64), nullable=False),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("base_currency <> quote_currency", name="ck_exchange_rate_history_distinct_pair"),
        sa.CheckConstraint("effective_rate > 0", name="ck_exchange_rate_history_positive"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "base_currency",
            "quote_currency",
            "effective_date",
            name="uq_org_exchange_rate_history_date",
        ),
    )
    op.create_index(
        "ix_org_exchange_rate_history_lookup",
        "organization_exchange_rate_history",
        ["organization_id", "base_currency", "quote_currency", "effective_date"],
        unique=False,
    )

    # Preserve existing current pairs as dated baseline snapshots. We deliberately
    # use the date the pair was created/updated instead of pretending today's rate
    # was valid for all historical dates.
    op.execute(
        """
        INSERT INTO organization_exchange_rate_history (
            id, organization_id, base_currency, quote_currency, effective_date,
            reference_rate, effective_rate, source, created_by_user_id, created_at, updated_at
        )
        SELECT
            md5(oer.id || ':history')::text,
            oer.organization_id,
            oer.base_currency,
            oer.quote_currency,
            COALESCE(oer.synced_at::date, oer.updated_at::date, oer.created_at::date, CURRENT_DATE),
            oer.reference_rate,
            oer.effective_rate,
            CASE WHEN oer.source = 'manual' THEN 'manual_legacy' ELSE oer.source || '_legacy' END,
            NULL,
            COALESCE(oer.updated_at, oer.created_at, NOW()),
            COALESCE(oer.updated_at, oer.created_at, NOW())
        FROM organization_exchange_rates oer
        ON CONFLICT (organization_id, base_currency, quote_currency, effective_date) DO NOTHING
        """
    )

    # A financial account's operational balance and its mapped GL cash/bank balance
    # must never diverge because of a manual journal. All financial-account ledgers
    # are adjusted only through flows that also create FinancialTransaction rows.
    op.execute(
        """
        UPDATE ledger_accounts
        SET allow_manual_posting = FALSE
        WHERE system_key LIKE 'financial_account:%'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE ledger_accounts
        SET allow_manual_posting = TRUE
        WHERE system_key LIKE 'financial_account:%'
        """
    )
    op.drop_index("ix_org_exchange_rate_history_lookup", table_name="organization_exchange_rate_history")
    op.drop_table("organization_exchange_rate_history")
