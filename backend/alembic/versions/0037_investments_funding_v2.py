"""expand investments and funding with company investors and installment history

Revision ID: 0037_investments_funding_v2
Revises: 0036_multi_org_relationships
"""

import sqlalchemy as sa
from alembic import op

revision = "0037_investments_funding_v2"
down_revision = "0036_multi_org_relationships"
branch_labels = None
depends_on = None


def _funding_columns(parent_table: str, parent_column: str = "investor_id", account_nullable: bool = True):
    return [
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column(parent_column, sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=account_nullable),
        sa.Column("funding_date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference", sa.String(length=180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint([parent_column], [f"{parent_table}.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    ]


def upgrade() -> None:
    op.create_table(
        "company_investors",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("investor_name", sa.String(length=220), nullable=False),
        sa.Column("investor_email", sa.String(length=320), nullable=True),
        sa.Column("investor_type", sa.String(length=24), nullable=False, server_default="individual"),
        sa.Column("instrument", sa.String(length=32), nullable=False, server_default="equity"),
        sa.Column("currency", sa.String(length=3), nullable=False),
        sa.Column("committed_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("funded_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("ownership_percent", sa.Numeric(9, 4), nullable=True),
        sa.Column("valuation_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("agreement_date", sa.Date(), nullable=False),
        sa.Column("effective_date", sa.Date(), nullable=True),
        sa.Column("expected_exit_date", sa.Date(), nullable=True),
        sa.Column("agreement_reference", sa.String(length=180), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False, server_default="active"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_company_investors_organization_id", "company_investors", ["organization_id"])
    op.create_index("ix_company_investors_org_status", "company_investors", ["organization_id", "status"])
    op.create_index("ix_company_investors_org_email", "company_investors", ["organization_id", "investor_email"])

    op.create_table(
        "company_investor_fundings",
        *_funding_columns("company_investors", account_nullable=False),
        sa.UniqueConstraint("organization_id", "investor_id", "reference", name="uq_company_investor_funding_reference"),
    )
    op.create_index("ix_company_investor_fundings_organization_id", "company_investor_fundings", ["organization_id"])
    op.create_index("ix_company_investor_fundings_org_investor_date", "company_investor_fundings", ["organization_id", "investor_id", "funding_date"])

    op.create_table(
        "company_investor_payouts",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("investor_id", sa.String(length=36), nullable=False),
        sa.Column("account_id", sa.String(length=36), nullable=False),
        sa.Column("payout_date", sa.Date(), nullable=False),
        sa.Column("principal_return_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("profit_share_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("reference", sa.String(length=180), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["investor_id"], ["company_investors.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["account_id"], ["financial_accounts.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "investor_id", "reference", name="uq_company_investor_payout_reference"),
    )
    op.create_index("ix_company_investor_payouts_organization_id", "company_investor_payouts", ["organization_id"])
    op.create_index("ix_company_investor_payouts_org_investor_date", "company_investor_payouts", ["organization_id", "investor_id", "payout_date"])

    op.create_table(
        "company_investment_fundings",
        *_funding_columns("company_investments", parent_column="investment_id", account_nullable=True),
        sa.UniqueConstraint("organization_id", "investment_id", "reference", name="uq_company_investment_funding_reference"),
    )
    op.create_index("ix_company_investment_fundings_organization_id", "company_investment_fundings", ["organization_id"])
    op.create_index("ix_company_investment_fundings_org_investment_date", "company_investment_fundings", ["organization_id", "investment_id", "funding_date"])

    op.add_column("project_investors", sa.Column("committed_amount", sa.Numeric(18, 2), nullable=True))
    op.add_column("project_investors", sa.Column("funded_amount", sa.Numeric(18, 2), nullable=True))
    op.execute("UPDATE project_investors SET committed_amount = invested_amount, funded_amount = invested_amount")
    op.alter_column("project_investors", "committed_amount", nullable=False)
    op.alter_column("project_investors", "funded_amount", nullable=False)

    op.create_table(
        "project_investor_fundings",
        *_funding_columns("project_investors", account_nullable=True),
        sa.UniqueConstraint("organization_id", "investor_id", "reference", name="uq_project_investor_funding_reference"),
    )
    op.create_index("ix_project_investor_fundings_organization_id", "project_investor_fundings", ["organization_id"])
    op.create_index("ix_project_investor_fundings_org_investor_date", "project_investor_fundings", ["organization_id", "investor_id", "funding_date"])

    # Preserve pre-v2 activity as an initial funding row. Reusing the parent UUID is
    # safe because the new tables have independent primary-key namespaces.
    op.execute(
        """
        INSERT INTO company_investment_fundings
            (id, organization_id, investment_id, account_id, funding_date, amount, reference, notes, created_by_user_id, created_at)
        SELECT id, organization_id, id, account_id, investment_date, invested_amount, reference,
               'Migrated initial investment funding', created_by_user_id, created_at
        FROM company_investments
        WHERE invested_amount > 0
        """
    )
    op.execute(
        """
        INSERT INTO project_investor_fundings
            (id, organization_id, investor_id, account_id, funding_date, amount, reference, notes, created_by_user_id, created_at)
        SELECT id, organization_id, id, account_id, investment_date, invested_amount, agreement_reference,
               'Migrated initial project investor funding', created_by_user_id, created_at
        FROM project_investors
        WHERE invested_amount > 0
        """
    )


def downgrade() -> None:
    op.drop_index("ix_project_investor_fundings_org_investor_date", table_name="project_investor_fundings")
    op.drop_index("ix_project_investor_fundings_organization_id", table_name="project_investor_fundings")
    op.drop_table("project_investor_fundings")
    op.drop_column("project_investors", "funded_amount")
    op.drop_column("project_investors", "committed_amount")
    op.drop_index("ix_company_investment_fundings_org_investment_date", table_name="company_investment_fundings")
    op.drop_index("ix_company_investment_fundings_organization_id", table_name="company_investment_fundings")
    op.drop_table("company_investment_fundings")
    op.drop_index("ix_company_investor_payouts_org_investor_date", table_name="company_investor_payouts")
    op.drop_index("ix_company_investor_payouts_organization_id", table_name="company_investor_payouts")
    op.drop_table("company_investor_payouts")
    op.drop_index("ix_company_investor_fundings_org_investor_date", table_name="company_investor_fundings")
    op.drop_index("ix_company_investor_fundings_organization_id", table_name="company_investor_fundings")
    op.drop_table("company_investor_fundings")
    op.drop_index("ix_company_investors_org_email", table_name="company_investors")
    op.drop_index("ix_company_investors_org_status", table_name="company_investors")
    op.drop_index("ix_company_investors_organization_id", table_name="company_investors")
    op.drop_table("company_investors")
