"""add tax center and payable tax controls

Revision ID: 0040_tax_center
Revises: 0039_fixed_assets
"""
from alembic import op
import sqlalchemy as sa

revision = "0040_tax_center"
down_revision = "0039_fixed_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tax_codes",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("organization_id", sa.String(length=36), nullable=False),
        sa.Column("code", sa.String(length=40), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("tax_kind", sa.String(length=24), nullable=False),
        sa.Column("rate", sa.Numeric(8, 4), nullable=False),
        sa.Column("recoverable_percent", sa.Numeric(7, 4), nullable=False, server_default="100"),
        sa.Column("country_code", sa.String(length=2), nullable=True),
        sa.Column("jurisdiction", sa.String(length=120), nullable=True),
        sa.Column("effective_from", sa.Date(), nullable=True),
        sa.Column("effective_to", sa.Date(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by_user_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "code", name="uq_tax_codes_org_code"),
    )
    op.create_index("ix_tax_codes_org_active_kind", "tax_codes", ["organization_id", "is_active", "tax_kind"])

    for name, column in [
        ("subtotal_amount", sa.Column("subtotal_amount", sa.Numeric(18, 2), nullable=True)),
        ("tax_code_id", sa.Column("tax_code_id", sa.String(length=36), nullable=True)),
        ("tax_rate_snapshot", sa.Column("tax_rate_snapshot", sa.Numeric(8, 4), nullable=True)),
        ("input_tax_amount", sa.Column("input_tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0")),
        ("recoverable_tax_amount", sa.Column("recoverable_tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0")),
        ("withholding_tax_code_id", sa.Column("withholding_tax_code_id", sa.String(length=36), nullable=True)),
        ("withholding_rate_snapshot", sa.Column("withholding_rate_snapshot", sa.Numeric(8, 4), nullable=True)),
        ("withholding_tax_amount", sa.Column("withholding_tax_amount", sa.Numeric(18, 2), nullable=False, server_default="0")),
        ("net_payable_amount", sa.Column("net_payable_amount", sa.Numeric(18, 2), nullable=True)),
    ]:
        op.add_column("payable_bills", column)
    op.create_foreign_key("fk_payable_bills_tax_code", "payable_bills", "tax_codes", ["tax_code_id"], ["id"], ondelete="SET NULL")
    op.create_foreign_key("fk_payable_bills_withholding_tax_code", "payable_bills", "tax_codes", ["withholding_tax_code_id"], ["id"], ondelete="SET NULL")
    op.execute("UPDATE payable_bills SET subtotal_amount = original_amount, net_payable_amount = original_amount WHERE subtotal_amount IS NULL OR net_payable_amount IS NULL")
    op.alter_column("payable_bills", "subtotal_amount", nullable=False)
    op.alter_column("payable_bills", "net_payable_amount", nullable=False)


def downgrade() -> None:
    op.drop_constraint("fk_payable_bills_withholding_tax_code", "payable_bills", type_="foreignkey")
    op.drop_constraint("fk_payable_bills_tax_code", "payable_bills", type_="foreignkey")
    for name in ["net_payable_amount", "withholding_tax_amount", "withholding_rate_snapshot", "withholding_tax_code_id", "recoverable_tax_amount", "input_tax_amount", "tax_rate_snapshot", "tax_code_id", "subtotal_amount"]:
        op.drop_column("payable_bills", name)
    op.drop_index("ix_tax_codes_org_active_kind", table_name="tax_codes")
    op.drop_table("tax_codes")
