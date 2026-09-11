"""quotation v2 commercial proposal foundation

Revision ID: 0034_quotation_v2_foundation
Revises: 0033_customer_advances
Create Date: 2026-09-11
"""
from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0034_quotation_v2_foundation"
down_revision: str | None = "0033_customer_advances"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("quotations", sa.Column("root_quotation_id", sa.String(36), nullable=True))
    op.add_column("quotations", sa.Column("supersedes_quotation_id", sa.String(36), nullable=True))
    op.add_column(
        "quotations",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column("quotations", sa.Column("project_title", sa.String(220), nullable=True))
    op.add_column("quotations", sa.Column("executive_summary", sa.Text(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_start_date", sa.Date(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_end_date", sa.Date(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_duration", sa.String(120), nullable=True))
    op.add_column("quotations", sa.Column("start_condition", sa.Text(), nullable=True))
    op.add_column("quotations", sa.Column("seller_phone_snapshot", sa.String(64), nullable=True))
    op.add_column("quotations", sa.Column("client_phone_snapshot", sa.String(64), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_name_snapshot", sa.String(180), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_email_snapshot", sa.String(320), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_designation_snapshot", sa.String(120), nullable=True))

    op.create_foreign_key(
        "fk_quotations_root_quotation_id",
        "quotations",
        "quotations",
        ["root_quotation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_quotations_supersedes_quotation_id",
        "quotations",
        "quotations",
        ["supersedes_quotation_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_unique_constraint(
        "uq_quotations_org_root_revision",
        "quotations",
        ["organization_id", "root_quotation_id", "revision_number"],
    )
    op.create_index(
        "ix_quotations_org_root_revision",
        "quotations",
        ["organization_id", "root_quotation_id", "revision_number"],
    )

    op.add_column("quotation_items", sa.Column("group_name", sa.String(160), nullable=True))
    op.add_column("quotation_items", sa.Column("title", sa.String(220), nullable=True))
    op.add_column(
        "quotation_items",
        sa.Column("unit", sa.String(32), nullable=False, server_default=sa.text("'item'")),
    )

    op.create_table(
        "quotation_sections",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "quotation_id",
            sa.String(36),
            sa.ForeignKey("quotations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("section_type", sa.String(48), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_quotation_sections_org_quote_order",
        "quotation_sections",
        ["organization_id", "quotation_id", "sort_order"],
    )
    op.create_index(
        "ix_quotation_sections_org_quote_type",
        "quotation_sections",
        ["organization_id", "quotation_id", "section_type"],
    )

    op.create_table(
        "quotation_milestones",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "quotation_id",
            sa.String(36),
            sa.ForeignKey("quotations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("duration_text", sa.String(120), nullable=True),
        sa.Column("acceptance_criteria", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_quotation_milestones_org_quote_order",
        "quotation_milestones",
        ["organization_id", "quotation_id", "sort_order"],
    )

    op.create_table(
        "quotation_payment_schedules",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "organization_id",
            sa.String(36),
            sa.ForeignKey("organizations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "quotation_id",
            sa.String(36),
            sa.ForeignKey("quotations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(180), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("payment_type", sa.String(16), nullable=False),
        sa.Column("percentage", sa.Numeric(7, 4), nullable=True),
        sa.Column("amount", sa.Numeric(16, 2), nullable=True),
        sa.Column("calculated_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("due_condition", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index(
        "ix_quotation_payments_org_quote_order",
        "quotation_payment_schedules",
        ["organization_id", "quotation_id", "sort_order"],
    )

    bind = op.get_bind()
    bind.execute(sa.text("UPDATE quotations SET project_title = subject WHERE project_title IS NULL AND subject IS NOT NULL"))
    bind.execute(
        sa.text(
            """
            UPDATE quotations AS q
            SET prepared_by_name_snapshot = u.full_name,
                prepared_by_email_snapshot = u.email
            FROM users AS u
            WHERE q.created_by_user_id = u.id
              AND q.prepared_by_name_snapshot IS NULL
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE quotations AS q
            SET client_phone_snapshot = c.phone
            FROM clients AS c
            WHERE q.client_id = c.id
              AND q.client_phone_snapshot IS NULL
            """
        )
    )
    bind.execute(
        sa.text(
            """
            UPDATE quotations AS q
            SET seller_phone_snapshot = p.phone
            FROM organization_profiles AS p
            WHERE q.organization_id = p.organization_id
              AND q.seller_phone_snapshot IS NULL
            """
        )
    )

    quotations = bind.execute(
        sa.text(
            """
            SELECT id, organization_id, notes, terms_conditions
            FROM quotations
            WHERE notes IS NOT NULL OR terms_conditions IS NOT NULL
            ORDER BY created_at, id
            """
        )
    ).mappings().all()
    for quotation in quotations:
        if quotation["terms_conditions"] and quotation["terms_conditions"].strip():
            bind.execute(
                sa.text(
                    """
                    INSERT INTO quotation_sections
                    (id, organization_id, quotation_id, section_type, title, content, sort_order, is_visible, created_at, updated_at)
                    VALUES
                    (:id, :organization_id, :quotation_id, 'terms_conditions', 'Terms & Conditions', :content, 900, true, now(), now())
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": quotation["organization_id"],
                    "quotation_id": quotation["id"],
                    "content": quotation["terms_conditions"].strip(),
                },
            )
        if quotation["notes"] and quotation["notes"].strip():
            bind.execute(
                sa.text(
                    """
                    INSERT INTO quotation_sections
                    (id, organization_id, quotation_id, section_type, title, content, sort_order, is_visible, created_at, updated_at)
                    VALUES
                    (:id, :organization_id, :quotation_id, 'additional_notes', 'Additional Notes', :content, 910, true, now(), now())
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": quotation["organization_id"],
                    "quotation_id": quotation["id"],
                    "content": quotation["notes"].strip(),
                },
            )

    op.alter_column("quotations", "revision_number", server_default=None)
    op.alter_column("quotation_items", "unit", server_default=None)


def downgrade() -> None:
    op.drop_index("ix_quotation_payments_org_quote_order", table_name="quotation_payment_schedules")
    op.drop_table("quotation_payment_schedules")
    op.drop_index("ix_quotation_milestones_org_quote_order", table_name="quotation_milestones")
    op.drop_table("quotation_milestones")
    op.drop_index("ix_quotation_sections_org_quote_type", table_name="quotation_sections")
    op.drop_index("ix_quotation_sections_org_quote_order", table_name="quotation_sections")
    op.drop_table("quotation_sections")

    op.drop_column("quotation_items", "unit")
    op.drop_column("quotation_items", "title")
    op.drop_column("quotation_items", "group_name")

    op.drop_index("ix_quotations_org_root_revision", table_name="quotations")
    op.drop_constraint("uq_quotations_org_root_revision", "quotations", type_="unique")
    op.drop_constraint("fk_quotations_supersedes_quotation_id", "quotations", type_="foreignkey")
    op.drop_constraint("fk_quotations_root_quotation_id", "quotations", type_="foreignkey")
    op.drop_column("quotations", "prepared_by_designation_snapshot")
    op.drop_column("quotations", "prepared_by_email_snapshot")
    op.drop_column("quotations", "prepared_by_name_snapshot")
    op.drop_column("quotations", "client_phone_snapshot")
    op.drop_column("quotations", "seller_phone_snapshot")
    op.drop_column("quotations", "start_condition")
    op.drop_column("quotations", "estimated_duration")
    op.drop_column("quotations", "estimated_end_date")
    op.drop_column("quotations", "estimated_start_date")
    op.drop_column("quotations", "executive_summary")
    op.drop_column("quotations", "project_title")
    op.drop_column("quotations", "revision_number")
    op.drop_column("quotations", "supersedes_quotation_id")
    op.drop_column("quotations", "root_quotation_id")
