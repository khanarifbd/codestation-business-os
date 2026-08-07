"""add crm leads clients pipeline

Revision ID: 0009_crm_leads_clients
Revises: 0008_team_roles
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4
import json

from alembic import op
import sqlalchemy as sa

revision: str = "0009_crm_leads_clients"
down_revision: str | None = "0008_team_roles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "lead_statuses",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("color", sa.String(16), nullable=True),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_lead_statuses_org_slug"),
    )
    op.create_index("ix_lead_statuses_organization_id", "lead_statuses", ["organization_id"])
    op.create_index("ix_lead_statuses_org_order", "lead_statuses", ["organization_id", "is_active", "sort_order"])

    op.create_table(
        "lead_sources",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(80), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_lead_sources_org_slug"),
    )
    op.create_index("ix_lead_sources_organization_id", "lead_sources", ["organization_id"])
    op.create_index("ix_lead_sources_org_order", "lead_sources", ["organization_id", "is_active", "sort_order"])

    op.create_table(
        "clients",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("client_code", sa.String(40), nullable=False),
        sa.Column("client_type", sa.String(24), nullable=False),
        sa.Column("display_name", sa.String(220), nullable=False),
        sa.Column("legal_name", sa.String(220), nullable=True),
        sa.Column("contact_name", sa.String(180), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("billing_email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("whatsapp", sa.String(64), nullable=True),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("state_region", sa.String(120), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("postal_code", sa.String(32), nullable=True),
        sa.Column("address_line1", sa.String(250), nullable=True),
        sa.Column("address_line2", sa.String(250), nullable=True),
        sa.Column("tax_identifier", sa.String(180), nullable=True),
        sa.Column("currency", sa.String(3), nullable=True),
        sa.Column("assigned_employee_id", sa.String(36), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assigned_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "client_code", name="uq_clients_org_code"),
    )
    op.create_index("ix_clients_organization_id", "clients", ["organization_id"])
    op.create_index("ix_clients_org_status_created", "clients", ["organization_id", "status", "created_at"])
    op.create_index("ix_clients_org_name", "clients", ["organization_id", "display_name"])
    op.create_index("ix_clients_org_email", "clients", ["organization_id", "email"])

    op.create_table(
        "leads",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("lead_code", sa.String(40), nullable=False),
        sa.Column("lead_type", sa.String(24), nullable=False),
        sa.Column("company_name", sa.String(220), nullable=True),
        sa.Column("contact_name", sa.String(180), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("whatsapp", sa.String(64), nullable=True),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("state_region", sa.String(120), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("address_line1", sa.String(250), nullable=True),
        sa.Column("source_id", sa.String(36), nullable=True),
        sa.Column("status_id", sa.String(36), nullable=False),
        sa.Column("assigned_employee_id", sa.String(36), nullable=True),
        sa.Column("estimated_value", sa.Numeric(16, 2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=True),
        sa.Column("probability_percent", sa.Integer(), nullable=False),
        sa.Column("next_follow_up_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("converted_client_id", sa.String(36), nullable=True),
        sa.Column("converted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["lead_sources.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["status_id"], ["lead_statuses.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["assigned_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["converted_client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "lead_code", name="uq_leads_org_code"),
    )
    op.create_index("ix_leads_organization_id", "leads", ["organization_id"])
    op.create_index("ix_leads_org_status_created", "leads", ["organization_id", "status_id", "created_at"])
    op.create_index("ix_leads_org_assignee_created", "leads", ["organization_id", "assigned_employee_id", "created_at"])
    op.create_index("ix_leads_org_followup", "leads", ["organization_id", "next_follow_up_at"])
    op.create_index("ix_leads_org_email", "leads", ["organization_id", "email"])

    op.create_table(
        "lead_interactions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("lead_id", sa.String(36), nullable=False),
        sa.Column("interaction_type", sa.String(32), nullable=False),
        sa.Column("subject", sa.String(180), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["lead_id"], ["leads.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_lead_interactions_organization_id", "lead_interactions", ["organization_id"])
    op.create_index("ix_lead_interactions_lead_id", "lead_interactions", ["lead_id"])
    op.create_index("ix_lead_interactions_org_lead_created", "lead_interactions", ["organization_id", "lead_id", "created_at"])
    op.create_index("ix_lead_interactions_org_scheduled", "lead_interactions", ["organization_id", "scheduled_at"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organizations = bind.execute(sa.text("SELECT id FROM organizations ORDER BY created_at, id")).mappings().all()

    statuses = [
        ("new", "New", "open", "#64748b", 10, True),
        ("contacted", "Contacted", "open", "#0ea5e9", 20, False),
        ("qualified", "Qualified", "qualified", "#8b5cf6", 30, False),
        ("proposal", "Proposal", "qualified", "#f59e0b", 40, False),
        ("won", "Won", "won", "#16a34a", 50, False),
        ("lost", "Lost", "lost", "#dc2626", 60, False),
    ]
    sources = [
        ("website", "Website", 10),
        ("referral", "Referral", 20),
        ("fiverr", "Fiverr", 30),
        ("upwork", "Upwork", 40),
        ("linkedin", "LinkedIn", 50),
        ("facebook", "Facebook", 60),
        ("email", "Email", 70),
        ("phone", "Phone", 80),
        ("other", "Other", 90),
    ]

    for organization in organizations:
        organization_id = organization["id"]
        for slug, name, category, color, sort_order, is_default in statuses:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO lead_statuses
                        (id, organization_id, name, slug, color, category, sort_order,
                         is_default, is_active, created_at, updated_at)
                    VALUES
                        (:id, :organization_id, :name, :slug, :color, :category, :sort_order,
                         :is_default, true, :now, :now)
                    """
                ),
                {
                    "id": str(uuid4()), "organization_id": organization_id, "name": name,
                    "slug": slug, "color": color, "category": category,
                    "sort_order": sort_order, "is_default": is_default, "now": now,
                },
            )
        for slug, name, sort_order in sources:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO lead_sources
                        (id, organization_id, name, slug, sort_order, is_active, created_at, updated_at)
                    VALUES (:id, :organization_id, :name, :slug, :sort_order, true, :now, :now)
                    """
                ),
                {
                    "id": str(uuid4()), "organization_id": organization_id,
                    "name": name, "slug": slug, "sort_order": sort_order, "now": now,
                },
            )
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_document_sequences
                    (id, organization_id, document_type, prefix, next_number, padding,
                     separator, created_at, updated_at)
                SELECT :id, :organization_id, 'lead', 'LEAD', 1, 5, '-', :now, :now
                WHERE NOT EXISTS (
                    SELECT 1 FROM organization_document_sequences
                    WHERE organization_id=:organization_id AND document_type='lead'
                )
                """
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )

    bind.execute(
        sa.text(
            """
            INSERT INTO activity_logs
                (id, actor_type, scope, action, outcome, message, metadata_json, created_at)
            VALUES
                (:id, 'system', 'platform', 'system.crm.initialized', 'success',
                 'CRM leads and clients foundation initialized', CAST(:metadata AS jsonb), :now)
            """
        ),
        {
            "id": str(uuid4()),
            "metadata": json.dumps({"organizations_initialized": len(organizations)}),
            "now": now,
        },
    )


