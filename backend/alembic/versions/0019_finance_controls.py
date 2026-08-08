"""add recurring expenses and accounting period closing

Revision ID: 0019_finance_controls
Revises: 0018_exchange_rate_settings
Create Date: 2026-08-08
"""
from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0019_finance_controls"
down_revision: str | None = "0018_exchange_rate_settings"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "recurring_expenses",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("description", sa.String(500), nullable=False),
        sa.Column("vendor_id", sa.String(36), nullable=True),
        sa.Column("category_id", sa.String(36), nullable=False),
        sa.Column("account_id", sa.String(36), nullable=False),
        sa.Column("client_id", sa.String(36), nullable=True),
        sa.Column("project_id", sa.String(36), nullable=True),
        sa.Column("expense_currency", sa.String(3), nullable=False),
        sa.Column("expense_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("frequency", sa.String(24), nullable=False),
        sa.Column("interval_count", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("next_due_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=True),
        sa.Column("payment_method", sa.String(40), nullable=False, server_default="bank_transfer"),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_posted_expense_id", sa.String(36), nullable=True),
        sa.Column("last_posted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["category_id"], ["expense_categories.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["client_id"], ["clients.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["last_posted_expense_id"], ["expenses.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "name", name="uq_recurring_expenses_org_name"),
        sa.CheckConstraint("expense_amount > 0", name="ck_recurring_expense_amount_positive"),
        sa.CheckConstraint("interval_count > 0", name="ck_recurring_expense_interval_positive"),
        sa.CheckConstraint("frequency IN ('weekly','monthly','quarterly','yearly')", name="ck_recurring_expense_frequency"),
    )
    op.create_index("ix_recurring_expenses_org_active_due", "recurring_expenses", ["organization_id", "is_active", "next_due_date"])

    op.create_table(
        "accounting_periods",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("end_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("close_notes", sa.Text(), nullable=True),
        sa.Column("closed_by_user_id", sa.String(36), nullable=True),
        sa.Column("closed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopened_by_user_id", sa.String(36), nullable=True),
        sa.Column("reopened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("reopen_reason", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["closed_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reopened_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "start_date", "end_date", name="uq_accounting_periods_org_range"),
        sa.CheckConstraint("start_date <= end_date", name="ck_accounting_period_dates"),
        sa.CheckConstraint("status IN ('open','closed')", name="ck_accounting_period_status"),
    )
    op.create_index("ix_accounting_periods_org_status_dates", "accounting_periods", ["organization_id", "status", "start_date", "end_date"])

    # Seed a dedicated marketplace/platform fee category without touching tenants that already created one.
    op.execute(sa.text("""
        INSERT INTO expense_categories (id, organization_id, name, slug, cost_type, is_active, sort_order, created_at, updated_at)
        SELECT gen_random_uuid()::text, o.id, 'Marketplace & Platform Fees', 'marketplace-platform-fees', 'direct', true, 115, now(), now()
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM expense_categories c
            WHERE c.organization_id = o.id AND c.slug = 'marketplace-platform-fees'
        )
    """))

    # Database-level period protection. Application permissions cannot bypass this invariant.
    op.execute("""
        CREATE OR REPLACE FUNCTION enforce_open_accounting_period()
        RETURNS trigger AS $$
        DECLARE
            row_data jsonb;
            org_id text;
            finance_date date;
        BEGIN
            row_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
            org_id := row_data ->> 'organization_id';
            finance_date := (row_data ->> TG_ARGV[0])::date;
            IF finance_date IS NOT NULL AND EXISTS (
                SELECT 1 FROM accounting_periods p
                WHERE p.organization_id = org_id
                  AND p.status = 'closed'
                  AND finance_date BETWEEN p.start_date AND p.end_date
            ) THEN
                RAISE EXCEPTION 'Accounting period is closed for date %', finance_date USING ERRCODE = '23514';
            END IF;
            RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
        END;
        $$ LANGUAGE plpgsql;
    """)
    op.execute("CREATE TRIGGER trg_expenses_open_period BEFORE INSERT OR UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION enforce_open_accounting_period('expense_date')")
    op.execute("CREATE TRIGGER trg_payments_open_period BEFORE INSERT OR UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION enforce_open_accounting_period('payment_date')")
    op.execute("CREATE TRIGGER trg_transfers_open_period BEFORE INSERT OR UPDATE OR DELETE ON account_transfers FOR EACH ROW EXECUTE FUNCTION enforce_open_accounting_period('transfer_date')")


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_transfers_open_period ON account_transfers")
    op.execute("DROP TRIGGER IF EXISTS trg_payments_open_period ON payments")
    op.execute("DROP TRIGGER IF EXISTS trg_expenses_open_period ON expenses")
    op.execute("DROP FUNCTION IF EXISTS enforce_open_accounting_period()")
    op.drop_index("ix_accounting_periods_org_status_dates", table_name="accounting_periods")
    op.drop_table("accounting_periods")
    op.drop_index("ix_recurring_expenses_org_active_due", table_name="recurring_expenses")
    op.drop_table("recurring_expenses")
