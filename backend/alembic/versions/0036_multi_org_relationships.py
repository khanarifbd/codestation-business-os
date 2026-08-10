"""support multi-organization owner employee and client relationships

Revision ID: 0036_multi_org_relationships
Revises: 0035_manual_orders
"""

import sqlalchemy as sa
from alembic import op

revision = "0036_multi_org_relationships"
down_revision = "0035_manual_orders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "memberships",
        sa.Column("is_owner", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_memberships_org_owner", "memberships", ["organization_id", "is_owner"])

    # Existing company creators are the initial owners. This preserves the current
    # production-development data while separating ownership from admin permission.
    op.execute(
        """
        UPDATE memberships AS membership
        SET is_owner = TRUE
        FROM organizations AS organization
        WHERE membership.organization_id = organization.id
          AND membership.user_id = organization.created_by_user_id
        """
    )

    op.create_table(
        "client_memberships",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("membership_id", sa.String(length=36), nullable=False),
        sa.Column("is_primary_contact", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["membership_id"], ["memberships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "client_id",
            "membership_id",
            name="uq_client_memberships_org_client_membership",
        ),
    )
    op.create_index(
        "ix_client_memberships_org_membership",
        "client_memberships",
        ["organization_id", "membership_id"],
    )
    op.create_index(
        "ix_client_memberships_org_client",
        "client_memberships",
        ["organization_id", "client_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_client_memberships_org_client", table_name="client_memberships")
    op.drop_index("ix_client_memberships_org_membership", table_name="client_memberships")
    op.drop_table("client_memberships")
    op.drop_index("ix_memberships_org_owner", table_name="memberships")
    op.drop_column("memberships", "is_owner")
