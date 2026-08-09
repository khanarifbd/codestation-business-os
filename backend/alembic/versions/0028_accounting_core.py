"""add accounting core

Revision ID: 0028_accounting_core
Revises: 0027_capital_funding
Create Date: 2026-08-09
"""
from collections.abc import Sequence
from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision: str = "0028_accounting_core"
down_revision: str | None = "0027_capital_funding"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ledger_accounts",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(32), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("category", sa.String(24), nullable=False),
        sa.Column("subtype", sa.String(48)),
        sa.Column("normal_balance", sa.String(8), nullable=False),
        sa.Column("parent_id", sa.String(36), sa.ForeignKey("ledger_accounts.id", ondelete="RESTRICT")),
        sa.Column("system_key", sa.String(64)),
        sa.Column("is_system", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("allow_manual_posting", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "code", name="uq_ledger_accounts_org_code"),
        sa.UniqueConstraint("organization_id", "system_key", name="uq_ledger_accounts_org_system_key"),
    )
    op.create_index("ix_ledger_accounts_org_category_active", "ledger_accounts", ["organization_id", "category", "is_active"])
    op.create_index("ix_ledger_accounts_org_parent", "ledger_accounts", ["organization_id", "parent_id"])

    op.create_table(
        "journal_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_number", sa.String(40), nullable=False),
        sa.Column("entry_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="posted"),
        sa.Column("source_type", sa.String(48), nullable=False, server_default="manual"),
        sa.Column("source_id", sa.String(36)),
        sa.Column("reference", sa.String(180)),
        sa.Column("memo", sa.Text()),
        sa.Column("reversed_entry_id", sa.String(36), sa.ForeignKey("journal_entries.id", ondelete="RESTRICT")),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("posted_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "entry_number", name="uq_journal_entries_org_number"),
    )
    op.create_index("ix_journal_entries_org_date_status", "journal_entries", ["organization_id", "entry_date", "status"])
    op.create_index("ix_journal_entries_org_source", "journal_entries", ["organization_id", "source_type", "source_id"])

    op.create_table(
        "journal_lines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("journal_entry_id", sa.String(36), sa.ForeignKey("journal_entries.id", ondelete="CASCADE"), nullable=False),
        sa.Column("ledger_account_id", sa.String(36), sa.ForeignKey("ledger_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("description", sa.String(500)),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("exchange_rate_to_base", sa.Numeric(18, 8), nullable=False, server_default="1"),
        sa.Column("debit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("credit", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("original_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)", name="ck_journal_lines_one_sided_amount"),
        sa.CheckConstraint("exchange_rate_to_base > 0", name="ck_journal_lines_positive_exchange_rate"),
    )
    op.create_index("ix_journal_lines_org_entry", "journal_lines", ["organization_id", "journal_entry_id"])
    op.create_index("ix_journal_lines_org_account", "journal_lines", ["organization_id", "ledger_account_id"])

    op.add_column("financial_accounts", sa.Column("ledger_account_id", sa.String(36), nullable=True))
    op.create_foreign_key(
        "fk_financial_accounts_ledger_account",
        "financial_accounts",
        "ledger_accounts",
        ["ledger_account_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_index("ix_financial_accounts_org_ledger", "financial_accounts", ["organization_id", "ledger_account_id"])

    bind = op.get_bind()
    organizations = bind.execute(sa.text("SELECT id FROM organizations ORDER BY created_at, id")).mappings().all()
    defaults = [
        ("1000", "Cash & Cash Equivalents", "asset", "cash_equivalents", "debit", "cash_equivalents", False, None),
        ("1100", "Accounts Receivable", "asset", "accounts_receivable", "debit", "accounts_receivable", True, None),
        ("1200", "Other Current Assets", "asset", "other_current_assets", "debit", "other_current_assets", True, None),
        ("1500", "Fixed Assets", "asset", "fixed_assets", "debit", "fixed_assets", True, None),
        ("2000", "Accounts Payable", "liability", "accounts_payable", "credit", "accounts_payable", True, None),
        ("2100", "Loans Payable", "liability", "loans_payable", "credit", "loans_payable", True, None),
        ("2200", "Taxes Payable", "liability", "taxes_payable", "credit", "taxes_payable", True, None),
        ("3000", "Owner's Equity", "equity", "owners_equity", "credit", "owners_equity", True, None),
        ("3100", "Opening Balance Equity", "equity", "opening_balance_equity", "credit", "opening_balance_equity", True, None),
        ("4000", "Sales Revenue", "income", "sales_revenue", "credit", "sales_revenue", True, None),
        ("4100", "Service Revenue", "income", "service_revenue", "credit", "service_revenue", True, None),
        ("4900", "Other Income", "income", "other_income", "credit", "other_income", True, None),
        ("5000", "Cost of Sales", "expense", "cost_of_sales", "debit", "cost_of_sales", True, None),
        ("6000", "Operating Expenses", "expense", "operating_expenses", "debit", "operating_expenses", True, None),
        ("6100", "Interest Expense", "expense", "interest_expense", "debit", "interest_expense", True, None),
        ("6200", "Bank & Processing Fees", "expense", "bank_fees", "debit", "bank_fees", True, None),
    ]

    for org in organizations:
        org_id = org["id"]
        ids: dict[str, str] = {}
        for code, name, category, subtype, normal, system_key, manual, parent_key in defaults:
            account_id = str(uuid4())
            ids[system_key] = account_id
            bind.execute(
                sa.text(
                    """
                    INSERT INTO ledger_accounts
                    (id, organization_id, code, name, category, subtype, normal_balance, parent_id, system_key, is_system, is_active, allow_manual_posting, created_at, updated_at)
                    VALUES
                    (:id, :organization_id, :code, :name, :category, :subtype, :normal_balance, :parent_id, :system_key, true, true, :allow_manual_posting, now(), now())
                    """
                ),
                {
                    "id": account_id,
                    "organization_id": org_id,
                    "code": code,
                    "name": name,
                    "category": category,
                    "subtype": subtype,
                    "normal_balance": normal,
                    "parent_id": ids.get(parent_key) if parent_key else None,
                    "system_key": system_key,
                    "allow_manual_posting": manual,
                },
            )

        financial_accounts = bind.execute(
            sa.text(
                "SELECT id, name, account_type FROM financial_accounts WHERE organization_id = :organization_id ORDER BY created_at, id"
            ),
            {"organization_id": org_id},
        ).mappings().all()
        for index, financial in enumerate(financial_accounts, start=1):
            ledger_id = str(uuid4())
            ledger_code = f"1010-{index:03d}"
            bind.execute(
                sa.text(
                    """
                    INSERT INTO ledger_accounts
                    (id, organization_id, code, name, category, subtype, normal_balance, parent_id, system_key, is_system, is_active, allow_manual_posting, created_at, updated_at)
                    VALUES
                    (:id, :organization_id, :code, :name, 'asset', :subtype, 'debit', :parent_id, :system_key, false, true, true, now(), now())
                    """
                ),
                {
                    "id": ledger_id,
                    "organization_id": org_id,
                    "code": ledger_code,
                    "name": financial["name"],
                    "subtype": financial["account_type"],
                    "parent_id": ids["cash_equivalents"],
                    "system_key": f"financial_account:{financial['id']}",
                },
            )
            bind.execute(
                sa.text("UPDATE financial_accounts SET ledger_account_id = :ledger_id WHERE id = :financial_id"),
                {"ledger_id": ledger_id, "financial_id": financial["id"]},
            )


def downgrade() -> None:
    op.drop_index("ix_financial_accounts_org_ledger", table_name="financial_accounts")
    op.drop_constraint("fk_financial_accounts_ledger_account", "financial_accounts", type_="foreignkey")
    op.drop_column("financial_accounts", "ledger_account_id")
    op.drop_index("ix_journal_lines_org_account", table_name="journal_lines")
    op.drop_index("ix_journal_lines_org_entry", table_name="journal_lines")
    op.drop_table("journal_lines")
    op.drop_index("ix_journal_entries_org_source", table_name="journal_entries")
    op.drop_index("ix_journal_entries_org_date_status", table_name="journal_entries")
    op.drop_table("journal_entries")
    op.drop_index("ix_ledger_accounts_org_parent", table_name="ledger_accounts")
    op.drop_index("ix_ledger_accounts_org_category_active", table_name="ledger_accounts")
    op.drop_table("ledger_accounts")
