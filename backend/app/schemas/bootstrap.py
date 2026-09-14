from pydantic import BaseModel

from app.schemas.auth import UserProfileRead
from app.schemas.organization import OrganizationMembershipRead
from app.schemas.tenant import TenantContextRead


class DashboardBootstrapRead(BaseModel):
    profile: UserProfileRead
    workspaces: list[OrganizationMembershipRead]
    tenant: TenantContextRead | None
