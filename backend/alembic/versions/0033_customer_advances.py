"""add customer advances

Revision ID: 0033_customer_advances
Revises: 0032_accounting_money_sources
Create Date: 2026-08-09
"""
from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0033_customer_advances"
down_revision: str | None = "0032_accounting_money_sources"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "customer_advances",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_id", sa.String(36), sa.ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("financial_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("advance_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("original_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("remaining_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_customer_advances_org_client_date", "customer_advances", ["organization_id", "client_id", "advance_date"])
    op.create_index("ix_customer_advances_org_remaining", "customer_advances", ["organization_id", "remaining_amount"])

    op.create_table(
        "customer_advance_applications",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("advance_id", sa.String(36), sa.ForeignKey("customer_advances.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("invoice_id", sa.String(36), sa.ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("application_date", sa.Date(), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_customer_advance_apps_org_advance", "customer_advance_applications", ["organization_id", "advance_id", "application_date"])
    op.create_index("ix_customer_advance_apps_org_invoice", "customer_advance_applications", ["organization_id", "invoice_id"])

    bind = op.get_bind()
    organizations = bind.execute(sa.text("SELECT id FROM organizations ORDER BY created_at, id")).mappings().all()
    for org in organizations:
        existing = bind.execute(
            sa.text("SELECT id FROM ledger_accounts WHERE organization_id=:org AND system_key='customer_advances'"),
            {"org": org["id"]},
        ).first()
        if existing:
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO ledger_accounts
                (id, organization_id, code, name, category, subtype, normal_balance, parent_id, system_key,
                 is_system, is_active, allow_manual_posting, created_at, updated_at)
                VALUES
                (:id, :org, '2300', 'Customer Advances', 'liability', 'customer_advances', 'credit', NULL,
                 'customer_advances', true, true, false, now(), now())
                """
            ),
            {"id": str(uuid4()), "org": org["id"]},
        )


def downgrade() -> None:
    op.drop_index("ix_customer_advance_apps_org_invoice", table_name="customer_advance_applications")
    op.drop_index("ix_customer_advance_apps_org_advance", table_name="customer_advance_applications")
    op.drop_table("customer_advance_applications")
    op.drop_index("ix_customer_advances_org_remaining", table_name="customer_advances")
    op.drop_index("ix_customer_advances_org_client_date", table_name="customer_advances")
    op.drop_table("customer_advances")
    op.execute("DELETE FROM ledger_accounts WHERE system_key='customer_advances'")
