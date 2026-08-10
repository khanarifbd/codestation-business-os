from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class Vendor(TenantOwnedMixin, Base):
    __tablename__ = "vendors"
    __table_args__ = (
        UniqueConstraint("organization_id", "vendor_code", name="uq_vendors_org_code"),
        Index("ix_vendors_org_active_name", "organization_id", "is_active", "name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    vendor_code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(220), nullable=False)
    contact_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(80), nullable=True)
    website: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    tax_identifier: Mapped[str | None] = mapped_column(String(180), nullable=True)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class ExpenseCategory(TenantOwnedMixin, Base):
    __tablename__ = "expense_categories"
    __table_args__ = (
        UniqueConstraint("organization_id", "slug", name="uq_expense_categories_org_slug"),
        Index("ix_expense_categories_org_active_sort", "organization_id", "is_active", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(140), nullable=False)
    slug: Mapped[str] = mapped_column(String(160), nullable=False)
    cost_type: Mapped[str] = mapped_column(String(24), default="operating", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Expense(TenantOwnedMixin, Base):
    __tablename__ = "expenses"
    __table_args__ = (
        UniqueConstraint("organization_id", "expense_number", name="uq_expenses_org_number"),
        Index("ix_expenses_org_date", "organization_id", "expense_date", "created_at"),
        Index("ix_expenses_org_status_date", "organization_id", "status", "expense_date"),
        Index("ix_expenses_org_project_date", "organization_id", "project_id", "expense_date"),
        Index("ix_expenses_org_client_date", "organization_id", "client_id", "expense_date"),
        Index("ix_expenses_org_vendor_date", "organization_id", "vendor_id", "expense_date"),
        Index("ix_expenses_org_category_date", "organization_id", "category_id", "expense_date"),
        Index("ix_expenses_org_account_date", "organization_id", "account_id", "expense_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    expense_number: Mapped[str] = mapped_column(String(40), nullable=False)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id", ondelete="SET NULL"), nullable=True)
    category_id: Mapped[str] = mapped_column(String(36), ForeignKey("expense_categories.id", ondelete="RESTRICT"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    client_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("clients.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    expense_date: Mapped[date] = mapped_column(Date, nullable=False)
    expense_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    expense_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    account_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    account_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    profitability_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    profitability_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    profitability_exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), nullable=False)
    tax_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(40), default="bank_transfer", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="posted", nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
    voided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ExpenseDocument(TenantOwnedMixin, Base):
    __tablename__ = "expense_documents"
    __table_args__ = (
        Index("ix_expense_documents_org_expense_created", "organization_id", "expense_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    expense_id: Mapped[str] = mapped_column(String(36), ForeignKey("expenses.id", ondelete="CASCADE"), nullable=False)
    title: Mapped[str] = mapped_column(String(180), nullable=False)
    document_type: Mapped[str] = mapped_column(String(64), default="receipt", nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(160), nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
