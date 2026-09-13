"""add quotation revision API integrity

Revision ID: 0076_quotation_v2_api
Revises: 0075_quotation_v2_structure
Create Date: 2026-09-11
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0076_quotation_v2_api"
down_revision: str | None = "0075_quotation_v2_structure"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # A revision family intentionally reuses the commercial quotation number.
    # The revision number is therefore part of the document-number uniqueness
    # contract while the existing family index protects lineage uniqueness.
    op.drop_constraint("uq_quotations_org_number", "quotations", type_="unique")
    op.create_unique_constraint(
        "uq_quotations_org_number_revision",
        "quotations",
        ["organization_id", "quotation_number", "revision_number"],
    )

    # Legacy PATCH behavior used to edit a sent/rejected quotation in place and
    # silently move it back to draft. V2 revisions must preserve the historical
    # document, so the database blocks that rollback even for older callers.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_quotation_reopen_to_draft()
        RETURNS trigger AS $$
        BEGIN
            IF OLD.status IN ('sent', 'rejected', 'accepted', 'cancelled')
               AND NEW.status = 'draft' THEN
                RAISE EXCEPTION 'Non-draft quotations are immutable; create a revision instead'
                    USING ERRCODE = '23514';
            END IF;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_quotations_prevent_reopen_to_draft
        BEFORE UPDATE ON quotations
        FOR EACH ROW
        EXECUTE FUNCTION prevent_quotation_reopen_to_draft()
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_quotations_prevent_reopen_to_draft ON quotations")
    op.execute("DROP FUNCTION IF EXISTS prevent_quotation_reopen_to_draft()")
    op.drop_constraint("uq_quotations_org_number_revision", "quotations", type_="unique")
    op.create_unique_constraint(
        "uq_quotations_org_number",
        "quotations",
        ["organization_id", "quotation_number"],
    )
