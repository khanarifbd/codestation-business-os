"""add financial posting idempotency registry

Revision ID: 0034_posting_idempotency
Revises: 0033_customer_advances
Create Date: 2026-08-10
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0034_posting_idempotency"
down_revision: str | None = "0033_customer_advances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "posting_idempotency",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("action", sa.String(80), nullable=False),
        sa.Column("idempotency_key", sa.String(128), nullable=False),
        sa.Column("request_fingerprint", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(64), nullable=True),
        sa.Column("resource_id", sa.String(36), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("organization_id", "action", "idempotency_key", name="uq_posting_idempotency_org_action_key"),
    )
    op.create_index("ix_posting_idempotency_org_created", "posting_idempotency", ["organization_id", "created_at"])
    op.create_index("ix_posting_idempotency_resource", "posting_idempotency", ["organization_id", "resource_type", "resource_id"])


def downgrade() -> None:
    op.drop_index("ix_posting_idempotency_resource", table_name="posting_idempotency")
    op.drop_index("ix_posting_idempotency_org_created", table_name="posting_idempotency")
    op.drop_table("posting_idempotency")
