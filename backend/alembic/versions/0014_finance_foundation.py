"""add finance foundation

Revision ID: 0014_finance_foundation
Revises: 0013_project_execution
Create Date: 2026-08-08
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4

from alembic import op
import sqlalchemy as sa

revision: str = "0014_finance_foundation"
down_revision: str | None = "0013_project_execution"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "financial_accounts",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("account_type", sa.String(32), nullable=False),
        sa.Column("provider_name", sa.String(120), nullable=True),
        sa.Column("account_holder_name", sa.String(180), nullable=True),
        sa.Column("account_reference", sa.String(180), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", "currency", name="uq_financial_accounts_org_name_currency"),
    )
    op.create_index("ix_financial_accounts_organization_id", "financial_accounts", ["organization_id"])
    op.create_index("ix_financial_accounts_org_active_type", "financial_accounts", ["organization_id", "is_active", "account_type"])

    op.create_table(
        "invoices",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("invoice_number", sa.String(40), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=False),
        sa.Column("order_id", sa.String(36), nullable=True),
        sa.Column("project_id", sa.String(36), nullable=True),
        sa.Column("quotation_id", sa.String(36), nullable=True),
        sa.Column("assigned_employee_id", sa.String(36), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("subject", sa.String(220), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("tax_calculation_mode", sa.String(16), nullable=False),
        sa.Column("seller_name_snapshot", sa.String(220), nullable=False),
        sa.Column("seller_email_snapshot", sa.String(320), nullable=True),
        sa.Column("seller_address_snapshot", sa.Text(), nullable=True),
        sa.Column("seller_tax_identifier_snapshot", sa.String(180), nullable=True),
        sa.Column("client_name_snapshot", sa.String(220), nullable=False),
        sa.Column("client_contact_snapshot", sa.String(180), nullable=True),
        sa.Column("client_email_snapshot", sa.String(320), nullable=True),
        sa.Column("client_address_snapshot", sa.Text(), nullable=True),
        sa.Column("client_tax_identifier_snapshot", sa.String(180), nullable=True),
        sa.Column("subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("total", sa.Numeric(16, 2), nullable=False),
        sa.Column("amount_paid", sa.Numeric(16, 2), nullable=False),
        sa.Column("balance_due", sa.Numeric(16, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("terms_conditions", sa.Text(), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["order_id"], ["orders.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["quotation_id"], ["quotations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["assigned_employee_id"], ["employees.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "invoice_number", name="uq_invoices_org_number"),
    )
    op.create_index("ix_invoices_organization_id", "invoices", ["organization_id"])
    op.create_index("ix_invoices_org_status_created", "invoices", ["organization_id", "status", "created_at"])
    op.create_index("ix_invoices_org_client_created", "invoices", ["organization_id", "client_id", "created_at"])
    op.create_index("ix_invoices_org_due_date", "invoices", ["organization_id", "due_date"])
    op.create_index("ix_invoices_org_order", "invoices", ["organization_id", "order_id"])
    op.create_index("ix_invoices_org_project", "invoices", ["organization_id", "project_id"])

    op.create_table(
        "invoice_items",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("invoice_id", sa.String(36), nullable=False),
        sa.Column("source_order_item_id", sa.String(36), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_price", sa.Numeric(16, 4), nullable=False),
        sa.Column("discount_percent", sa.Numeric(7, 4), nullable=False),
        sa.Column("tax_rate", sa.Numeric(8, 4), nullable=False),
        sa.Column("line_subtotal", sa.Numeric(16, 2), nullable=False),
        sa.Column("discount_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("taxable_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("tax_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(16, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_order_item_id"], ["order_items.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_invoice_items_organization_id", "invoice_items", ["organization_id"])
    op.create_index("ix_invoice_items_org_invoice_sort", "invoice_items", ["organization_id", "invoice_id", "sort_order"])

    op.create_table(
        "payments",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("payment_number", sa.String(40), nullable=False),
        sa.Column("invoice_id", sa.String(36), nullable=False),
        sa.Column("account_id", sa.String(36), nullable=False),
        sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("invoice_currency", sa.String(3), nullable=False),
        sa.Column("account_currency", sa.String(3), nullable=False),
        sa.Column("invoice_amount", sa.Numeric(16, 2), nullable=False),
        sa.Column("account_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("exchange_rate", sa.Numeric(18, 8), nullable=False),
        sa.Column("method", sa.String(40), nullable=False),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["invoice_id"], ["invoices.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "payment_number", name="uq_payments_org_number"),
    )
    op.create_index("ix_payments_organization_id", "payments", ["organization_id"])
    op.create_index("ix_payments_org_invoice_created", "payments", ["organization_id", "invoice_id", "created_at"])
    op.create_index("ix_payments_org_account_date", "payments", ["organization_id", "account_id", "payment_date"])

    op.create_table(
        "financial_transactions",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("account_id", sa.String(36), nullable=False),
        sa.Column("transaction_date", sa.Date(), nullable=False),
        sa.Column("direction", sa.String(12), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_id", sa.String(36), nullable=False),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "account_id", "source_type", "source_id", "direction", name="uq_financial_transactions_source"),
    )
    op.create_index("ix_financial_transactions_organization_id", "financial_transactions", ["organization_id"])
    op.create_index("ix_financial_transactions_org_account_date", "financial_transactions", ["organization_id", "account_id", "transaction_date", "created_at"])
    op.create_index("ix_financial_transactions_org_source", "financial_transactions", ["organization_id", "source_type", "source_id"])

    bind = op.get_bind()
    now = datetime.now(timezone.utc)
    organization_ids = [row[0] for row in bind.execute(sa.text("SELECT id FROM organizations")).all()]
    for organization_id in organization_ids:
        exists = bind.execute(
            sa.text("SELECT 1 FROM organization_document_sequences WHERE organization_id=CAST(:organization_id AS VARCHAR(36)) AND document_type='payment' LIMIT 1"),
            {"organization_id": organization_id},
        ).scalar()
        if not exists:
            bind.execute(
                sa.text("""
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
                    VALUES
                        (:id, CAST(:organization_id AS VARCHAR(36)), 'payment', 'PAY', 1, 5, '-', :now, :now)
                """),
                {"id": str(uuid4()), "organization_id": organization_id, "now": now},
            )
        bind.execute(
            sa.text("""
                INSERT INTO activity_logs
                    (id, organization_id, actor_type, scope, action, entity_type, outcome, message, created_at)
                VALUES
                    (:id, CAST(:organization_id AS VARCHAR(36)), 'system', 'tenant', 'system.finance.initialized', 'organization', 'success', 'Finance foundation initialized', :now)
            """),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )


def downgrade() -> None:
    op.drop_index("ix_financial_transactions_org_source", table_name="financial_transactions")
    op.drop_index("ix_financial_transactions_org_account_date", table_name="financial_transactions")
    op.drop_index("ix_financial_transactions_organization_id", table_name="financial_transactions")
    op.drop_table("financial_transactions")
    op.drop_index("ix_payments_org_account_date", table_name="payments")
    op.drop_index("ix_payments_org_invoice_created", table_name="payments")
    op.drop_index("ix_payments_organization_id", table_name="payments")
    op.drop_table("payments")
    op.drop_index("ix_invoice_items_org_invoice_sort", table_name="invoice_items")
    op.drop_index("ix_invoice_items_organization_id", table_name="invoice_items")
    op.drop_table("invoice_items")
    op.drop_index("ix_invoices_org_project", table_name="invoices")
    op.drop_index("ix_invoices_org_order", table_name="invoices")
    op.drop_index("ix_invoices_org_due_date", table_name="invoices")
    op.drop_index("ix_invoices_org_client_created", table_name="invoices")
    op.drop_index("ix_invoices_org_status_created", table_name="invoices")
    op.drop_index("ix_invoices_organization_id", table_name="invoices")
    op.drop_table("invoices")
    op.drop_index("ix_financial_accounts_org_active_type", table_name="financial_accounts")
    op.drop_index("ix_financial_accounts_organization_id", table_name="financial_accounts")
    op.drop_table("financial_accounts")
