"""add HR holidays and policy acknowledgements

Revision ID: 0026_hr_holidays_policy_ack
Revises: 0025_hr_document_storage
Create Date: 2026-08-09
"""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0026_hr_holidays_policy_ack"
down_revision: str | None = "0025_hr_document_storage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "hr_holidays",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("holiday_date", sa.Date(), nullable=False),
        sa.Column("is_paid", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "holiday_date", "name", name="uq_hr_holidays_org_date_name"),
    )
    op.create_index("ix_hr_holidays_org_date", "hr_holidays", ["organization_id", "holiday_date"])

    op.create_table(
        "hr_announcement_acknowledgements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("announcement_id", sa.String(36), sa.ForeignKey("hr_announcements.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("acknowledged_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "announcement_id", "employee_id", name="uq_hr_ack_org_announcement_employee"),
    )
    op.create_index("ix_hr_ack_org_announcement", "hr_announcement_acknowledgements", ["organization_id", "announcement_id"])


def downgrade() -> None:
    op.drop_index("ix_hr_ack_org_announcement", table_name="hr_announcement_acknowledgements")
    op.drop_table("hr_announcement_acknowledgements")
    op.drop_index("ix_hr_holidays_org_date", table_name="hr_holidays")
    op.drop_table("hr_holidays")
