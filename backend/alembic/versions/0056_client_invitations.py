"""add client portal invitations

Revision ID: 0056_client_invitations
Revises: 0055_service_durations
"""

from alembic import op
import sqlalchemy as sa

revision = "0056_client_invitations"
down_revision = "0055_service_durations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "client_invitations",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("full_name", sa.String(length=160), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("is_primary_contact", sa.Boolean(), nullable=False),
        sa.Column("invited_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invited_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_client_invitations_organization_id", "client_invitations", ["organization_id"], unique=False)
    op.create_index("ix_client_invitations_token_hash", "client_invitations", ["token_hash"], unique=True)
    op.create_index(
        "ix_client_invitations_org_client_status",
        "client_invitations",
        ["organization_id", "client_id", "status"],
        unique=False,
    )
    op.create_index(
        "ix_client_invitations_org_email_status",
        "client_invitations",
        ["organization_id", "email", "status"],
        unique=False,
    )
    op.create_index(
        "uq_client_invitations_pending_client_email",
        "client_invitations",
        ["organization_id", "client_id", "email"],
        unique=True,
        postgresql_where=sa.text("status = 'pending'"),
    )


def downgrade() -> None:
    op.drop_index("uq_client_invitations_pending_client_email", table_name="client_invitations")
    op.drop_index("ix_client_invitations_org_email_status", table_name="client_invitations")
    op.drop_index("ix_client_invitations_org_client_status", table_name="client_invitations")
    op.drop_index("ix_client_invitations_token_hash", table_name="client_invitations")
    op.drop_index("ix_client_invitations_organization_id", table_name="client_invitations")
    op.drop_table("client_invitations")
