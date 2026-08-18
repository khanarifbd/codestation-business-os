"""allow projects created from manual orders

Revision ID: 0053_manual_order_projects
Revises: 0052_auth_launch_security
"""

from alembic import op
import sqlalchemy as sa

revision = "0053_manual_order_projects"
down_revision = "0052_auth_launch_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "projects",
        "quotation_id",
        existing_type=sa.String(length=36),
        nullable=True,
    )


def downgrade() -> None:
    op.alter_column(
        "projects",
        "quotation_id",
        existing_type=sa.String(length=36),
        nullable=False,
    )
