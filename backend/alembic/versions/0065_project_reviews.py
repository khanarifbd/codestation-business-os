"""add project reviews

Revision ID: 0065_project_reviews
Revises: 0064_invoice_payments
Create Date: 2026-08-31
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0065_project_reviews"
down_revision: str | None = "0064_invoice_payments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "project_reviews",
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("project_id", sa.String(length=36), nullable=False),
        sa.Column("rating", sa.Integer(), nullable=True),
        sa.Column("review_text", sa.Text(), nullable=True),
        sa.Column("source", sa.String(length=64), nullable=True),
        sa.Column("reviewer_name", sa.String(length=180), nullable=True),
        sa.Column("received_at", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("updated_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "rating IS NULL OR (rating >= 1 AND rating <= 5)",
            name="ck_project_reviews_rating",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"], ["organizations.id"], ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_user_id"], ["users.id"], ondelete="RESTRICT"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "project_id", name="uq_project_reviews_org_project"
        ),
    )
    op.create_index(
        "ix_project_reviews_organization_id",
        "project_reviews",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_project_reviews_org_received",
        "project_reviews",
        ["organization_id", "received_at", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_project_reviews_org_received", table_name="project_reviews")
    op.drop_index("ix_project_reviews_organization_id", table_name="project_reviews")
    op.drop_table("project_reviews")
