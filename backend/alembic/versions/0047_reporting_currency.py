"""separate reporting currency from accounting currency

Revision ID: 0047_reporting_currency
Revises: 0046_google_identity
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0047_reporting_currency"
down_revision: str | None = "0046_google_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "organization_financial_settings",
        sa.Column("reporting_currency", sa.String(length=3), nullable=False, server_default="BDT"),
    )
    op.execute(
        sa.text(
            """
            UPDATE organization_financial_settings
            SET reporting_currency = COALESCE(
                (
                    SELECT organizations.currency
                    FROM organizations
                    WHERE organizations.id = organization_financial_settings.organization_id
                ),
                accounting_currency,
                'BDT'
            )
            """
        )
    )


def downgrade() -> None:
    op.drop_column("organization_financial_settings", "reporting_currency")
