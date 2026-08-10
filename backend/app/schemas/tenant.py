from pydantic import BaseModel

from app.schemas.organization import OrganizationRead


class TenantContextRead(BaseModel):
    organization: OrganizationRead
    membership_id: str
    role_id: str
    role: str
    role_name: str
    role_slug: str
    status: str
    is_owner: bool
    relationships: list[str]
    primary_relationship: str
