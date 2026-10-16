"""Optional explicit mapping from financial ledger accounts to connected gateways.

Revision ID: 0090_gateway_account_mapping
Revises: 0089_stripe_checkout
"""
from collections.abc import Sequence
from alembic import op
import sqlalchemy as sa

revision: str = "0090_gateway_account_mapping"
down_revision: str | None = "0089_stripe_checkout"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("financial_accounts", sa.Column("gateway_connection_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_financial_accounts_gateway_connection",
        "financial_accounts", "payment_gateway_connections",
        ["gateway_connection_id"], ["id"], ondelete="RESTRICT",
    )
    op.create_index(
        "uq_financial_accounts_gateway_currency", "financial_accounts",
        ["gateway_connection_id", "currency"], unique=True,
        postgresql_where=sa.text("gateway_connection_id IS NOT NULL"),
    )
    op.create_index(
        "ix_financial_accounts_org_gateway", "financial_accounts",
        ["organization_id", "gateway_connection_id"],
    )


def downgrade() -> None:
    op.drop_index("uq_financial_accounts_gateway_currency", table_name="financial_accounts")
    op.drop_index("ix_financial_accounts_org_gateway", table_name="financial_accounts")
    op.drop_constraint("fk_financial_accounts_gateway_connection", "financial_accounts", type_="foreignkey")
    op.drop_column("financial_accounts", "gateway_connection_id")
