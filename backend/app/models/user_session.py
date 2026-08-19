from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now


class UserSession(Base):
    __tablename__ = "user_sessions"
    __table_args__ = (
        Index("ix_user_sessions_user_last_seen", "user_id", "last_seen_at"),
        Index("ix_user_sessions_user_active", "user_id", "revoked_at", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    user_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token_version: Mapped[int] = mapped_column(Integer, nullable=False)
    auth_method: Mapped[str] = mapped_column(String(24), nullable=False)
    device_type: Mapped[str] = mapped_column(String(24), nullable=False)
    browser: Mapped[str] = mapped_column(String(80), nullable=False)
    operating_system: Mapped[str] = mapped_column(String(80), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(80), nullable=True)
