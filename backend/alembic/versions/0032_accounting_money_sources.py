"""link accounting money entries to business sources

Revision ID: 0032_accounting_money_sources
Revises: 0031_accounting_payables
Create Date: 2026-08-09
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0032_accounting_money_sources"
down_revision: str | None = "0031_accounting_payables"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("accounting_money_entries", sa.Column("source_type", sa.String(24), nullable=True))
    op.add_column("accounting_money_entries", sa.Column("source_id", sa.String(36), nullable=True))
    op.add_column("accounting_money_entries", sa.Column("client_id", sa.String(36), nullable=True))
    op.add_column("accounting_money_entries", sa.Column("order_id", sa.String(36), nullable=True))
    op.add_column("accounting_money_entries", sa.Column("project_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_accounting_money_entries_client", "accounting_money_entries", "clients", ["client_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_accounting_money_entries_order", "accounting_money_entries", "orders", ["order_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_accounting_money_entries_project", "accounting_money_entries", "projects", ["project_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_accounting_money_entries_org_source", "accounting_money_entries", ["organization_id", "source_type", "source_id"])
    op.create_index("ix_accounting_money_entries_org_project_date", "accounting_money_entries", ["organization_id", "project_id", "entry_date"])
    op.create_index("ix_accounting_money_entries_org_order_date", "accounting_money_entries", ["organization_id", "order_id", "entry_date"])


def downgrade() -> None:
    op.drop_index("ix_accounting_money_entries_org_order_date", table_name="accounting_money_entries")
    op.drop_index("ix_accounting_money_entries_org_project_date", table_name="accounting_money_entries")
    op.drop_index("ix_accounting_money_entries_org_source", table_name="accounting_money_entries")
    op.drop_constraint("fk_accounting_money_entries_project", "accounting_money_entries", type_="foreignkey")
    op.drop_constraint("fk_accounting_money_entries_order", "accounting_money_entries", type_="foreignkey")
    op.drop_constraint("fk_accounting_money_entries_client", "accounting_money_entries", type_="foreignkey")
    op.drop_column("accounting_money_entries", "project_id")
    op.drop_column("accounting_money_entries", "order_id")
    op.drop_column("accounting_money_entries", "client_id")
    op.drop_column("accounting_money_entries", "source_id")
    op.drop_column("accounting_money_entries", "source_type")
