"""backfill expense defaults for organizations created after expense foundation

Revision ID: 0045_expense_defaults
Revises: 0044_sales_reversal_integrity
Create Date: 2026-08-17
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0045_expense_defaults"
down_revision: str | None = "0044_sales_reversal_integrity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_CATEGORIES = (
    ("software-subscriptions", "Software & Subscriptions", "operating", 10),
    ("hosting-cloud", "Hosting & Cloud", "direct", 20),
    ("contractor-freelance", "Contractor & Freelance", "direct", 30),
    ("payroll-benefits", "Payroll & Benefits", "operating", 40),
    ("office-utilities", "Office & Utilities", "operating", 50),
    ("marketing-advertising", "Marketing & Advertising", "operating", 60),
    ("travel-transport", "Travel & Transport", "operating", 70),
    ("equipment-hardware", "Equipment & Hardware", "operating", 80),
    ("professional-services", "Professional Services", "operating", 90),
    ("taxes-government-fees", "Taxes & Government Fees", "tax", 100),
    ("bank-financial-charges", "Bank & Financial Charges", "financial", 110),
    ("other", "Other", "other", 999),
)


def upgrade() -> None:
    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]

    for organization_id in organization_ids:
        inserted = 0
        for slug, name, cost_type, sort_order in DEFAULT_CATEGORIES:
            exists = bind.execute(
                sa.text(
                    """
                    SELECT 1 FROM expense_categories
                    WHERE organization_id=CAST(:organization_id AS VARCHAR(36))
                      AND slug=CAST(:slug AS VARCHAR(160))
                    LIMIT 1
                    """
                ),
                {"organization_id": organization_id, "slug": slug},
            ).scalar()
            if exists:
                continue
            bind.execute(
                sa.text(
                    """
                    INSERT INTO expense_categories
                        (id, organization_id, name, slug, cost_type, is_active, sort_order, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), CAST(:name AS VARCHAR(140)),
                         CAST(:slug AS VARCHAR(160)), CAST(:cost_type AS VARCHAR(24)), true, :sort_order, :now, :now)
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "name": name,
                    "slug": slug,
                    "cost_type": cost_type,
                    "sort_order": sort_order,
                    "now": now,
                },
            )
            inserted += 1

        if inserted:
            bind.execute(
                sa.text(
                    """
                    INSERT INTO activity_logs
                        (id, organization_id, actor_type, scope, action, entity_type, entity_id,
                         outcome, message, metadata_json, created_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), 'system', 'tenant',
                         'system.expense_defaults.backfilled', 'organization', CAST(:organization_id AS VARCHAR(36)),
                         'success', 'Missing default expense categories backfilled', CAST(:metadata_json AS JSONB), :now)
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "metadata_json": f'{{"categories_created": {inserted}}}',
                    "now": now,
                },
            )


def downgrade() -> None:
    # Data-only repair is intentionally non-destructive. Categories may already be
    # referenced by historical expenses after this migration has run.
    pass