def downgrade() -> None:
    op.drop_index("ix_lead_interactions_org_scheduled", table_name="lead_interactions")
    op.drop_index("ix_lead_interactions_org_lead_created", table_name="lead_interactions")
    op.drop_index("ix_lead_interactions_lead_id", table_name="lead_interactions")
    op.drop_index("ix_lead_interactions_organization_id", table_name="lead_interactions")
    op.drop_table("lead_interactions")
    op.drop_index("ix_leads_org_email", table_name="leads")
    op.drop_index("ix_leads_org_followup", table_name="leads")
    op.drop_index("ix_leads_org_assignee_created", table_name="leads")
    op.drop_index("ix_leads_org_status_created", table_name="leads")
    op.drop_index("ix_leads_organization_id", table_name="leads")
    op.drop_table("leads")
    op.drop_index("ix_clients_org_email", table_name="clients")
    op.drop_index("ix_clients_org_name", table_name="clients")
    op.drop_index("ix_clients_org_status_created", table_name="clients")
    op.drop_index("ix_clients_organization_id", table_name="clients")
    op.drop_table("clients")
    op.drop_index("ix_lead_sources_org_order", table_name="lead_sources")
    op.drop_index("ix_lead_sources_organization_id", table_name="lead_sources")
    op.drop_table("lead_sources")
    op.drop_index("ix_lead_statuses_org_order", table_name="lead_statuses")
    op.drop_index("ix_lead_statuses_organization_id", table_name="lead_statuses")
    op.drop_table("lead_statuses")
