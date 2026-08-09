from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Index, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class LoanDisbursement(TenantOwnedMixin, Base):
    __tablename__ = "loan_disbursements"
    __table_args__ = (
        UniqueConstraint("organization_id", "loan_id", "reference", name="uq_loan_disbursements_org_loan_reference"),
        Index("ix_loan_disbursements_org_loan_date", "organization_id", "loan_id", "disbursement_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[str] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=False)
    disbursement_date: Mapped[date] = mapped_column(Date, nullable=False)
    principal_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    fee_withheld_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    net_received_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class LoanFee(TenantOwnedMixin, Base):
    __tablename__ = "loan_fees"
    __table_args__ = (Index("ix_loan_fees_org_loan_date", "organization_id", "loan_id", "fee_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False)
    account_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("financial_accounts.id", ondelete="RESTRICT"), nullable=True)
    fee_date: Mapped[date] = mapped_column(Date, nullable=False)
    fee_type: Mapped[str] = mapped_column(String(40), default="processing_fee", nullable=False)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False)
    payment_status: Mapped[str] = mapped_column(String(16), default="paid", nullable=False)
    reference: Mapped[str | None] = mapped_column(String(180), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class LoanScheduleItem(TenantOwnedMixin, Base):
    __tablename__ = "loan_schedule_items"
    __table_args__ = (
        UniqueConstraint("organization_id", "loan_id", "installment_number", name="uq_loan_schedule_org_loan_installment"),
        Index("ix_loan_schedule_org_loan_due", "organization_id", "loan_id", "due_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    loan_id: Mapped[str] = mapped_column(String(36), ForeignKey("company_loans.id", ondelete="CASCADE"), nullable=False)
    installment_number: Mapped[int] = mapped_column(Integer, nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    principal_due: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    interest_due: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    fee_due: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    principal_paid: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    interest_paid: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    fee_paid: Mapped[Decimal] = mapped_column(Numeric(18, 2), default=Decimal("0"), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
