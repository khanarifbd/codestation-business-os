"""add project notes

Revision ID: 0073_project_notes
Revises: 0072_money_expense_classify
Create Date: 2026-09-11
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0073_project_notes"
down_revision: str | None = "0072_money_expense_classify"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_OLD_DEFAULT_TABS = '["overview","milestones","tasks","work","documents","team"]'
_NEW_DEFAULT_TABS = '["overview","milestones","tasks","work","documents","notes","team"]'


def upgrade() -> None:
    op.create_table(
        "project_notes",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("project_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_project_notes_organization_id", "project_notes", ["organization_id"])
    op.create_index("ix_project_notes_org_project_created", "project_notes", ["organization_id", "project_id", "created_at"])

    # Existing members that still use the original default tab set receive Notes.
    # Custom per-member tab selections are intentionally left untouched.
    op.execute(
        f"""
        UPDATE project_members
        SET tab_permissions = '{_NEW_DEFAULT_TABS}'::jsonb
        WHERE tab_permissions = '{_OLD_DEFAULT_TABS}'::jsonb
        """
    )
    op.alter_column(
        "project_members",
        "tab_permissions",
        server_default=sa.text(f"'{_NEW_DEFAULT_TABS}'::jsonb"),
    )


def downgrade() -> None:
    op.alter_column(
        "project_members",
        "tab_permissions",
        server_default=sa.text(f"'{_OLD_DEFAULT_TABS}'::jsonb"),
    )
    op.execute("UPDATE project_members SET tab_permissions = tab_permissions - 'notes' WHERE tab_permissions ? 'notes'")

    op.drop_index("ix_project_notes_org_project_created", table_name="project_notes")
    op.drop_index("ix_project_notes_organization_id", table_name="project_notes")
    op.drop_table("project_notes")
