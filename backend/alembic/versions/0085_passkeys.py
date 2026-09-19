"""add passkey credentials and WebAuthn challenges

Revision ID: 0085_passkeys
Revises: 0084_corrections
Create Date: 2026-09-19
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0085_passkeys"
down_revision: str | None = "0084_corrections"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "user_passkeys",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("credential_id", sa.Text(), nullable=False),
        sa.Column("credential_id_hash", sa.String(length=64), nullable=False),
        sa.Column("credential_public_key", sa.LargeBinary(), nullable=False),
        sa.Column("sign_count", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("credential_device_type", sa.String(length=24), nullable=False),
        sa.Column("backed_up", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("transports", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
        sa.Column("aaguid", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_passkeys_user_id", "user_passkeys", ["user_id"])
    op.create_index("ix_user_passkeys_user_created", "user_passkeys", ["user_id", "created_at"])
    op.create_index("ix_user_passkeys_credential_hash", "user_passkeys", ["credential_id_hash"], unique=True)

    op.create_table(
        "passkey_challenges",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=True),
        sa.Column("purpose", sa.String(length=24), nullable=False),
        sa.Column("challenge", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_passkey_challenges_user_id", "passkey_challenges", ["user_id"])
    op.create_index("ix_passkey_challenges_purpose_expiry", "passkey_challenges", ["purpose", "expires_at"])
    op.create_index("ix_passkey_challenges_user_purpose", "passkey_challenges", ["user_id", "purpose"])


def downgrade() -> None:
    op.drop_index("ix_passkey_challenges_user_purpose", table_name="passkey_challenges")
    op.drop_index("ix_passkey_challenges_purpose_expiry", table_name="passkey_challenges")
    op.drop_index("ix_passkey_challenges_user_id", table_name="passkey_challenges")
    op.drop_table("passkey_challenges")

    op.drop_index("ix_user_passkeys_credential_hash", table_name="user_passkeys")
    op.drop_index("ix_user_passkeys_user_created", table_name="user_passkeys")
    op.drop_index("ix_user_passkeys_user_id", table_name="user_passkeys")
    op.drop_table("user_passkeys")
