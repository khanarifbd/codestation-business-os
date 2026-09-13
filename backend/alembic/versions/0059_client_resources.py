"""add client notes documents and credentials

Revision ID: 0059_client_resources
Revises: 0058_financial_relationships
Create Date: 2026-08-20
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0059_client_resources"
down_revision: str | None = "0058_financial_relationships"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "client_notes",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_notes_organization_id", "client_notes", ["organization_id"])
    op.create_index("ix_client_notes_org_client_created", "client_notes", ["organization_id", "client_id", "created_at"])

    op.create_table(
        "client_documents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_documents_organization_id", "client_documents", ["organization_id"])
    op.create_index("ix_client_documents_org_client_created", "client_documents", ["organization_id", "client_id", "created_at"])

    op.create_table(
        "client_credentials",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("credential_type", sa.String(40), nullable=False),
        sa.Column("environment", sa.String(32), nullable=False),
        sa.Column("username", sa.String(320), nullable=True),
        sa.Column("secret_ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("url", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("access_level", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_credentials_organization_id", "client_credentials", ["organization_id"])
    op.create_index("ix_client_credentials_org_client_created", "client_credentials", ["organization_id", "client_id", "created_at"])
    op.create_index("ix_client_credentials_org_client_access", "client_credentials", ["organization_id", "client_id", "access_level"])


def downgrade() -> None:
    op.drop_index("ix_client_credentials_org_client_access", table_name="client_credentials")
    op.drop_index("ix_client_credentials_org_client_created", table_name="client_credentials")
    op.drop_index("ix_client_credentials_organization_id", table_name="client_credentials")
    op.drop_table("client_credentials")

    op.drop_index("ix_client_documents_org_client_created", table_name="client_documents")
    op.drop_index("ix_client_documents_organization_id", table_name="client_documents")
    op.drop_table("client_documents")

    op.drop_index("ix_client_notes_org_client_created", table_name="client_notes")
    op.drop_index("ix_client_notes_organization_id", table_name="client_notes")
    op.drop_table("client_notes")
