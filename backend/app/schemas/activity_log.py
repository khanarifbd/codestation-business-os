from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ActivityLogListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: str | None
    actor_user_id: str | None
    actor_type: str
    scope: str
    action: str
    entity_type: str | None
    entity_id: str | None
    outcome: str
    message: str | None
    request_id: str | None
    created_at: datetime


class ActivityLogDetail(ActivityLogListItem):
    ip_address: str | None
    user_agent: str | None
    http_method: str | None
    request_path: str | None
    before_data: dict | None
    after_data: dict | None
    metadata_json: dict | None


class ActivityLogPage(BaseModel):
    items: list[ActivityLogListItem]
    next_cursor: str | None = None
