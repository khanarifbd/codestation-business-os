"""add payroll foundation

Revision ID: 0022_payroll_foundation
Revises: 0021_performance_indexes
Create Date: 2026-08-09
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_payroll_foundation"
down_revision: str | None = "0021_performance_indexes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "salary_profiles",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="CASCADE"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("pay_frequency", sa.String(24), nullable=False, server_default="monthly"),
        sa.Column("base_salary", sa.Numeric(18, 2), nullable=False),
        sa.Column("default_allowances", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("default_deductions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "employee_id", "effective_from", name="uq_salary_profiles_org_employee_effective"),
    )
    op.create_index("ix_salary_profiles_org_employee_active", "salary_profiles", ["organization_id", "employee_id", "is_active"])

    op.create_table(
        "payroll_periods",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("pay_date", sa.Date(), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="open"),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "period_start", "period_end", name="uq_payroll_periods_org_range"),
    )
    op.create_index("ix_payroll_periods_org_status_start", "payroll_periods", ["organization_id", "status", "period_start"])

    op.create_table(
        "payroll_runs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_number", sa.String(40), nullable=False),
        sa.Column("period_id", sa.String(36), sa.ForeignKey("payroll_periods.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
        sa.Column("employee_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("gross_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("allowance_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("deduction_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("tax_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("net_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("paid_account_id", sa.String(36), sa.ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "period_id", "currency", name="uq_payroll_runs_org_period_currency"),
        sa.UniqueConstraint("organization_id", "run_number", name="uq_payroll_runs_org_number"),
    )
    op.create_index("ix_payroll_runs_org_status_created", "payroll_runs", ["organization_id", "status", "created_at"])

    op.create_table(
        "payroll_entries",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("run_id", sa.String(36), sa.ForeignKey("payroll_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("salary_profile_id", sa.String(36), sa.ForeignKey("salary_profiles.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("base_salary", sa.Numeric(18, 2), nullable=False),
        sa.Column("allowances", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("deductions", postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("allowance_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("deduction_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0"),
        sa.Column("gross_pay", sa.Numeric(18, 2), nullable=False),
        sa.Column("net_pay", sa.Numeric(18, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("organization_id", "run_id", "employee_id", name="uq_payroll_entries_org_run_employee"),
    )
    op.create_index("ix_payroll_entries_org_employee_created", "payroll_entries", ["organization_id", "employee_id", "created_at"])

    op.execute(sa.text("""
        INSERT INTO organization_document_sequences
            (id, organization_id, document_type, prefix, next_number, padding, separator, created_at, updated_at)
        SELECT md5(random()::text || clock_timestamp()::text || o.id), o.id, 'payroll', 'PAY', 1, 5, '-', now(), now()
        FROM organizations o
        WHERE NOT EXISTS (
            SELECT 1 FROM organization_document_sequences s
            WHERE s.organization_id = o.id AND s.document_type = 'payroll'
        )
    """))


def downgrade() -> None:
    op.execute("DELETE FROM organization_document_sequences WHERE document_type='payroll'")
    op.drop_index("ix_payroll_entries_org_employee_created", table_name="payroll_entries")
    op.drop_table("payroll_entries")
    op.drop_index("ix_payroll_runs_org_status_created", table_name="payroll_runs")
    op.drop_table("payroll_runs")
    op.drop_index("ix_payroll_periods_org_status_start", table_name="payroll_periods")
    op.drop_table("payroll_periods")
    op.drop_index("ix_salary_profiles_org_employee_active", table_name="salary_profiles")
    op.drop_table("salary_profiles")
