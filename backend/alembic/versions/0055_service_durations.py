"""add service durations and sold-service periods

Revision ID: 0055_service_durations
Revises: 0054_order_external_references
"""

from alembic import op
import sqlalchemy as sa

revision = "0055_service_durations"
down_revision = "0054_order_external_references"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("products", sa.Column("service_duration_months", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_products_service_duration_positive",
        "products",
        "service_duration_months IS NULL OR service_duration_months > 0",
    )
    op.create_check_constraint(
        "ck_products_service_duration_service_only",
        "products",
        "item_type = 'service' OR service_duration_months IS NULL",
    )

    op.add_column("quotation_items", sa.Column("service_duration_months_snapshot", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_quotation_items_service_duration_positive",
        "quotation_items",
        "service_duration_months_snapshot IS NULL OR service_duration_months_snapshot > 0",
    )

    op.add_column("order_items", sa.Column("service_duration_months_snapshot", sa.Integer(), nullable=True))
    op.add_column("order_items", sa.Column("service_start_date", sa.Date(), nullable=True))
    op.add_column("order_items", sa.Column("service_end_date", sa.Date(), nullable=True))
    op.create_check_constraint(
        "ck_order_items_service_duration_positive",
        "order_items",
        "service_duration_months_snapshot IS NULL OR service_duration_months_snapshot > 0",
    )
    op.create_check_constraint(
        "ck_order_items_service_period",
        "order_items",
        "(service_start_date IS NULL AND service_end_date IS NULL) OR "
        "(service_start_date IS NOT NULL AND service_end_date IS NOT NULL AND service_end_date >= service_start_date)",
    )
    op.create_index(
        "ix_order_items_org_service_end",
        "order_items",
        ["organization_id", "service_end_date"],
        unique=False,
    )

    op.add_column("invoice_items", sa.Column("service_duration_months_snapshot", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_invoice_items_service_duration_positive",
        "invoice_items",
        "service_duration_months_snapshot IS NULL OR service_duration_months_snapshot > 0",
    )


def downgrade() -> None:
    op.drop_constraint("ck_invoice_items_service_duration_positive", "invoice_items", type_="check")
    op.drop_column("invoice_items", "service_duration_months_snapshot")

    op.drop_index("ix_order_items_org_service_end", table_name="order_items")
    op.drop_constraint("ck_order_items_service_period", "order_items", type_="check")
    op.drop_constraint("ck_order_items_service_duration_positive", "order_items", type_="check")
    op.drop_column("order_items", "service_end_date")
    op.drop_column("order_items", "service_start_date")
    op.drop_column("order_items", "service_duration_months_snapshot")

    op.drop_constraint("ck_quotation_items_service_duration_positive", "quotation_items", type_="check")
    op.drop_column("quotation_items", "service_duration_months_snapshot")

    op.drop_constraint("ck_products_service_duration_service_only", "products", type_="check")
    op.drop_constraint("ck_products_service_duration_positive", "products", type_="check")
    op.drop_column("products", "service_duration_months")
