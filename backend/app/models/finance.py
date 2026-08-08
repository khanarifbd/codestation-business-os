from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class FinancialAccount(TenantOwnedMixin, Base):
    __tablename__ = "financial_accounts"
    __table_args__ = (
        UniqueConstraint("organization_id", "name", "currency", name="uq_financial_accounts_org_name_currency"),
        Index("ix_financial_accounts_org_active_type", "organization_id", "is_active", "account_type"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    account_type: Mapped[str] = mapped_column(String(32), default="bank", nullable=False)
    provider_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    account_holder_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    account_reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    opening_balance: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Invoice(TenantOwnedMixin, Base):
    __tablename__ = "invoices"
    __table_args__ = (
        UniqueConstraint("organization_id", "invoice_number", name="uq_invoices_org_number"),
        Index("ix_invoices_org_status_created", "organization_id", "status", "created_at"),
        Index("ix_invoices_org_client_created", "organization_id", "client_id", "created_at"),
        Index("ix_invoices_org_due_date", "organization_id", "due_date"),
        Index("ix_invoices_org_order", "organization_id", "order_id"),
        Index("ix_invoices_org_project", "organization_id", "project_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    invoice_number: Mapped[str] = mapped_column(String(40), nullable=False)
    client_id: Mapped[str] = mapped_column(String(36), ForeignKey("clients.id", ondelete="RESTRICT"), nullable=False)
    order_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("orders.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("projects.id", ondelete="SET NULL"), nullable=True)
    quotation_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("quotations.id", ondelete="SET NULL"), nullable=True)
    assigned_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id", ondelete="SET NULL"), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)

    status: Mapped[str] = mapped_column(String(24), default="draft", nullable=False)
    subject: Mapped[str | None] = mapped_column(String(220), nullable=True)
    issue_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    tax_calculation_mode: Mapped[str] = mapped_column(String(16), default="exclusive", nullable=False)

    seller_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    seller_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    seller_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    seller_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    client_name_snapshot: Mapped[str] = mapped_column(String(220), nullable=False)
    client_contact_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)
    client_email_snapshot: Mapped[str | None] = mapped_column(String(320), nullable=True)
    client_address_snapshot: Mapped[str | None] = mapped_column(Text, nullable=True)
    client_tax_identifier_snapshot: Mapped[str | None] = mapped_column(String(180), nullable=True)

    subtotal: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    discount_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    tax_total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    total: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    amount_paid: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)
    balance_due: Mapped[Decimal] = mapped_column(Numeric(16, 2), default=Decimal("0"), nullable=False)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    terms_conditions: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class InvoiceItem(TenantOwnedMixin, Base):
    __tablename__ = "invoice_items"
    __table_args__ = (Index("ix_invoice_items_org_invoice_sort", "organization_id", "invoice_id", "sort_order"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id", ondelete="CASCADE"), nullable=False)
    source_order_item_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("order_items.id", ondelete="SET NULL"), nullable=True)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
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


class Payment(TenantOwnedMixin, Base):
    __tablename__ = "payments"
    __table_args__ = (
        UniqueConstraint("organization_id", "payment_number", name="uq_payments_org_number"),
        Index("ix_payments_org_invoice_created", "organization_id", "invoice_id", "created_at"),
        Index("ix_payments_org_account_date", "organization_id", "account_id", "payment_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    payment_number: Mapped[str] = mapped_column(String(40), nullable=False)
    invoice_id: Mapped[str] = mapped_column(String(36), ForeignKey("invoices.id", ondelete="RESTRICT"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    payment_date: Mapped[date] = mapped_column(Date, nullable=False)
    invoice_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    account_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    invoice_amount: Mapped[Decimal] = mapped_column(Numeric(16, 2), nullable=False)
    account_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    exchange_rate: Mapped[Decimal] = mapped_column(Numeric(18, 8), default=Decimal("1"), nullable=False)
    method: Mapped[str] = mapped_column(String(40), default="bank_transfer", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="confirmed", nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class FinancialTransaction(TenantOwnedMixin, Base):
    __tablename__ = "financial_transactions"
    __table_args__ = (
        UniqueConstraint("organization_id", "account_id", "source_type", "source_id", "direction", name="uq_financial_transactions_source"),
        Index("ix_financial_transactions_org_account_date", "organization_id", "account_id", "transaction_date", "created_at"),
        Index("ix_financial_transactions_org_source", "organization_id", "source_type", "source_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    transaction_date: Mapped[date] = mapped_column(Date, nullable=False)
    direction: Mapped[str] = mapped_column(String(12), nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_id: Mapped[str] = mapped_column(String(36), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    description: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
