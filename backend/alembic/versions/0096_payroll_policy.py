"""Add opt-in versioned payroll snapshots without changing historical amounts.

Revision ID: 0096_payroll_policy
Revises: 0095_inventory_payables
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0096_payroll_policy"
down_revision = "0095_inventory_payables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "payroll_policy_versions",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("configuration", postgresql.JSONB(), nullable=False),
        sa.Column("activation_reason", sa.Text(), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("organization_id", "id", name="uq_payroll_policy_org_id"),
        sa.UniqueConstraint("organization_id", "version", name="uq_payroll_policy_org_version"),
        sa.CheckConstraint("version > 0", name="ck_payroll_policy_version_positive"),
    )
    op.create_index("ix_payroll_policy_versions_organization_id", "payroll_policy_versions", ["organization_id"])
    op.create_index("ix_payroll_policy_org_effective", "payroll_policy_versions", ["organization_id", "effective_from"])
    for name, kind in (
        ("policy_version_id", sa.String(36)), ("calculation_engine_version", sa.String(64)),
        ("calculation_hash", sa.String(64)), ("calculation_input_snapshot", sa.Text()),
        ("calculation_output_snapshot", sa.Text()),
    ):
        op.add_column("payroll_runs", sa.Column(name, kind, nullable=True))
    op.create_foreign_key("fk_payroll_run_tenant_policy", "payroll_runs", "payroll_policy_versions", ["organization_id", "policy_version_id"], ["organization_id", "id"], ondelete="RESTRICT")
    op.add_column("payroll_entries", sa.Column("calculation_snapshot", sa.Text(), nullable=True))
    op.create_unique_constraint("uq_payroll_entries_org_id", "payroll_entries", ["organization_id", "id"])
    op.create_table(
        "payroll_entry_adjustments",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("organization_id", sa.String(36), sa.ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False),
        sa.Column("entry_id", sa.String(36), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column("before_values", postgresql.JSONB(), nullable=False),
        sa.Column("after_values", postgresql.JSONB(), nullable=False),
        sa.Column("created_by_user_id", sa.String(36), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id", "entry_id"], ["payroll_entries.organization_id", "payroll_entries.id"], name="fk_payroll_adjustment_tenant_entry", ondelete="RESTRICT"),
    )
    op.create_index("ix_payroll_entry_adjustments_organization_id", "payroll_entry_adjustments", ["organization_id"])
    op.create_index("ix_payroll_adjustment_org_entry_created", "payroll_entry_adjustments", ["organization_id", "entry_id", "created_at"])


def downgrade() -> None:
    # Source-only migration: refuse destructive rollback of any opt-in history.
    used = op.get_bind().execute(sa.text("""
        SELECT EXISTS (SELECT 1 FROM payroll_policy_versions)
            OR EXISTS (SELECT 1 FROM payroll_entry_adjustments)
            OR EXISTS (SELECT 1 FROM payroll_runs WHERE policy_version_id IS NOT NULL
                OR calculation_engine_version IS NOT NULL OR calculation_hash IS NOT NULL
                OR calculation_input_snapshot IS NOT NULL OR calculation_output_snapshot IS NOT NULL)
            OR EXISTS (SELECT 1 FROM payroll_entries WHERE calculation_snapshot IS NOT NULL)
    """)).scalar()
    if used:
        raise RuntimeError("Refusing to discard payroll policy, calculation or adjustment history")
    op.drop_table("payroll_entry_adjustments")
    op.drop_constraint("uq_payroll_entries_org_id", "payroll_entries", type_="unique")
    op.drop_column("payroll_entries", "calculation_snapshot")
    op.drop_constraint("fk_payroll_run_tenant_policy", "payroll_runs", type_="foreignkey")
    for name in ("calculation_output_snapshot", "calculation_input_snapshot", "calculation_hash", "calculation_engine_version", "policy_version_id"):
        op.drop_column("payroll_runs", name)
    op.drop_table("payroll_policy_versions")
