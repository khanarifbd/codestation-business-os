"""add international company master settings

Revision ID: 0006_company_master
Revises: 0005_activity_audit
Create Date: 2026-08-07
"""

from collections.abc import Sequence
from datetime import datetime, timezone
from uuid import uuid4
import json

from alembic import op
import sqlalchemy as sa

revision: str = "0006_company_master"
down_revision: str | None = "0005_activity_audit"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tenant_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE")


def upgrade() -> None:
    op.create_table(
        "organization_profiles",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("legal_name", sa.String(220), nullable=True),
        sa.Column("trading_name", sa.String(220), nullable=True),
        sa.Column("industry", sa.String(120), nullable=True),
        sa.Column("company_size", sa.String(32), nullable=True),
        sa.Column("incorporation_date", sa.Date(), nullable=True),
        sa.Column("website", sa.String(500), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("primary_email", sa.String(320), nullable=True),
        sa.Column("billing_email", sa.String(320), nullable=True),
        sa.Column("support_email", sa.String(320), nullable=True),
        sa.Column("phone", sa.String(64), nullable=True),
        sa.Column("alternate_phone", sa.String(64), nullable=True),
        sa.Column("whatsapp", sa.String(64), nullable=True),
        sa.Column("fax", sa.String(64), nullable=True),
        sa.Column("internal_notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_organization_profiles_organization_id"),
    )
    op.create_index("ix_organization_profiles_organization_id", "organization_profiles", ["organization_id"])

    op.create_table(
        "organization_identifiers",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("identifier_type", sa.String(64), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("value", sa.String(180), nullable=False),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("issuing_authority", sa.String(180), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("is_primary", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "identifier_type", "value",
            name="uq_organization_identifiers_organization_identifier_type_value",
        ),
    )
    op.create_index("ix_organization_identifiers_organization_id", "organization_identifiers", ["organization_id"])
    op.create_index(
        "ix_organization_identifiers_organization_identifier_type",
        "organization_identifiers", ["organization_id", "identifier_type"],
    )

    op.create_table(
        "organization_addresses",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("address_type", sa.String(32), nullable=False),
        sa.Column("recipient_name", sa.String(180), nullable=True),
        sa.Column("line1", sa.String(250), nullable=True),
        sa.Column("line2", sa.String(250), nullable=True),
        sa.Column("city", sa.String(120), nullable=True),
        sa.Column("state_region", sa.String(120), nullable=True),
        sa.Column("postal_code", sa.String(32), nullable=True),
        sa.Column("country_code", sa.String(2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "address_type",
            name="uq_organization_addresses_organization_address_type",
        ),
    )
    op.create_index("ix_organization_addresses_organization_id", "organization_addresses", ["organization_id"])
    op.create_index(
        "ix_organization_addresses_organization_country_code",
        "organization_addresses", ["organization_id", "country_code"],
    )

    op.create_table(
        "organization_localization_settings",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("default_language", sa.String(16), nullable=False),
        sa.Column("date_format", sa.String(32), nullable=False),
        sa.Column("time_format", sa.String(16), nullable=False),
        sa.Column("number_format", sa.String(32), nullable=False),
        sa.Column("decimal_places", sa.Integer(), nullable=False),
        sa.Column("currency_position", sa.String(16), nullable=False),
        sa.Column("first_day_of_week", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_localization_organization_id"),
    )
    op.create_index("ix_organization_localization_settings_organization_id", "organization_localization_settings", ["organization_id"])

    op.create_table(
        "organization_financial_settings",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("accounting_currency", sa.String(3), nullable=False),
        sa.Column("default_payment_terms_days", sa.Integer(), nullable=False),
        sa.Column("tax_calculation_mode", sa.String(16), nullable=False),
        sa.Column("default_tax_rate", sa.Numeric(8, 4), nullable=False),
        sa.Column("prices_include_tax", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_financial_organization_id"),
    )
    op.create_index("ix_organization_financial_settings_organization_id", "organization_financial_settings", ["organization_id"])

    op.create_table(
        "organization_document_sequences",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("document_type", sa.String(40), nullable=False),
        sa.Column("prefix", sa.String(24), nullable=False),
        sa.Column("next_number", sa.Integer(), nullable=False),
        sa.Column("padding", sa.Integer(), nullable=False),
        sa.Column("separator", sa.String(4), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "organization_id", "document_type",
            name="uq_organization_document_sequences_organization_document_type",
        ),
    )
    op.create_index("ix_organization_document_sequences_organization_id", "organization_document_sequences", ["organization_id"])

    op.create_table(
        "organization_branding",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("logo_url", sa.String(1000), nullable=True),
        sa.Column("square_icon_url", sa.String(1000), nullable=True),
        sa.Column("invoice_logo_url", sa.String(1000), nullable=True),
        sa.Column("primary_color", sa.String(16), nullable=True),
        sa.Column("secondary_color", sa.String(16), nullable=True),
        sa.Column("document_footer", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_organization_branding_organization_id"),
    )
    op.create_index("ix_organization_branding_organization_id", "organization_branding", ["organization_id"])

    op.create_table(
        "organization_online_profiles",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("privacy_policy_url", sa.String(1000), nullable=True),
        sa.Column("terms_url", sa.String(1000), nullable=True),
        sa.Column("linkedin_url", sa.String(1000), nullable=True),
        sa.Column("facebook_url", sa.String(1000), nullable=True),
        sa.Column("x_url", sa.String(1000), nullable=True),
        sa.Column("instagram_url", sa.String(1000), nullable=True),
        sa.Column("youtube_url", sa.String(1000), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", name="uq_org_online_profile_organization_id"),
    )
    op.create_index("ix_organization_online_profiles_organization_id", "organization_online_profiles", ["organization_id"])

    op.create_table(
        "organization_documents",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column("organization_id", sa.String(36), nullable=False),
        sa.Column("document_type", sa.String(64), nullable=False),
        sa.Column("title", sa.String(180), nullable=False),
        sa.Column("document_number", sa.String(180), nullable=True),
        sa.Column("issuing_authority", sa.String(180), nullable=True),
        sa.Column("issue_date", sa.Date(), nullable=True),
        sa.Column("expiry_date", sa.Date(), nullable=True),
        sa.Column("file_url", sa.String(1000), nullable=True),
        sa.Column("storage_key", sa.String(1000), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        _tenant_fk(),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_organization_documents_organization_id", "organization_documents", ["organization_id"])
    op.create_index(
        "ix_organization_documents_organization_document_type_expiry_date",
        "organization_documents", ["organization_id", "document_type", "expiry_date"],
    )

    bind = op.get_bind()
    organizations = bind.execute(
        sa.text(
            "SELECT id, name, country_code, timezone, currency, business_type, team_size, "
            "financial_year_start_month FROM organizations"
        )
    ).mappings().all()
    now = datetime.now(timezone.utc)
    sequence_defaults = {
        "invoice": "INV",
        "quotation": "QUO",
        "order": "ORD",
        "project": "PRJ",
        "client": "CLI",
        "employee": "EMP",
    }

    for organization in organizations:
        organization_id = organization["id"]
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_profiles
                    (id, organization_id, legal_name, industry, company_size, created_at, updated_at)
                VALUES (:id, :organization_id, :legal_name, :industry, :company_size, :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "organization_id": organization_id,
                "legal_name": organization["name"],
                "industry": organization["business_type"],
                "company_size": organization["team_size"],
                "now": now,
            },
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_localization_settings
                    (id, organization_id, default_language, date_format, time_format,
                     number_format, decimal_places, currency_position, first_day_of_week,
                     created_at, updated_at)
                VALUES (:id, :organization_id, 'en', 'YYYY-MM-DD', '24h', '1,234.56',
                        2, 'before', 1, :now, :now)
                """
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )
        bind.execute(
            sa.text(
                """
                INSERT INTO organization_financial_settings
                    (id, organization_id, accounting_currency, default_payment_terms_days,
                     tax_calculation_mode, default_tax_rate, prices_include_tax, created_at, updated_at)
                VALUES (:id, :organization_id, :currency, 30, 'exclusive', 0, false, :now, :now)
                """
            ),
            {
                "id": str(uuid4()),
                "organization_id": organization_id,
                "currency": organization["currency"],
                "now": now,
            },
        )
        bind.execute(
            sa.text(
                "INSERT INTO organization_branding (id, organization_id, created_at, updated_at) "
                "VALUES (:id, :organization_id, :now, :now)"
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )
        bind.execute(
            sa.text(
                "INSERT INTO organization_online_profiles (id, organization_id, created_at, updated_at) "
                "VALUES (:id, :organization_id, :now, :now)"
            ),
            {"id": str(uuid4()), "organization_id": organization_id, "now": now},
        )
        for document_type, prefix in sequence_defaults.items():
            bind.execute(
                sa.text(
                    """
                    INSERT INTO organization_document_sequences
                        (id, organization_id, document_type, prefix, next_number, padding,
                         separator, created_at, updated_at)
                    VALUES (:id, :organization_id, :document_type, :prefix, 1, 5, '-', :now, :now)
                    """
                ),
                {
                    "id": str(uuid4()),
                    "organization_id": organization_id,
                    "document_type": document_type,
                    "prefix": prefix,
                    "now": now,
                },
            )

    bind.execute(
        sa.text(
            """
            INSERT INTO activity_logs
                (id, actor_type, scope, action, outcome, message, metadata_json, created_at)
            VALUES
                (:id, 'system', 'platform', 'system.company_master.initialized', 'success',
                 'International company master settings initialized', CAST(:metadata AS jsonb), :now)
            """
        ),
        {
            "id": str(uuid4()),
            "metadata": json.dumps({"organizations_initialized": len(organizations)}),
            "now": now,
        },
    )


def downgrade() -> None:
    op.drop_index("ix_organization_documents_organization_document_type_expiry_date", table_name="organization_documents")
    op.drop_index("ix_organization_documents_organization_id", table_name="organization_documents")
    op.drop_table("organization_documents")
    op.drop_index("ix_organization_online_profiles_organization_id", table_name="organization_online_profiles")
    op.drop_table("organization_online_profiles")
    op.drop_index("ix_organization_branding_organization_id", table_name="organization_branding")
    op.drop_table("organization_branding")
    op.drop_index("ix_organization_document_sequences_organization_id", table_name="organization_document_sequences")
    op.drop_table("organization_document_sequences")
    op.drop_index("ix_organization_financial_settings_organization_id", table_name="organization_financial_settings")
    op.drop_table("organization_financial_settings")
    op.drop_index("ix_organization_localization_settings_organization_id", table_name="organization_localization_settings")
    op.drop_table("organization_localization_settings")
    op.drop_index("ix_organization_addresses_organization_country_code", table_name="organization_addresses")
    op.drop_index("ix_organization_addresses_organization_id", table_name="organization_addresses")
    op.drop_table("organization_addresses")
    op.drop_index("ix_organization_identifiers_organization_identifier_type", table_name="organization_identifiers")
    op.drop_index("ix_organization_identifiers_organization_id", table_name="organization_identifiers")
    op.drop_table("organization_identifiers")
    op.drop_index("ix_organization_profiles_organization_id", table_name="organization_profiles")
    op.drop_table("organization_profiles")
