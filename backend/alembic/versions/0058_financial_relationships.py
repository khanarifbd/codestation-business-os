"""link expenses to sales records and add generic fee categories

Revision ID: 0058_financial_relationships
Revises: 0057_client_sources_profiles
Create Date: 2026-08-19
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0058_financial_relationships"
down_revision: str | None = "0057_client_sources_profiles"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FEE_CATEGORIES = (
    ("marketplace-platform-fees", "Sales & Marketplace Fees", "financial", 105),
    ("payment-processing-fees", "Payment Processing Fees", "financial", 108),
)


def upgrade() -> None:
    op.add_column("expenses", sa.Column("order_id", sa.String(36), nullable=True))
    op.add_column("expenses", sa.Column("invoice_id", sa.String(36), nullable=True))
    op.add_column("expenses", sa.Column("payment_id", sa.String(36), nullable=True))
    op.create_foreign_key("fk_expenses_order", "expenses", "orders", ["order_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_expenses_invoice", "expenses", "invoices", ["invoice_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_expenses_payment", "expenses", "payments", ["payment_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_expenses_org_order_date", "expenses", ["organization_id", "order_id", "expense_date"])
    op.create_index("ix_expenses_org_invoice_date", "expenses", ["organization_id", "invoice_id", "expense_date"])
    op.create_index("ix_expenses_org_payment_date", "expenses", ["organization_id", "payment_id", "expense_date"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        inserted = 0
        for slug, name, cost_type, sort_order in FEE_CATEGORIES:
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
                         'system.expense_fee_defaults.backfilled', 'organization', CAST(:organization_id AS VARCHAR(36)),
                         'success', 'Generic financial fee categories backfilled', CAST(:metadata_json AS JSONB), :now)
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
    op.drop_index("ix_expenses_org_payment_date", table_name="expenses")
    op.drop_index("ix_expenses_org_invoice_date", table_name="expenses")
    op.drop_index("ix_expenses_org_order_date", table_name="expenses")
    op.drop_constraint("fk_expenses_payment", "expenses", type_="foreignkey")
    op.drop_constraint("fk_expenses_invoice", "expenses", type_="foreignkey")
    op.drop_constraint("fk_expenses_order", "expenses", type_="foreignkey")
    op.drop_column("expenses", "payment_id")
    op.drop_column("expenses", "invoice_id")
    op.drop_column("expenses", "order_id")
    # Fee categories are intentionally retained: they may already be referenced
    # by posted expenses and deleting them would corrupt historical records.
