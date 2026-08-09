from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now
from app.tenancy.models import TenantOwnedMixin


class HRHoliday(TenantOwnedMixin, Base):
    __tablename__ = "hr_holidays"
    __table_args__ = (
        UniqueConstraint("organization_id", "holiday_date", "name", name="uq_hr_holidays_org_date_name"),
        Index("ix_hr_holidays_org_date", "organization_id", "holiday_date"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    holiday_date: Mapped[date] = mapped_column(Date, nullable=False)
    is_paid: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class HRAnnouncementAcknowledgement(TenantOwnedMixin, Base):
    __tablename__ = "hr_announcement_acknowledgements"
    __table_args__ = (
        UniqueConstraint("organization_id", "announcement_id", "employee_id", name="uq_hr_ack_org_announcement_employee"),
        Index("ix_hr_ack_org_announcement", "organization_id", "announcement_id"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    announcement_id: Mapped[str] = mapped_column(String(36), ForeignKey("hr_announcements.id", ondelete="CASCADE"), nullable=False)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="CASCADE"), nullable=False)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
