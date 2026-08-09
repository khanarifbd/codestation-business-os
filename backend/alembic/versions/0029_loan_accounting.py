"""add loan accounting

Revision ID: 0029_loan_accounting
Revises: 0028_accounting_core
Create Date: 2026-08-09
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0029_loan_accounting"
down_revision: str | None = "0028_accounting_core"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "loan_disbursements",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("loan_id", sa.String(36), sa.ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("disbursement_date", sa.Date(), nullable=False),
        sa.Column("principal_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("fee_withheld_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("net_received_amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "loan_id", "reference", name="uq_loan_disbursements_org_loan_reference"),
    )
    op.create_index("ix_loan_disbursements_org_loan_date", "loan_disbursements", ["organization_id", "loan_id", "disbursement_date"])

    op.create_table(
        "loan_fees",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("loan_id", sa.String(36), sa.ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT")),
        sa.Column("fee_date", sa.Date(), nullable=False),
        sa.Column("fee_type", sa.String(40), nullable=False, server_default="processing_fee"),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("payment_status", sa.String(16), nullable=False, server_default="paid"),
        sa.Column("reference", sa.String(180)),
        sa.Column("notes", sa.Text()),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_loan_fees_org_loan_date", "loan_fees", ["organization_id", "loan_id", "fee_date"])

    op.create_table(
        "loan_schedule_items",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("loan_id", sa.String(36), sa.ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False),
        sa.Column("installment_number", sa.Integer(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("principal_due", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("interest_due", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("fee_due", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("principal_paid", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("interest_paid", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("fee_paid", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("paid_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "loan_id", "installment_number", name="uq_loan_schedule_org_loan_installment"),
    )
    op.create_index("ix_loan_schedule_org_loan_due", "loan_schedule_items", ["organization_id", "loan_id", "due_date"])

    # Existing loans created with a cash transaction were already disbursed by the legacy flow.
    # Loans without a matching cash receipt are treated as approved-but-undisbursed so a liability is
    # not recognized until funds are actually received.
    bind = op.get_bind()
    bind.execute(sa.text("""
        UPDATE company_loans AS l
        SET outstanding_principal = 0,
            status = CASE WHEN status = 'paid' THEN status ELSE 'approved' END
        WHERE status <> 'paid'
          AND NOT EXISTS (
              SELECT 1 FROM financial_transactions ft
              WHERE ft.organization_id = l.organization_id
                AND ft.source_type = 'company_loan'
                AND ft.source_id = l.id
                AND ft.direction = 'credit'
          )
    """))


def downgrade() -> None:
    op.drop_index("ix_loan_schedule_org_loan_due", table_name="loan_schedule_items")
    op.drop_table("loan_schedule_items")
    op.drop_index("ix_loan_fees_org_loan_date", table_name="loan_fees")
    op.drop_table("loan_fees")
    op.drop_index("ix_loan_disbursements_org_loan_date", table_name="loan_disbursements")
    op.drop_table("loan_disbursements")
