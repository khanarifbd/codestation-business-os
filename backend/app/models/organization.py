from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.roles import ORGANIZATION_STATUS_ACTIVE
from app.db.base import Base
from app.models.common import new_uuid, utc_now


class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    slug: Mapped[str] = mapped_column(String(120), unique=True, index=True, nullable=False)
    status: Mapped[str] = mapped_column(
        String(32), default=ORGANIZATION_STATUS_ACTIVE, nullable=False, index=True
    )
    suspension_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    suspended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    country_code: Mapped[str] = mapped_column(String(2), default="BD", nullable=False)
    timezone: Mapped[str] = mapped_column(String(64), default="Asia/Dhaka", nullable=False)
    currency: Mapped[str] = mapped_column(String(3), default="BDT", nullable=False)
    business_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    team_size: Mapped[str | None] = mapped_column(String(32), nullable=True)
    financial_year_start_month: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    setup_completed: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_by_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
