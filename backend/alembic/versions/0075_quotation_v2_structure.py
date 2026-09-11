"""add quotation structured sections and milestones

Revision ID: 0075_quotation_v2_structure
Revises: 0074_quotation_v2_commercial
Create Date: 2026-09-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0075_quotation_v2_structure"
down_revision: str | None = "0074_quotation_v2_commercial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "quotation_sections",
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("quotation_id", sa.String(36), nullable=False),
        sa.Column("section_type", sa.String(48), nullable=False),
        sa.Column("title", sa.String(220), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("is_visible", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotation_sections_organization_id", "quotation_sections", ["organization_id"])
    op.create_index(
        "ix_quotation_sections_org_quotation_sort",
        "quotation_sections",
        ["organization_id", "quotation_id", "sort_order"],
    )
    op.create_index(
        "ix_quotation_sections_org_quotation_type",
        "quotation_sections",
        ["organization_id", "quotation_id", "section_type"],
    )

    op.create_table(
        "quotation_milestones",
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("quotation_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("estimated_start_date", sa.Date(), nullable=True),
        sa.Column("estimated_end_date", sa.Date(), nullable=True),
        sa.Column("estimated_duration", sa.String(120), nullable=True),
        sa.Column("acceptance_criteria", sa.Text(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "estimated_start_date IS NULL OR estimated_end_date IS NULL OR estimated_end_date >= estimated_start_date",
            name="ck_quotation_milestones_estimated_schedule",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotation_milestones_organization_id", "quotation_milestones", ["organization_id"])
    op.create_index(
        "ix_quotation_milestones_org_quotation_sort",
        "quotation_milestones",
        ["organization_id", "quotation_id", "sort_order"],
    )

    op.create_table(
        "quotation_payment_milestones",
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("quotation_id", sa.String(36), nullable=False),
        sa.Column("quotation_milestone_id", sa.String(36), nullable=True),
        sa.Column("title", sa.String(220), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("payment_type", sa.String(16), nullable=False),
        sa.Column("percentage", sa.Numeric(7, 4), nullable=True),
        sa.Column("amount", sa.Numeric(16, 2), nullable=False, server_default=sa.text("0")),
        sa.Column("due_condition", sa.Text(), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("amount >= 0", name="ck_quotation_payment_amount_nonnegative"),
        sa.CheckConstraint(
            "percentage IS NULL OR (percentage > 0 AND percentage <= 100)",
            name="ck_quotation_payment_percentage_range",
        ),
        sa.CheckConstraint(
            "(payment_type = 'percentage' AND percentage IS NOT NULL) OR "
            "(payment_type = 'fixed' AND percentage IS NULL)",
            name="ck_quotation_payment_type_shape",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["quotation_milestone_id"], ["quotation_milestones.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_quotation_payment_milestones_organization_id", "quotation_payment_milestones", ["organization_id"])
    op.create_index(
        "ix_quotation_payment_org_quotation_sort",
        "quotation_payment_milestones",
        ["organization_id", "quotation_id", "sort_order"],
    )
    op.create_index(
        "ix_quotation_payment_org_milestone",
        "quotation_payment_milestones",
        ["organization_id", "quotation_milestone_id"],
    )

    # Seed the legacy free-form document text into the V2 section model without
    # removing the original columns. This keeps old quotations readable while
    # future API/UI work transitions to structured sections.
    op.execute(
        """
        INSERT INTO quotation_sections (
            organization_id, id, quotation_id, section_type, title, content,
            sort_order, is_visible, created_at, updated_at
        )
        SELECT
            q.organization_id,
            gen_random_uuid()::text,
            q.id,
            'additional_notes',
            'Additional Notes',
            q.notes,
            900,
            true,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM quotations AS q
        WHERE q.notes IS NOT NULL AND btrim(q.notes) <> ''
        """
    )
    op.execute(
        """
        INSERT INTO quotation_sections (
            organization_id, id, quotation_id, section_type, title, content,
            sort_order, is_visible, created_at, updated_at
        )
        SELECT
            q.organization_id,
            gen_random_uuid()::text,
            q.id,
            'terms_conditions',
            'Terms & Conditions',
            q.terms_conditions,
            1000,
            true,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM quotations AS q
        WHERE q.terms_conditions IS NOT NULL AND btrim(q.terms_conditions) <> ''
        """
    )


def downgrade() -> None:
    op.drop_index("ix_quotation_payment_org_milestone", table_name="quotation_payment_milestones")
    op.drop_index("ix_quotation_payment_org_quotation_sort", table_name="quotation_payment_milestones")
    op.drop_index("ix_quotation_payment_milestones_organization_id", table_name="quotation_payment_milestones")
    op.drop_table("quotation_payment_milestones")

    op.drop_index("ix_quotation_milestones_org_quotation_sort", table_name="quotation_milestones")
    op.drop_index("ix_quotation_milestones_organization_id", table_name="quotation_milestones")
    op.drop_table("quotation_milestones")

    op.drop_index("ix_quotation_sections_org_quotation_type", table_name="quotation_sections")
    op.drop_index("ix_quotation_sections_org_quotation_sort", table_name="quotation_sections")
    op.drop_index("ix_quotation_sections_organization_id", table_name="quotation_sections")
    op.drop_table("quotation_sections")
