"""add effective-dated functional currency periods

Revision ID: 0048_functional_currency_periods
Revises: 0047_reporting_currency
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0048_functional_currency_periods"
down_revision: str | None = "0047_reporting_currency"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Every journal owns the functional/base currency in which its debit/credit
    # amounts were posted. This makes historical journals independent from the
    # organization's current functional currency.
    op.add_column(
        "journal_entries",
        sa.Column("functional_currency", sa.String(length=3), nullable=False, server_default="BDT"),
    )
    op.execute(
        sa.text(
            """
            UPDATE journal_entries
            SET functional_currency = COALESCE(
                (
                    SELECT organizations.currency
                    FROM organizations
                    WHERE organizations.id = journal_entries.organization_id
                ),
                'BDT'
            )
            """
        )
    )
    op.create_index(
        "ix_journal_entries_org_functional_date",
        "journal_entries",
        ["organization_id", "functional_currency", "entry_date"],
        unique=False,
    )

    op.create_table(
        "organization_functional_currency_periods",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(length=36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("previous_currency", sa.String(length=3), nullable=True),
        sa.Column("transition_rate", sa.Numeric(18, 8), nullable=True),
        sa.Column("reason", sa.String(length=500), nullable=True),
        sa.Column(
            "transition_journal_entry_id",
            sa.String(length=36),
            sa.ForeignKey("journal_entries.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "changed_by_user_id",
            sa.String(length=36),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint(
            "organization_id",
            "effective_from",
            name="uq_org_functional_currency_period_start",
        ),
    )
    op.create_index(
        "ix_organization_functional_currency_periods_organization_id",
        "organization_functional_currency_periods",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_org_functional_currency_period_range",
        "organization_functional_currency_periods",
        ["organization_id", "effective_from", "effective_to"],
        unique=False,
    )

    # Existing organizations have never been allowed to change accounting
    # currency after a posted journal. Therefore one initial period safely
    # represents all existing history. 1900-01-01 intentionally supports
    # imported/backdated opening data without pretending it is the company
    # incorporation date. The organization UUID is safe to reuse as the initial
    # period UUID because it belongs to a different table/primary-key namespace.
    op.execute(
        sa.text(
            """
            INSERT INTO organization_functional_currency_periods
                (id, organization_id, currency, effective_from, effective_to,
                 previous_currency, transition_rate, reason,
                 transition_journal_entry_id, changed_by_user_id, created_at)
            SELECT
                organizations.id,
                organizations.id,
                organizations.currency,
                '1900-01-01',
                NULL,
                NULL,
                NULL,
                'Initial functional currency migrated from organization settings',
                NULL,
                organizations.created_by_user_id,
                CURRENT_TIMESTAMP
            FROM organizations
            WHERE NOT EXISTS (
                SELECT 1
                FROM organization_functional_currency_periods periods
                WHERE periods.organization_id = organizations.id
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_index(
        "ix_org_functional_currency_period_range",
        table_name="organization_functional_currency_periods",
    )
    op.drop_index(
        "ix_organization_functional_currency_periods_organization_id",
        table_name="organization_functional_currency_periods",
    )
    op.drop_table("organization_functional_currency_periods")
    op.drop_index("ix_journal_entries_org_functional_date", table_name="journal_entries")
    op.drop_column("journal_entries", "functional_currency")
