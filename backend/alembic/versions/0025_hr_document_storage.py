"""add HR document storage fields

Revision ID: 0025_hr_document_storage
Revises: 0024_hr_defaults
Create Date: 2026-08-09
"""

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0025_hr_document_storage"
down_revision: str | None = "0024_hr_defaults"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("employee_hr_documents", sa.Column("storage_key", sa.String(500), nullable=True))
    op.add_column("employee_hr_documents", sa.Column("original_filename", sa.String(255), nullable=True))
    op.add_column("employee_hr_documents", sa.Column("content_type", sa.String(160), nullable=True))
    op.add_column("employee_hr_documents", sa.Column("size_bytes", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("employee_hr_documents", "size_bytes")
    op.drop_column("employee_hr_documents", "content_type")
    op.drop_column("employee_hr_documents", "original_filename")
    op.drop_column("employee_hr_documents", "storage_key")
