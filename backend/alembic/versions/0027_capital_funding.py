"""add capital funding

Revision ID: 0027_capital_funding
Revises: 0026_hr_holidays_policy_ack
Create Date: 2026-08-09
"""
from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "0027_capital_funding"
down_revision: str | None = "0026_hr_holidays_policy_ack"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _common():
    return [
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table("company_loans", *_common(),
        sa.Column("lender_name", sa.String(220), nullable=False), sa.Column("lender_type", sa.String(32), nullable=False, server_default="other"),
        sa.Column("reference", sa.String(180)), sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("principal_amount", sa.Numeric(18,2), nullable=False), sa.Column("outstanding_principal", sa.Numeric(18,2), nullable=False),
        sa.Column("annual_interest_rate", sa.Numeric(9,4), nullable=False, server_default="0"), sa.Column("loan_date", sa.Date(), nullable=False),
        sa.Column("maturity_date", sa.Date()), sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT")),
        sa.Column("status", sa.String(24), nullable=False, server_default="active"), sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_company_loans_org_status_due", "company_loans", ["organization_id","status","maturity_date"])
    op.create_index("ix_company_loans_org_account", "company_loans", ["organization_id","account_id"])

    op.create_table("loan_repayments", *_common(), sa.Column("loan_id", sa.String(36), sa.ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False), sa.Column("payment_date", sa.Date(), nullable=False),
        sa.Column("principal_amount", sa.Numeric(18,2), nullable=False, server_default="0"), sa.Column("interest_amount", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(180)), sa.Column("notes", sa.Text()), sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_loan_repayments_org_loan_date", "loan_repayments", ["organization_id","loan_id","payment_date"])

    op.create_table("company_investments", *_common(), sa.Column("investee_name", sa.String(220), nullable=False), sa.Column("investment_type", sa.String(32), nullable=False, server_default="other"),
        sa.Column("currency", sa.String(3), nullable=False), sa.Column("invested_amount", sa.Numeric(18,2), nullable=False), sa.Column("carrying_value", sa.Numeric(18,2), nullable=False),
        sa.Column("ownership_percent", sa.Numeric(9,4)), sa.Column("investment_date", sa.Date(), nullable=False), sa.Column("expected_exit_date", sa.Date()),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT")), sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("reference", sa.String(180)), sa.Column("notes", sa.Text()), sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_company_investments_org_status", "company_investments", ["organization_id","status","investment_date"])
    op.create_index("ix_company_investments_org_account", "company_investments", ["organization_id","account_id"])

    op.create_table("investment_returns", *_common(), sa.Column("investment_id", sa.String(36), sa.ForeignKey("company_investments.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False), sa.Column("return_date", sa.Date(), nullable=False),
        sa.Column("return_type", sa.String(32), nullable=False, server_default="profit"), sa.Column("cash_amount", sa.Numeric(18,2), nullable=False),
        sa.Column("principal_return_amount", sa.Numeric(18,2), nullable=False, server_default="0"), sa.Column("income_amount", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(180)), sa.Column("notes", sa.Text()), sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_investment_returns_org_investment_date", "investment_returns", ["organization_id","investment_id","return_date"])

    op.create_table("project_investors", *_common(), sa.Column("project_id", sa.String(36), sa.ForeignKey("projects.id", ondelete="CASCADE"), nullable=False),
        sa.Column("investor_name", sa.String(220), nullable=False), sa.Column("investor_email", sa.String(320)), sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("invested_amount", sa.Numeric(18,2), nullable=False), sa.Column("investment_date", sa.Date(), nullable=False),
        sa.Column("share_type", sa.String(24), nullable=False, server_default="profit_percent"), sa.Column("share_value", sa.Numeric(12,4), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT")), sa.Column("status", sa.String(24), nullable=False, server_default="active"),
        sa.Column("agreement_reference", sa.String(180)), sa.Column("notes", sa.Text()), sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()), sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()))
    op.create_index("ix_project_investors_org_project_status", "project_investors", ["organization_id","project_id","status"])
    op.create_index("ix_project_investors_org_account", "project_investors", ["organization_id","account_id"])

    op.create_table("investor_payouts", *_common(), sa.Column("investor_id", sa.String(36), sa.ForeignKey("project_investors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False), sa.Column("payout_date", sa.Date(), nullable=False),
        sa.Column("principal_return_amount", sa.Numeric(18,2), nullable=False, server_default="0"), sa.Column("profit_share_amount", sa.Numeric(18,2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(180)), sa.Column("notes", sa.Text()), sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id","investor_id","reference", name="uq_investor_payouts_org_investor_reference"))
    op.create_index("ix_investor_payouts_org_investor_date", "investor_payouts", ["organization_id","investor_id","payout_date"])


def downgrade() -> None:
    for table, indexes in [
        ("investor_payouts",["ix_investor_payouts_org_investor_date"]), ("project_investors",["ix_project_investors_org_account","ix_project_investors_org_project_status"]),
        ("investment_returns",["ix_investment_returns_org_investment_date"]), ("company_investments",["ix_company_investments_org_account","ix_company_investments_org_status"]),
        ("loan_repayments",["ix_loan_repayments_org_loan_date"]), ("company_loans",["ix_company_loans_org_account","ix_company_loans_org_status_due"])]:
        for idx in indexes: op.drop_index(idx, table_name=table)
        op.drop_table(table)
