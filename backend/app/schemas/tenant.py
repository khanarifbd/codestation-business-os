from pydantic import BaseModel

from app.schemas.organization import OrganizationRead


class TenantContextRead(BaseModel):
    organization: OrganizationRead
    membership_id: str
    role: str
    status: str
