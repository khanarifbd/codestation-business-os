"""add platform admin roles, organization lifecycle, and subscriptions

Revision ID: 0004_platform_admin
Revises: 0003_tenant_context_foundation
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0004_platform_admin"
down_revision: str | None = "0003_tenant_context_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("system_role", sa.String(length=32), server_default="user", nullable=False),
    )
    op.create_index("ix_users_system_role", "users", ["system_role"], unique=False)
    op.alter_column("users", "system_role", server_default=None)

    op.add_column(
        "organizations",
        sa.Column("status", sa.String(length=32), server_default="active", nullable=False),
    )
    op.add_column(
        "organizations",
        sa.Column("suspension_reason", sa.String(length=500), nullable=True),
    )
    op.add_column(
        "organizations",
        sa.Column("suspended_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_organizations_status", "organizations", ["status"], unique=False)
    op.alter_column("organizations", "status", server_default=None)

    op.execute("UPDATE memberships SET role = 'admin' WHERE role = 'owner'")
    op.execute("UPDATE memberships SET role = 'user' WHERE role = 'member'")

    op.create_table(
        "subscriptions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("plan_code", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("billing_cycle", sa.String(length=32), nullable=False),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_start", sa.DateTime(timezone=True), nullable=True),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_subscriptions_organization_id"),
    )
    op.create_index("ix_subscriptions_status", "subscriptions", ["status"], unique=False)
    op.create_index(
        "ix_subscriptions_status_period",
        "subscriptions",
        ["status", "current_period_end"],
        unique=False,
    )

    bind = op.get_bind()
    organization_ids = bind.execute(sa.text("SELECT id FROM organizations")).scalars().all()
    if organization_ids:
        now = datetime.now(timezone.utc)
        subscriptions = sa.table(
            "subscriptions",
            sa.column("id", sa.String()),
            sa.column("organization_id", sa.String()),
            sa.column("plan_code", sa.String()),
            sa.column("status", sa.String()),
            sa.column("billing_cycle", sa.String()),
            sa.column("current_period_start", sa.DateTime(timezone=True)),
            sa.column("created_at", sa.DateTime(timezone=True)),
            sa.column("updated_at", sa.DateTime(timezone=True)),
        )
        op.bulk_insert(
            subscriptions,
            [
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "plan_code": "default",
                    "status": "active",
                    "billing_cycle": "monthly",
                    "current_period_start": now,
                    "created_at": now,
                    "updated_at": now,
                }
                for organization_id in organization_ids
            ],
        )


def downgrade() -> None:
    op.drop_index("ix_subscriptions_status_period", table_name="subscriptions")
    op.drop_index("ix_subscriptions_status", table_name="subscriptions")
    op.drop_table("subscriptions")

    op.execute("UPDATE memberships SET role = 'owner' WHERE role = 'admin'")
    op.execute("UPDATE memberships SET role = 'member' WHERE role = 'user'")

    op.drop_index("ix_organizations_status", table_name="organizations")
    op.drop_column("organizations", "suspended_at")
    op.drop_column("organizations", "suspension_reason")
    op.drop_column("organizations", "status")

    op.drop_index("ix_users_system_role", table_name="users")
    op.drop_column("users", "system_role")
