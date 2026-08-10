"""add quotations

Revision ID: 0010_quotations
Revises: 0009_crm_leads_clients
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0010_quotations"
down_revision: str | None = "0009_crm_leads_clients"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quotations",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("quotation_number", sa.String(40), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("source_lead_id", sa.String(36), nullable=True),
        sa.Column("assigned_employee_id", sa.String(36), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("subject", sa.String(220), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("valid_until", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("tax_calculation_mode", sa.String(16), nullable=False),
        sa.Column("seller_name_snapshot", sa.String(220), nullable=False),
        sa.Column("seller_email_snapshot", sa.String(320), nullable=True),
        sa.Column("seller_address_snapshot", sa.Text(), nullable=True),
        sa.Column("seller_tax_identifier_snapshot", sa.String(180), nullable=True),
        sa.Column("client_name_snapshot", sa.String(220), nullable=False),
        sa.Column("client_contact_snapshot", sa.String(180), nullable=True),
        sa.Column("client_email_snapshot", sa.String(320), nullable=True),
        sa.Column("client_address_snapshot", sa.Text(), nullable=True),
        sa.Column("client_tax_identifier_snapshot", sa.String(180), nullable=True),
        sa.Column("subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("total", sa.Numeric(16, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("terms_conditions", sa.Text(), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["source_lead_id"], ["leads.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "quotation_number", name="uq_quotations_org_number"),
    )
    op.create_index("ix_quotations_organization_id", "quotations", ["organization_id"])
    op.create_index("ix_quotations_org_status_created", "quotations", ["organization_id", "status", "created_at"])
    op.create_index("ix_quotations_org_client_created", "quotations", ["organization_id", "client_id", "created_at"])
    op.create_index("ix_quotations_org_valid_until", "quotations", ["organization_id", "valid_until"])

    op.create_table(
        "quotation_items",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("quotation_id", sa.String(36), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(16, 4), nullable=False),
        sa.Column("discount_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("tax_rate", sa.Numeric(8, 4), nullable=False),
        sa.Column("line_subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotation_items_organization_id", "quotation_items", ["organization_id"])
    op.create_index("ix_quotation_items_org_quotation_order", "quotation_items", ["organization_id", "quotation_id", "sort_order"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        exists = bind.execute(
            sa.text(
                "SELECT 1 FROM organization_document_sequences "
                "WHERE organization_id = CAST(:organization_id AS VARCHAR(36)) AND document_type = 'quotation' LIMIT 1"
            ),
            {"organization_id": organization_id},
        ).scalar()
        if exists:
            continue
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_document_sequences
                    (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
                VALUES
                    (:id, CAST(:organization_id AS VARCHAR(36)), 'quotation', 'QUO', 1, 5, '-', :now, :now)
                """
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )


def downgrade() -> None:
    op.drop_index("ix_quotation_items_org_quotation_order", table_name="quotation_items")
    op.drop_index("ix_quotation_items_organization_id", table_name="quotation_items")
    op.drop_table("quotation_items")
    op.drop_index("ix_quotations_org_valid_until", table_name="quotations")
    op.drop_index("ix_quotations_org_client_created", table_name="quotations")
    op.drop_index("ix_quotations_org_status_created", table_name="quotations")
    op.drop_index("ix_quotations_organization_id", table_name="quotations")
    op.drop_table("quotations")
