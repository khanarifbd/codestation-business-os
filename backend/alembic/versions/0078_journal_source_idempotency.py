"""enforce one journal per operational source

Revision ID: 0078_journal_source_idempotency
Revises: 0077_quotation_order_billing
Create Date: 2026-09-17
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0078_journal_source_idempotency"
down_revision: str | None = "0077_quotation_order_billing"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_DUPLICATE_GROUPS_SQL = sa.text(
    """
    SELECT organization_id, source_type, source_id, COUNT(*) AS journal_count
    FROM journal_entries
    WHERE source_id IS NOT NULL
    GROUP BY organization_id, source_type, source_id
    HAVING COUNT(*) > 1
    ORDER BY COUNT(*) DESC, organization_id, source_type, source_id
    LIMIT 10
    """
)


def upgrade() -> None:
    bind = op.get_bind()
    duplicate_groups = bind.execute(_DUPLICATE_GROUPS_SQL).mappings().all()
    if duplicate_groups:
        sample = "; ".join(
            f"org={row['organization_id']} source={row['source_type']}/{row['source_id']} count={row['journal_count']}"
            for row in duplicate_groups
        )
        raise RuntimeError(
            "Cannot enforce journal source idempotency because duplicate source-backed journals already exist. "
            f"Sample duplicate groups: {sample}. "
            "Run the read-only accounting integrity audit and resolve the affected financial records through the approved correction workflow before retrying this migration."
        )

    # Preserve the existing lookup index name while upgrading it to a database
    # uniqueness invariant. PostgreSQL unique indexes allow multiple NULL values,
    # so manual/source-less journals remain unrestricted.
    op.drop_index("ix_journal_entries_org_source", table_name="journal_entries")
    op.create_index(
        "ix_journal_entries_org_source",
        "journal_entries",
        ["organization_id", "source_type", "source_id"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("ix_journal_entries_org_source", table_name="journal_entries")
    op.create_index(
        "ix_journal_entries_org_source",
        "journal_entries",
        ["organization_id", "source_type", "source_id"],
        unique=False,
    )
