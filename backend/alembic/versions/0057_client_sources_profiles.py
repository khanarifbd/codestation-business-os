"""add client acquisition source and external profiles

Revision ID: 0057_client_sources_profiles
Revises: 0056_client_invitations
"""

from alembic import op
import sqlalchemy as sa

revision = "0057_client_sources_profiles"
down_revision = "0056_client_invitations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("clients", sa.Column("acquisition_source_id", sa.String(length=36), nullable=True))
    op.create_foreign_key(
        "fk_clients_acquisition_source_id_lead_sources",
        "clients",
        "lead_sources",
        ["acquisition_source_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_clients_org_acquisition_source",
        "clients",
        ["organization_id", "acquisition_source_id"],
        unique=False,
    )

    op.create_table(
        "client_external_profiles",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("client_id", sa.String(length=36), nullable=False),
        sa.Column("platform", sa.String(length=64), nullable=False),
        sa.Column("profile_url", sa.String(length=500), nullable=False),
        sa.Column("username_handle", sa.String(length=160), nullable=True),
        sa.Column("label", sa.String(length=120), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id",
            "client_id",
            "profile_url",
            name="uq_client_external_profiles_org_client_url",
        ),
    )
    op.create_index(
        "ix_client_external_profiles_organization_id",
        "client_external_profiles",
        ["organization_id"],
        unique=False,
    )
    op.create_index(
        "ix_client_external_profiles_org_client",
        "client_external_profiles",
        ["organization_id", "client_id"],
        unique=False,
    )
    op.create_index(
        "ix_client_external_profiles_org_platform",
        "client_external_profiles",
        ["organization_id", "platform"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_client_external_profiles_org_platform", table_name="client_external_profiles")
    op.drop_index("ix_client_external_profiles_org_client", table_name="client_external_profiles")
    op.drop_index("ix_client_external_profiles_organization_id", table_name="client_external_profiles")
    op.drop_table("client_external_profiles")

    op.drop_index("ix_clients_org_acquisition_source", table_name="clients")
    op.drop_constraint("fk_clients_acquisition_source_id_lead_sources", "clients", type_="foreignkey")
    op.drop_column("clients", "acquisition_source_id")
