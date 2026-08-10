from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, Index, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class TaxCode(TenantOwnedMixin, Base):
    __tablename__ = "tax_codes"
    __table_args__ = (
        UniqueConstraint("organization_id", "code", name="uq_tax_codes_org_code"),
        Index("ix_tax_codes_org_active_kind", "organization_id", "is_active", "tax_kind"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    code: Mapped[str] = mapped_column(String(40), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    tax_kind: Mapped[str] = mapped_column(String(24), nullable=False)  # sales, purchase, withholding
    rate: Mapped[Decimal] = mapped_column(Numeric(8, 4), nullable=False)
    recoverable_percent: Mapped[Decimal] = mapped_column(Numeric(7, 4), default=Decimal("100"), nullable=False)
    country_code: Mapped[str | None] = mapped_column(String(2), nullable=True)
    jurisdiction: Mapped[str | None] = mapped_column(String(120), nullable=True)
    effective_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    effective_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by_user_id: Mapped[str] = mapped_column(String(36), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)
