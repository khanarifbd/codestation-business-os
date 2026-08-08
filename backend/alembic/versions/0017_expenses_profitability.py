"""add expenses vendors receipts and profitability storage

Revision ID: 0017_expenses_profitability
Revises: 0016_account_transfers
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0017_expenses_profitability"
down_revision: str | None = "0016_account_transfers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

DEFAULT_CATEGORIES = [
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
]


def upgrade() -> None:
    op.create_table(
        "vendors",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("vendor_code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(220), nullable=False),
        sa.Column("contact_name", sa.String(180), nullable=True),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(80), nullable=True),
        sa.Column("website", sa.String(1000), nullable=True),
        sa.Column("tax_identifier", sa.String(180), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("currency", sa.String(3), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "vendor_code", name="uq_vendors_org_code"),
    )
    op.create_index("ix_vendors_organization_id", "vendors", ["organization_id"])
    op.create_index("ix_vendors_org_active_name", "vendors", ["organization_id", "is_active", "name"])

    op.create_table(
        "expense_categories",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(140), nullable=False),
        sa.Column("slug", sa.String(160), nullable=False),
        sa.Column("cost_type", sa.String(24), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "slug", name="uq_expense_categories_org_slug"),
    )
    op.create_index("ix_expense_categories_organization_id", "expense_categories", ["organization_id"])
    op.create_index("ix_expense_categories_org_active_sort", "expense_categories", ["organization_id", "is_active", "sort_order"])

    op.create_table(
        "expenses",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("expense_number", sa.String(40), nullable=False),
        sa.Column("vendor_id", sa.String(36), nullable=True),
        sa.Column("category_id", sa.String(36), nullable=False),
        sa.Column("account_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=True),
        sa.Column("project_id", sa.String(36), nullable=True),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("expense_date", sa.Date(), nullable=False),
        sa.Column("expense_currency", sa.String(3), nullable=False),
        sa.Column("expense_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("account_currency", sa.String(3), nullable=False),
        sa.Column("account_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("profitability_currency", sa.String(3), nullable=False),
        sa.Column("profitability_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("profitability_exchange_rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("payment_method", sa.String(40), nullable=False),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "expense_number", name="uq_expenses_org_number"),
    )
    op.create_index("ix_expenses_organization_id", "expenses", ["organization_id"])
    op.create_index("ix_expenses_org_date", "expenses", ["organization_id", "expense_date", "created_at"])
    op.create_index("ix_expenses_org_status_date", "expenses", ["organization_id", "status", "expense_date"])
    op.create_index("ix_expenses_org_project_date", "expenses", ["organization_id", "project_id", "expense_date"])
    op.create_index("ix_expenses_org_client_date", "expenses", ["organization_id", "client_id", "expense_date"])
    op.create_index("ix_expenses_org_vendor_date", "expenses", ["organization_id", "vendor_id", "expense_date"])
    op.create_index("ix_expenses_org_category_date", "expenses", ["organization_id", "category_id", "expense_date"])
    op.create_index("ix_expenses_org_account_date", "expenses", ["organization_id", "account_id", "expense_date"])

    op.create_table(
        "expense_documents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("expense_id", sa.String(36), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(160), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("uploaded_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["expense_id"], ["expenses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_expense_documents_organization_id", "expense_documents", ["organization_id"])
    op.create_index("ix_expense_documents_org_expense_created", "expense_documents", ["organization_id", "expense_id", "created_at"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]

    for organization_id in organization_ids:
        for document_type, prefix in (("expense", "EXP"), ("vendor", "VND")):
            exists = bind.execute(sa.text("""
                SELECT 1 FROM organization_document_sequences
                WHERE organization_id=CAST(:organization_id AS VARCHAR(36))
                  AND document_type=CAST(:document_type AS VARCHAR(40))
                LIMIT 1
            """), {"organization_id": organization_id, "document_type": document_type}).scalar()
            if not exists:
                bind.execute(sa.text("""
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), CAST(:document_type AS VARCHAR(40)),
                         CAST(:prefix AS VARCHAR(24)), 1, 5, '-', :now, :now)
                """), {"id": str(uuid4()), "organization_id": organization_id, "document_type": document_type, "prefix": prefix, "now": now})

        for slug, name, cost_type, sort_order in DEFAULT_CATEGORIES:
            exists = bind.execute(sa.text("""
                SELECT 1 FROM expense_categories
                WHERE organization_id=CAST(:organization_id AS VARCHAR(36))
                  AND slug=CAST(:slug AS VARCHAR(160))
                LIMIT 1
            """), {"organization_id": organization_id, "slug": slug}).scalar()
            if not exists:
                bind.execute(sa.text("""
                    INSERT INTO expense_categories
                        (id, organization_id, name, slug, cost_type, is_active, sort_order, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), CAST(:name AS VARCHAR(140)),
                         CAST(:slug AS VARCHAR(160)), CAST(:cost_type AS VARCHAR(24)), true, :sort_order, :now, :now)
                """), {"id": str(uuid4()), "organization_id": organization_id, "name": name, "slug": slug, "cost_type": cost_type, "sort_order": sort_order, "now": now})

        bind.execute(sa.text("""
            INSERT INTO activity_logs
                (id, organization_id, actor_type, scope, action, entity_type, outcome, message, created_at)
            VALUES
                (:id, CAST(:organization_id AS VARCHAR(36)), 'system', 'tenant', 'system.expenses.initialized',
                 'organization', 'success', 'Expenses and profitability foundation initialized', :now)
        """), {"id": str(uuid4()), "organization_id": organization_id, "now": now})


def downgrade() -> None:
    op.drop_index("ix_expense_documents_org_expense_created", table_name="expense_documents")
    op.drop_index("ix_expense_documents_organization_id", table_name="expense_documents")
    op.drop_table("expense_documents")

    op.drop_index("ix_expenses_org_account_date", table_name="expenses")
    op.drop_index("ix_expenses_org_category_date", table_name="expenses")
    op.drop_index("ix_expenses_org_vendor_date", table_name="expenses")
    op.drop_index("ix_expenses_org_client_date", table_name="expenses")
    op.drop_index("ix_expenses_org_project_date", table_name="expenses")
    op.drop_index("ix_expenses_org_status_date", table_name="expenses")
    op.drop_index("ix_expenses_org_date", table_name="expenses")
    op.drop_index("ix_expenses_organization_id", table_name="expenses")
    op.drop_table("expenses")

    op.drop_index("ix_expense_categories_org_active_sort", table_name="expense_categories")
    op.drop_index("ix_expense_categories_organization_id", table_name="expense_categories")
    op.drop_table("expense_categories")

    op.drop_index("ix_vendors_org_active_name", table_name="vendors")
    op.drop_index("ix_vendors_organization_id", table_name="vendors")
    op.drop_table("vendors")
