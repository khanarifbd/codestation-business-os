"""add tenant system defaults

Revision ID: 0007_company_defaults
Revises: 0006_company_master
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0007_company_defaults"
down_revision: str | None = "0006_company_master"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "organization_system_defaults",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("default_client_country_code", sa.String(2), nullable=True),
        sa.Column("default_client_currency", sa.String(3), nullable=True),
        sa.Column("default_document_language", sa.String(16), nullable=False),
        sa.Column("default_lead_status", sa.String(64), nullable=False),
        sa.Column("default_project_status", sa.String(64), nullable=False),
        sa.Column("default_order_status", sa.String(64), nullable=False),
        sa.Column("default_invoice_status", sa.String(64), nullable=False),
        sa.Column("quotation_validity_days", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_system_defaults_organization_id"),
    )
    op.create_index(
        "ix_organization_system_defaults_organization_id",
        "organization_system_defaults",
        ["organization_id"],
        unique=False,
    )

    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT id, country_code, currency FROM organizations")
    ).mappings().all()
    now = datetime.now(timezone.utc)
    for row in rows:
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_system_defaults (
                    id, organization_id, default_client_country_code, default_client_currency,
                    default_document_language, default_lead_status, default_project_status,
                    default_order_status, default_invoice_status, quotation_validity_days,
                    created_at, updated_at
                ) VALUES (
                    :id, :organization_id, :country_code, :currency,
                    'en', 'new', 'planned', 'draft', 'draft', 30, :now, :now
                )
                """
            ),
            {
                "id": str(uuid4()),
                "organization_id": row["id"],
                "country_code": row["country_code"],
                "currency": row["currency"],
                "now": now,
            },
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO activity_logs (
                id, actor_type, scope, action, outcome, message, metadata_json, created_at
            ) VALUES (
                :id, 'system', 'platform', 'system.company_defaults.initialized', 'success',
                'Tenant system defaults initialized', CAST(:metadata AS jsonb), :now
            )
            """
        ),
        {
            "id": str(uuid4()),
            "metadata": '{"source":"migration"}',
            "now": now,
        },
    )


def downgrade() -> None:
    op.drop_index(
        "ix_organization_system_defaults_organization_id",
        table_name="organization_system_defaults",
    )
    op.drop_table("organization_system_defaults")
