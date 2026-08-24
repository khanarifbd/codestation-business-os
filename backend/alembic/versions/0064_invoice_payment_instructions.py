"""add invoice payment instruction snapshots

Revision ID: 0064_invoice_payments
Revises: 0063_session_device_id
Create Date: 2026-08-24
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0064_invoice_payments"
down_revision: str | None = "0063_session_device_id"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("financial_accounts", sa.Column("payment_url", sa.String(length=1000), nullable=True))
    op.add_column("financial_accounts", sa.Column("payment_instructions", sa.Text(), nullable=True))

    op.add_column("invoices", sa.Column("payment_method", sa.String(length=40), nullable=True))
    op.add_column("invoices", sa.Column("payment_account_id", sa.String(length=36), nullable=True))
    op.add_column("invoices", sa.Column("payment_account_name_snapshot", sa.String(length=180), nullable=True))
    op.add_column("invoices", sa.Column("payment_provider_snapshot", sa.String(length=120), nullable=True))
    op.add_column("invoices", sa.Column("payment_account_holder_snapshot", sa.String(length=180), nullable=True))
    op.add_column("invoices", sa.Column("payment_account_reference_snapshot", sa.String(length=180), nullable=True))
    op.add_column("invoices", sa.Column("payment_currency_snapshot", sa.String(length=3), nullable=True))
    op.add_column("invoices", sa.Column("payment_url_snapshot", sa.String(length=1000), nullable=True))
    op.add_column("invoices", sa.Column("payment_instructions_snapshot", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_invoices_payment_account",
        "invoices",
        "financial_accounts",
        ["payment_account_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_invoices_org_payment_account",
        "invoices",
        ["organization_id", "payment_account_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_invoices_org_payment_account", table_name="invoices")
    op.drop_constraint("fk_invoices_payment_account", "invoices", type_="foreignkey")
    op.drop_column("invoices", "payment_instructions_snapshot")
    op.drop_column("invoices", "payment_url_snapshot")
    op.drop_column("invoices", "payment_currency_snapshot")
    op.drop_column("invoices", "payment_account_reference_snapshot")
    op.drop_column("invoices", "payment_account_holder_snapshot")
    op.drop_column("invoices", "payment_provider_snapshot")
    op.drop_column("invoices", "payment_account_name_snapshot")
    op.drop_column("invoices", "payment_account_id")
    op.drop_column("invoices", "payment_method")
    op.drop_column("financial_accounts", "payment_instructions")
    op.drop_column("financial_accounts", "payment_url")
