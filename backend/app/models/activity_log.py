from datetime import datetime

from sqlalchemy import DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base
from app.models.common import new_uuid, utc_now


class ActivityLog(Base):
    """Append-only audit record for platform and tenant activity."""

    __tablename__ = "activity_logs"
    __table_args__ = (
        Index("ix_activity_logs_org_created", "organization_id", "created_at"),
        Index("ix_activity_logs_actor_created", "actor_user_id", "created_at"),
        Index("ix_activity_logs_action_created", "action", "created_at"),
        Index("ix_activity_logs_entity_created", "entity_type", "entity_id", "created_at"),
        Index("ix_activity_logs_request_id", "request_id"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_uuid)
    organization_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_user_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(24), nullable=False, default="user")
    scope: Mapped[str] = mapped_column(String(24), nullable=False, default="tenant")
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(80), nullable=True)
    entity_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    outcome: Mapped[str] = mapped_column(String(24), nullable=False, default="success")
    message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    request_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ip_address: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(Text, nullable=True)
    http_method: Mapped[str | None] = mapped_column(String(12), nullable=True)
    request_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    before_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after_data: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    metadata_json: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
