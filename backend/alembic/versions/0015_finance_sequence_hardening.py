"""harden finance document sequences

Revision ID: 0015_finance_sequence_hardening
Revises: 0014_finance_foundation
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0015_finance_sequence_hardening"
down_revision: str | None = "0014_finance_foundation"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    sequence_defaults = {"invoice": "INV", "payment": "PAY"}
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]

    for organization_id in organization_ids:
        for document_type, prefix in sequence_defaults.items():
            exists = bind.execute(
                sa.text(
                    """
                    SELECT 1
                    FROM organization_document_sequences
                    WHERE organization_id=CAST(:organization_id AS VARCHAR(36))
                      AND document_type=CAST(:document_type AS VARCHAR(40))
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "document_type": document_type},
            ).scalar()
            if exists:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding,
                         separator, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)),
                         CAST(:document_type AS VARCHAR(40)), CAST(:prefix AS VARCHAR(24)),
                         1, 5, '-', :now, :now)
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "document_type": document_type,
                    "prefix": prefix,
                    "now": now,
                },
            )


def downgrade() -> None:
    # Sequences may have been used by real financial documents after creation.
    # Do not delete them during downgrade.
    pass
