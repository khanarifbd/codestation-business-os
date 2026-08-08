"""add targeted performance indexes

Revision ID: 0021_performance_indexes
Revises: 0020_recurring_auto_post
Create Date: 2026-08-08
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0021_performance_indexes"
down_revision: str | None = "0020_recurring_auto_post"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Reporting hot paths: tenant + accounting period + lifecycle/currency.
    op.create_index(
        "ix_invoices_org_issue_status_currency",
        "invoices",
        ["organization_id", "issue_date", "status", "currency"],
    )
    op.create_index(
        "ix_payments_org_date_status_currency",
        "payments",
        ["organization_id", "payment_date", "status", "invoice_currency"],
    )
    op.create_index(
        "ix_expenses_org_date_status_currency",
        "expenses",
        ["organization_id", "expense_date", "status", "expense_currency"],
    )
    op.create_index(
        "ix_account_transfers_org_date_status_currency",
        "account_transfers",
        ["organization_id", "transfer_date", "status", "source_currency"],
    )

    # Dashboard / notification attention queues should not scan all tenant tasks/leads.
    op.create_index(
        "ix_project_tasks_org_due_status",
        "project_tasks",
        ["organization_id", "due_date", "status"],
    )
    op.create_index(
        "ix_leads_org_followup_status",
        "leads",
        ["organization_id", "next_follow_up_at", "status_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_leads_org_followup_status", table_name="leads")
    op.drop_index("ix_project_tasks_org_due_status", table_name="project_tasks")
    op.drop_index("ix_account_transfers_org_date_status_currency", table_name="account_transfers")
    op.drop_index("ix_expenses_org_date_status_currency", table_name="expenses")
    op.drop_index("ix_payments_org_date_status_currency", table_name="payments")
    op.drop_index("ix_invoices_org_issue_status_currency", table_name="invoices")
