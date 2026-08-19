from datetime import datetime
from decimal import Decimal

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class LeadStatus(TenantOwnedMixin, Base):
    __tablename__ = "lead_statuses"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_lead_statuses_org_slug"),
        Index("ix_lead_statuses_org_order", "organization_id", "is_active", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    color: Mapped[str | None] = mapped_column(String(16), nullable=True)
    category: Mapped[str] = mapped_column(String(24), default="open", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class LeadSource(TenantOwnedMixin, Base):
    __tablename__ = "lead_sources"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_lead_sources_org_slug"),
        Index("ix_lead_sources_org_order", "organization_id", "is_active", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Client(TenantOwnedMixin, Base):
    __tablename__ = "clients"
    __table_args__ = (
        UniqueConstraint("organization_id", "client_code", name="uq_clients_org_code"),
        Index("ix_clients_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_clients_org_name", "organization_id", "display_name"),
        Index("ix_clients_org_email", "organization_id", "email"),
        Index("ix_clients_org_acquisition_source", "organization_id", "acquisition_source_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    client_code: Mapped[str] = mapped_column(String(40), nullable=False)
    client_type: Mapped[str] = mapped_column(String(24), default="company", nullable=False)
    display_name: Mapped[str] = mapped_column(String(220), nullable=False)
    legal_name: Mapped[str | None] = mapped_column(String(220), nullable=True)
    contact_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    billing_email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    state_region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    postal_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(250), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(250), nullable=True)
    tax_identifier: Mapped[str | None] = mapped_column(String(180), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    acquisition_source_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("lead_sources.id", ondelete="SET NULL"), nullable=True
    )
    assigned_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Lead(TenantOwnedMixin, Base):
    __tablename__ = "leads"
    __table_args__ = (
        UniqueConstraint("organization_id", "lead_code", name="uq_leads_org_code"),
        Index("ix_leads_org_status_created", "organization_id", "status_id", "created_at"),
        Index("ix_leads_org_assignee_created", "organization_id", "assigned_employee_id", "created_at"),
        Index("ix_leads_org_followup", "organization_id", "next_follow_up_at"),
        Index("ix_leads_org_email", "organization_id", "email"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lead_code: Mapped[str] = mapped_column(String(40), nullable=False)
    lead_type: Mapped[str] = mapped_column(String(24), default="company", nullable=False)
    company_name: Mapped[str | None] = mapped_column(String(220), nullable=True)
    contact_name: Mapped[str] = mapped_column(String(180), nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    whatsapp: Mapped[str | None] = mapped_column(String(64), nullable=True)
    website: Mapped[str | None] = mapped_column(String(500), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    state_region: Mapped[str | None] = mapped_column(String(120), nullable=True)
    city: Mapped[str | None] = mapped_column(String(120), nullable=True)
    address_line1: Mapped[str | None] = mapped_column(String(250), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("lead_sources.id", ondelete="SET NULL"), nullable=True)
    status_id: Mapped[str] = mapped_column(String(36), ForeignKey("lead_statuses.id", ondelete="RESTRICT"), nullable=False)
    assigned_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    estimated_value: Mapped[Decimal | None] = mapped_column(Numeric(16, 2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    probability_percent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    next_follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    converted_client_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    converted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class LeadInterest(TenantOwnedMixin, Base):
    __tablename__ = "lead_interests"
    __table_args__ = (
        Index("ix_lead_interests_org_lead_sort", "organization_id", "lead_id", "sort_order"),
        Index("ix_lead_interests_org_product", "organization_id", "product_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("products.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    item_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    item_type_snapshot: Mapped[str] = mapped_column(String(24), default="service", nullable=False)
    unit_snapshot: Mapped[str] = mapped_column(String(40), default="unit", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), default=Decimal("1"), nullable=False)
    estimated_unit_price: Mapped[Decimal | None] = mapped_column(Numeric(16, 4), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class LeadInteraction(TenantOwnedMixin, Base):
    __tablename__ = "lead_interactions"
    __table_args__ = (
        Index("ix_lead_interactions_org_lead_created", "organization_id", "lead_id", "created_at"),
        Index("ix_lead_interactions_org_scheduled", "organization_id", "scheduled_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    lead_id: Mapped[str] = mapped_column(String(36), ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True)
    interaction_type: Mapped[str] = mapped_column(String(32), default="note", nullable=False)
    subject: Mapped[str | None] = mapped_column(String(180), nullable=True)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
