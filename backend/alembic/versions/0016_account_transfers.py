"""add account transfers

Revision ID: 0016_account_transfers
Revises: 0015_finance_sequence_hardening
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0016_account_transfers"
down_revision: str | None = "0015_finance_sequence_hardening"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "account_transfers",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("transfer_number", sa.String(40), nullable=False),
        sa.Column("from_account_id", sa.String(36), nullable=False),
        sa.Column("to_account_id", sa.String(36), nullable=False),
        sa.Column("transfer_date", sa.Date(), nullable=False),
        sa.Column("source_currency", sa.String(3), nullable=False),
        sa.Column("destination_currency", sa.String(3), nullable=False),
        sa.Column("source_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("fee_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_source_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("destination_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["from_account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["to_account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "transfer_number", name="uq_account_transfers_org_number"),
    )
    op.create_index("ix_account_transfers_organization_id", "account_transfers", ["organization_id"])
    op.create_index("ix_account_transfers_org_date", "account_transfers", ["organization_id", "transfer_date", "created_at"])
    op.create_index("ix_account_transfers_org_from_date", "account_transfers", ["organization_id", "from_account_id", "transfer_date"])
    op.create_index("ix_account_transfers_org_to_date", "account_transfers", ["organization_id", "to_account_id", "transfer_date"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        exists = bind.execute(
            sa.text(
                """
                SELECT 1 FROM organization_document_sequences
                WHERE organization_id=CAST(:organization_id AS VARCHAR(36))
                  AND document_type='transfer'
                LIMIT 1
                """
            ),
            {"organization_id": organization_id},
        ).scalar()
        if not exists:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding,
                         separator, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), 'transfer', 'TRF', 1, 5, '-', :now, :now)
                    """
                ),
                {"id": str(uuid4()), "organization_id": organization_id, "now": now},
            )
        bind.execute(
            sa.text(
                """
                INSERT INTO activity_logs
                    (id, organization_id, actor_type, scope, action, entity_type, outcome, message, created_at)
                VALUES
                    (:id, CAST(:organization_id AS VARCHAR(36)), 'system', 'tenant',
                     'system.finance.transfers_initialized', 'organization', 'success',
                     'Account transfer and FX tracking initialized', :now)
                """
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )


def downgrade() -> None:
    op.drop_index("ix_account_transfers_org_to_date", table_name="account_transfers")
    op.drop_index("ix_account_transfers_org_from_date", table_name="account_transfers")
    op.drop_index("ix_account_transfers_org_date", table_name="account_transfers")
    op.drop_index("ix_account_transfers_organization_id", table_name="account_transfers")
    op.drop_table("account_transfers")
