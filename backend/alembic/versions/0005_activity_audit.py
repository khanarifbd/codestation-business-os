"""create append-only activity log storage

Revision ID: 0005_activity_audit
Revises: 0004_platform_admin
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4
import json

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0005_activity_audit"
down_revision: str | None = "0004_platform_admin"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "activity_logs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=True),
        sa.Column("actor_user_id", sa.String(length=36), nullable=True),
        sa.Column("actor_type", sa.String(length=24), nullable=False),
        sa.Column("scope", sa.String(length=24), nullable=False),
        sa.Column("action", sa.String(length=120), nullable=False),
        sa.Column("entity_type", sa.String(length=80), nullable=True),
        sa.Column("entity_id", sa.String(length=80), nullable=True),
        sa.Column("outcome", sa.String(length=24), nullable=False),
        sa.Column("message", sa.String(length=500), nullable=True),
        sa.Column("request_id", sa.String(length=64), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.Text(), nullable=True),
        sa.Column("http_method", sa.String(length=12), nullable=True),
        sa.Column("request_path", sa.String(length=500), nullable=True),
        sa.Column("before_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after_data", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("metadata_json", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_activity_logs_created_id",
        "activity_logs",
        ["created_at", "id"],
        unique=False,
    )
    op.create_index(
        "ix_activity_logs_org_created",
        "activity_logs",
        ["organization_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_activity_logs_actor_created",
        "activity_logs",
        ["actor_user_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_activity_logs_action_created",
        "activity_logs",
        ["action", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_activity_logs_entity_created",
        "activity_logs",
        ["entity_type", "entity_id", "created_at"],
        unique=False,
    )
    op.create_index("ix_activity_logs_request_id", "activity_logs", ["request_id"], unique=False)

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_activity_log_mutation()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
            RAISE EXCEPTION 'activity_logs are append-only and cannot be updated or deleted';
        END;
        $$;
        """
    )
    op.execute(
        """
        CREATE TRIGGER activity_logs_immutable
        BEFORE UPDATE OR DELETE ON activity_logs
        FOR EACH ROW
        EXECUTE FUNCTION prevent_activity_log_mutation();
        """
    )

    bind = op.get_bind()
    user_count = bind.execute(sa.text("SELECT count(*) FROM users")).scalar_one()
    organization_count = bind.execute(sa.text("SELECT count(*) FROM organizations")).scalar_one()
    subscription_count = bind.execute(sa.text("SELECT count(*) FROM subscriptions")).scalar_one()
    metadata = {
        "note": (
            "Audit logging initialized. Historical actions before this migration are not "
            "reconstructed; this row records the existing system baseline."
        ),
        "existing_users": user_count,
        "existing_organizations": organization_count,
        "existing_subscriptions": subscription_count,
    }
    bind.execute(
        sa.text(
            """
            INSERT INTO activity_logs (
                id, actor_type, scope, action, outcome, message, metadata_json, created_at
            ) VALUES (
                :id, 'system', 'platform', 'system.audit.initialized', 'success',
                'Append-only activity audit logging initialized', CAST(:metadata AS jsonb), :created_at
            )
            """
        ),
        {
            "id": str(uuid4()),
            "metadata": json.dumps(metadata),
            "created_at": datetime.now(timezone.utc),
        },
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS activity_logs_immutable ON activity_logs")
    op.execute("DROP FUNCTION IF EXISTS prevent_activity_log_mutation()")
    op.drop_index("ix_activity_logs_request_id", table_name="activity_logs")
    op.drop_index("ix_activity_logs_entity_created", table_name="activity_logs")
    op.drop_index("ix_activity_logs_action_created", table_name="activity_logs")
    op.drop_index("ix_activity_logs_actor_created", table_name="activity_logs")
    op.drop_index("ix_activity_logs_org_created", table_name="activity_logs")
    op.drop_index("ix_activity_logs_created_id", table_name="activity_logs")
    op.drop_table("activity_logs")
