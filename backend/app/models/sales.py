from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class Quotation(TenantOwnedMixin, Base):
    __tablename__ = "quotations"
    __table_args__ = (
        UniqueConstraint("organization_id", "quotation_number", name="uq_quotations_org_number"),
        UniqueConstraint(
            "organization_id", "root_quotation_id", "revision_number", name="uq_quotations_org_root_revision"
        ),
        Index("ix_quotations_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_quotations_org_client_created", "organization_id", "client_id", "created_at"),
        Index("ix_quotations_org_valid_until", "organization_id", "valid_until"),
        Index("ix_quotations_org_root_revision", "organization_id", "root_quotation_id", "revision_number"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quotation_number: Mapped[str] = mapped_column(String(40), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)
    source_lead_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("leads.id", ondelete="SET NULL"), nullable=True)
    assigned_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    root_quotation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("quotations.id", ondelete="SET NULL"), nullable=True
    )
    supersedes_quotation_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("quotations.id", ondelete="SET NULL"), nullable=True
    )
    revision_number: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    status: Mapped[str] = mapped_column(String(24), default="draft", nullable=False)
    subject: Mapped[str | None] = mapped_column(String(220), nullable=True)
    project_title: Mapped[str | None] = mapped_column(String(220), nullable=True)
    executive_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    estimated_duration: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    tax_calculation_mode: Mapped[str] = mapped_column(String(16), default="exclusive", nullable=False)

    seller_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    seller_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    seller_phone_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    seller_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    client_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    client_contact_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)
    client_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    client_phone_snapshot: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    prepared_by_name_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)
    prepared_by_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    prepared_by_designation_snapshot: Mapped[str | None] = mapped_column(String(120), nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class QuotationItem(TenantOwnedMixin, Base):
    __tablename__ = "quotation_items"
    __table_args__ = (
        Index("ix_quotation_items_org_quotation_order", "organization_id", "quotation_id", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    group_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    title: Mapped[str | None] = mapped_column(String(220), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    unit: Mapped[str] = mapped_column(String(32), default="item", nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(16, 4), nullable=False)
    discount_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), default=Decimal("0"), nullable=False)
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), default=Decimal("0"), nullable=False)
    line_subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    discount_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    taxable_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class QuotationSection(TenantOwnedMixin, Base):
    __tablename__ = "quotation_sections"
    __table_args__ = (
        Index("ix_quotation_sections_org_quote_order", "organization_id", "quotation_id", "sort_order"),
        Index("ix_quotation_sections_org_quote_type", "organization_id", "quotation_id", "section_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    section_type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    is_visible: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class QuotationMilestone(TenantOwnedMixin, Base):
    __tablename__ = "quotation_milestones"
    __table_args__ = (
        Index("ix_quotation_milestones_org_quote_order", "organization_id", "quotation_id", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    duration_text: Mapped[str | None] = mapped_column(String(120), nullable=True)
    acceptance_criteria: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class QuotationPaymentSchedule(TenantOwnedMixin, Base):
    __tablename__ = "quotation_payment_schedules"
    __table_args__ = (
        Index("ix_quotation_payments_org_quote_order", "organization_id", "quotation_id", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    quotation_id: Mapped[str] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    label: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    payment_type: Mapped[str] = mapped_column(String(16), nullable=False)
    percentage: Mapped[Decimal | None] = mapped_column(Numeric(7, 4), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(16, 2), nullable=True)
    calculated_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    due_condition: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
