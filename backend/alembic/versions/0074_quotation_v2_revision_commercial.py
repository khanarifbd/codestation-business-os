"""add quotation revision and commercial data model

Revision ID: 0074_quotation_v2_revision_commercial
Revises: 0073_project_notes
Create Date: 2026-09-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0074_quotation_v2_revision_commercial"
down_revision: str | None = "0073_project_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Revision lineage. Root quotations keep root_quotation_id/supersedes_quotation_id
    # NULL and revision_number=1. Later revisions point at the original root and
    # the immediately previous revision.
    op.add_column("quotations", sa.Column("root_quotation_id", sa.String(36), nullable=True))
    op.add_column("quotations", sa.Column("supersedes_quotation_id", sa.String(36), nullable=True))
    op.add_column(
        "quotations",
        sa.Column("revision_number", sa.Integer(), nullable=False, server_default=sa.text("1")),
    )
    op.add_column("quotations", sa.Column("revision_reason", sa.Text(), nullable=True))

    op.create_foreign_key(
        "fk_quotations_root_quotation",
        "quotations",
        "quotations",
        ["root_quotation_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_quotations_supersedes_quotation",
        "quotations",
        "quotations",
        ["supersedes_quotation_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_check_constraint(
        "ck_quotations_revision_shape",
        "quotations",
        "(revision_number = 1 AND root_quotation_id IS NULL AND supersedes_quotation_id IS NULL) OR "
        "(revision_number > 1 AND root_quotation_id IS NOT NULL AND supersedes_quotation_id IS NOT NULL)",
    )
    op.create_check_constraint(
        "ck_quotations_revision_positive",
        "quotations",
        "revision_number >= 1",
    )
    op.create_check_constraint(
        "ck_quotations_revision_not_self",
        "quotations",
        "(root_quotation_id IS NULL OR root_quotation_id <> id) AND "
        "(supersedes_quotation_id IS NULL OR supersedes_quotation_id <> id)",
    )
    op.create_index(
        "ix_quotations_org_root_revision",
        "quotations",
        ["organization_id", "root_quotation_id", "revision_number"],
    )
    # Root rows use their own id as the family key; child revisions use the
    # stored root id. This prevents duplicate revision numbers in one family.
    op.execute(
        "CREATE UNIQUE INDEX uq_quotations_org_revision_family "
        "ON quotations (organization_id, COALESCE(root_quotation_id, id), revision_number)"
    )

    # Commercial proposal metadata. Existing subject/notes/terms remain intact
    # for backward compatibility while the V2 document model is introduced.
    op.add_column("quotations", sa.Column("project_title", sa.String(220), nullable=True))
    op.add_column("quotations", sa.Column("executive_summary", sa.Text(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_start_date", sa.Date(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_end_date", sa.Date(), nullable=True))
    op.add_column("quotations", sa.Column("estimated_duration", sa.String(120), nullable=True))
    op.add_column("quotations", sa.Column("start_condition", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_quotations_estimated_schedule",
        "quotations",
        "estimated_start_date IS NULL OR estimated_end_date IS NULL OR estimated_end_date >= estimated_start_date",
    )

    # Immutable contact/prepared-by snapshots used by future revision-aware PDF
    # generation. They intentionally do not replace the existing snapshot fields.
    op.add_column("quotations", sa.Column("seller_phone_snapshot", sa.String(64), nullable=True))
    op.add_column("quotations", sa.Column("client_phone_snapshot", sa.String(64), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_name_snapshot", sa.String(180), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_email_snapshot", sa.String(320), nullable=True))
    op.add_column("quotations", sa.Column("prepared_by_designation_snapshot", sa.String(120), nullable=True))

    # Backfill only values that can be derived safely from existing immutable
    # document lineage. Missing optional values remain NULL.
    op.execute(
        "UPDATE quotations SET project_title = subject "
        "WHERE project_title IS NULL AND subject IS NOT NULL"
    )
    op.execute(
        """
        UPDATE quotations AS q
        SET client_phone_snapshot = c.phone
        FROM clients AS c
        WHERE q.client_id = c.id
          AND q.organization_id = c.organization_id
          AND q.client_phone_snapshot IS NULL
        """
    )
    op.execute(
        """
        UPDATE quotations AS q
        SET seller_phone_snapshot = p.phone
        FROM organization_profiles AS p
        WHERE q.organization_id = p.organization_id
          AND q.seller_phone_snapshot IS NULL
        """
    )
    op.execute(
        """
        UPDATE quotations AS q
        SET prepared_by_name_snapshot = u.full_name,
            prepared_by_email_snapshot = u.email
        FROM users AS u
        WHERE q.created_by_user_id = u.id
          AND q.prepared_by_name_snapshot IS NULL
        """
    )
    op.execute(
        """
        UPDATE quotations AS q
        SET prepared_by_designation_snapshot = d.name
        FROM memberships AS m
        JOIN employees AS e ON e.membership_id = m.id
        JOIN designations AS d ON d.id = e.designation_id
        WHERE q.created_by_user_id = m.user_id
          AND q.organization_id = m.organization_id
          AND e.organization_id = q.organization_id
          AND d.organization_id = q.organization_id
          AND q.prepared_by_designation_snapshot IS NULL
        """
    )


def downgrade() -> None:
    op.drop_column("quotations", "prepared_by_designation_snapshot")
    op.drop_column("quotations", "prepared_by_email_snapshot")
    op.drop_column("quotations", "prepared_by_name_snapshot")
    op.drop_column("quotations", "client_phone_snapshot")
    op.drop_column("quotations", "seller_phone_snapshot")

    op.drop_constraint("ck_quotations_estimated_schedule", "quotations", type_="check")
    op.drop_column("quotations", "start_condition")
    op.drop_column("quotations", "estimated_duration")
    op.drop_column("quotations", "estimated_end_date")
    op.drop_column("quotations", "estimated_start_date")
    op.drop_column("quotations", "executive_summary")
    op.drop_column("quotations", "project_title")

    op.execute("DROP INDEX IF EXISTS uq_quotations_org_revision_family")
    op.drop_index("ix_quotations_org_root_revision", table_name="quotations")
    op.drop_constraint("ck_quotations_revision_not_self", "quotations", type_="check")
    op.drop_constraint("ck_quotations_revision_positive", "quotations", type_="check")
    op.drop_constraint("ck_quotations_revision_shape", "quotations", type_="check")
    op.drop_constraint("fk_quotations_supersedes_quotation", "quotations", type_="foreignkey")
    op.drop_constraint("fk_quotations_root_quotation", "quotations", type_="foreignkey")
    op.drop_column("quotations", "revision_reason")
    op.drop_column("quotations", "revision_number")
    op.drop_column("quotations", "supersedes_quotation_id")
    op.drop_column("quotations", "root_quotation_id")
