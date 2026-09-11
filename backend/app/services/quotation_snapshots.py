from sqlalchemy import event, select

from app.models.company_settings import OrganizationProfile
from app.models.crm import Client
from app.models.membership import Membership
from app.models.sales import Quotation
from app.models.team import Designation, Employee
from app.models.user import User


@event.listens_for(Quotation, "before_insert")
def populate_quotation_v2_snapshots(_mapper, connection, target: Quotation) -> None:
    """Keep legacy quotation creation paths compatible with the V2 document model."""
    if target.project_title is None and target.subject:
        target.project_title = target.subject.strip() or None

    if target.client_phone_snapshot is None and target.client_id:
        target.client_phone_snapshot = connection.execute(
            select(Client.phone).where(
                Client.id == target.client_id,
                Client.organization_id == target.organization_id,
            )
        ).scalar_one_or_none()

    if target.seller_phone_snapshot is None:
        target.seller_phone_snapshot = connection.execute(
            select(OrganizationProfile.phone).where(
                OrganizationProfile.organization_id == target.organization_id,
            )
        ).scalar_one_or_none()

    if target.prepared_by_name_snapshot is None or target.prepared_by_email_snapshot is None:
        user = connection.execute(
            select(User.full_name, User.email).where(User.id == target.created_by_user_id)
        ).first()
        if user is not None:
            if target.prepared_by_name_snapshot is None:
                target.prepared_by_name_snapshot = user.full_name
            if target.prepared_by_email_snapshot is None:
                target.prepared_by_email_snapshot = user.email

    if target.prepared_by_designation_snapshot is None:
        target.prepared_by_designation_snapshot = connection.execute(
            select(Designation.name)
            .join(Employee, Employee.designation_id == Designation.id)
            .join(Membership, Membership.id == Employee.membership_id)
            .where(
                Membership.user_id == target.created_by_user_id,
                Membership.organization_id == target.organization_id,
                Employee.organization_id == target.organization_id,
                Designation.organization_id == target.organization_id,
            )
            .limit(1)
        ).scalar_one_or_none()
