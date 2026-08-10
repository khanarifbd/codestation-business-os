from dataclasses import dataclass

from app.models.membership import Membership
from app.models.organization import Organization
from app.models.user import User


@dataclass(frozen=True, slots=True)
class TenantContext:
    """Validated organization scope for a single authenticated request."""

    user: User
    organization: Organization
    membership: Membership

    @property
    def user_id(self) -> str:
        return self.user.id

    @property
    def organization_id(self) -> str:
        return self.organization.id

    @property
    def membership_id(self) -> str:
        return self.membership.id

    @property
    def role(self) -> str:
        return self.membership.role
