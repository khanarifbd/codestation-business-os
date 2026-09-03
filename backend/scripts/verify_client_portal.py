"""Verify Client Portal reads enforce client relationship and explicit sharing boundaries."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.client_portal import (
    get_client_portal_context,
    get_client_portal_invoice,
    get_client_portal_order,
    get_client_portal_project,
    get_client_portal_quotation,
    list_client_portal_invoices,
    list_client_portal_orders,
    list_client_portal_projects,
    list_client_portal_quotations,
)
from app.db.session import SessionLocal
from app.models.client_access import ClientMembership
from app.models.crm import Client
from app.models.finance import Invoice
from app.models.membership import Membership
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project, ProjectMilestone
from app.models.sales import Quotation


@dataclass(frozen=True)
class Tenant:
    organization: Organization
    membership: Membership

    @property
    def organization_id(self) -> str:
        return self.organization.id

    @property
    def membership_id(self) -> str:
        return self.membership.id

    @property
    def user_id(self) -> str:
        return self.membership.user_id


def expect_not_found(fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != 404:
            raise AssertionError(f"Expected HTTP 404, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError("Expected HTTP 404, but request succeeded")


def main() -> None:
    db = SessionLocal()
    try:
        organization = db.scalar(
            select(Organization)
            .where(Organization.name.like("Onboarding Company %"))
            .order_by(Organization.created_at.desc())
            .limit(1)
        )
        if organization is None:
            raise AssertionError("Onboarding verification tenant was not found")

        membership = db.scalar(
            select(Membership)
            .where(
                Membership.organization_id == organization.id,
                Membership.status == "active",
            )
            .order_by(Membership.created_at.asc())
            .limit(1)
        )
        if membership is None:
            raise AssertionError("Onboarding verification tenant has no active membership")

        token = uuid4().hex[:8]
        linked_client = Client(
            organization_id=organization.id,
            client_code=f"PORTAL-L-{token}",
            display_name="Portal Linked Client",
            currency="USD",
        )
        other_client = Client(
            organization_id=organization.id,
            client_code=f"PORTAL-O-{token}",
            display_name="Portal Other Client",
            currency="USD",
        )
        db.add_all([linked_client, other_client])
        db.flush()

        db.add(
            ClientMembership(
                organization_id=organization.id,
                client_id=linked_client.id,
                membership_id=membership.id,
                is_primary_contact=True,
                status="active",
                created_by_user_id=membership.user_id,
            )
        )

        visible_quotation = Quotation(
            organization_id=organization.id,
            quotation_number=f"Q-PORTAL-{token}",
            client_id=linked_client.id,
            created_by_user_id=membership.user_id,
            status="sent",
            subject="Visible quotation",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=linked_client.display_name,
            total=Decimal("1200.00"),
        )
        draft_quotation = Quotation(
            organization_id=organization.id,
            quotation_number=f"Q-DRAFT-{token}",
            client_id=linked_client.id,
            created_by_user_id=membership.user_id,
            status="draft",
            subject="Hidden draft quotation",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=linked_client.display_name,
            total=Decimal("999.00"),
        )
        other_quotation = Quotation(
            organization_id=organization.id,
            quotation_number=f"Q-OTHER-{token}",
            client_id=other_client.id,
            created_by_user_id=membership.user_id,
            status="sent",
            subject="Other client quotation",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=other_client.display_name,
            total=Decimal("500.00"),
        )
        db.add_all([visible_quotation, draft_quotation, other_quotation])
        db.flush()

        linked_order = Order(
            organization_id=organization.id,
            order_number=f"O-PORTAL-{token}",
            quotation_id=visible_quotation.id,
            client_id=linked_client.id,
            created_by_user_id=membership.user_id,
            status="confirmed",
            subject="Portal order",
            order_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=linked_client.display_name,
            total=Decimal("1200.00"),
        )
        other_order = Order(
            organization_id=organization.id,
            order_number=f"O-OTHER-{token}",
            quotation_id=other_quotation.id,
            client_id=other_client.id,
            created_by_user_id=membership.user_id,
            status="confirmed",
            subject="Other order",
            order_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=other_client.display_name,
            total=Decimal("500.00"),
        )
        db.add_all([linked_order, other_order])
        db.flush()

        linked_project = Project(
            organization_id=organization.id,
            project_number=f"P-PORTAL-{token}",
            order_id=linked_order.id,
            quotation_id=visible_quotation.id,
            client_id=linked_client.id,
            created_by_user_id=membership.user_id,
            name="Portal Project",
            status="in_progress",
            progress_percent=40,
            currency="USD",
            contract_value=Decimal("1200.00"),
        )
        other_project = Project(
            organization_id=organization.id,
            project_number=f"P-OTHER-{token}",
            order_id=other_order.id,
            quotation_id=other_quotation.id,
            client_id=other_client.id,
            created_by_user_id=membership.user_id,
            name="Other Client Project",
            status="in_progress",
            progress_percent=50,
            currency="USD",
            contract_value=Decimal("500.00"),
        )
        db.add_all([linked_project, other_project])
        db.flush()

        shared_milestone = ProjectMilestone(
            organization_id=organization.id,
            project_id=linked_project.id,
            title="Shared milestone",
            description="Safe client update",
            status="in_progress",
            progress_percent=60,
            client_visible=True,
            created_by_user_id=membership.user_id,
        )
        internal_milestone = ProjectMilestone(
            organization_id=organization.id,
            project_id=linked_project.id,
            title="Internal milestone",
            description="Must never reach the client portal",
            status="planned",
            progress_percent=0,
            client_visible=False,
            created_by_user_id=membership.user_id,
        )
        other_milestone = ProjectMilestone(
            organization_id=organization.id,
            project_id=other_project.id,
            title="Other client milestone",
            status="in_progress",
            progress_percent=50,
            client_visible=True,
            created_by_user_id=membership.user_id,
        )
        db.add_all([shared_milestone, internal_milestone, other_milestone])
        db.flush()

        visible_invoice = Invoice(
            organization_id=organization.id,
            invoice_number=f"INV-PORTAL-{token}",
            client_id=linked_client.id,
            project_id=linked_project.id,
            quotation_id=visible_quotation.id,
            created_by_user_id=membership.user_id,
            status="sent",
            subject="Visible invoice",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=linked_client.display_name,
            total=Decimal("1200.00"),
            balance_due=Decimal("1200.00"),
        )
        draft_invoice = Invoice(
            organization_id=organization.id,
            invoice_number=f"INV-DRAFT-{token}",
            client_id=linked_client.id,
            created_by_user_id=membership.user_id,
            status="draft",
            subject="Hidden draft invoice",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=linked_client.display_name,
            total=Decimal("999.00"),
            balance_due=Decimal("999.00"),
        )
        other_invoice = Invoice(
            organization_id=organization.id,
            invoice_number=f"INV-OTHER-{token}",
            client_id=other_client.id,
            project_id=other_project.id,
            quotation_id=other_quotation.id,
            created_by_user_id=membership.user_id,
            status="sent",
            subject="Other client invoice",
            issue_date=date.today(),
            currency="USD",
            seller_name_snapshot="CodeStation AI",
            client_name_snapshot=other_client.display_name,
            total=Decimal("500.00"),
            balance_due=Decimal("500.00"),
        )
        db.add_all([visible_invoice, draft_invoice, other_invoice])
        db.flush()

        tenant = Tenant(organization=organization, membership=membership)
        context = get_client_portal_context(db, tenant)  # type: ignore[arg-type]
        if linked_client.id not in {client.id for client in context.clients}:
            raise AssertionError("Linked client missing from portal context")
        if other_client.id in {client.id for client in context.clients}:
            raise AssertionError("Unlinked client leaked into portal context")
        if context.order_count != 1:
            raise AssertionError(f"Client Portal order count mismatch: {context.order_count}")

        projects = list_client_portal_projects(db, tenant)  # type: ignore[arg-type]
        project_ids = {project.id for project in projects}
        if linked_project.id not in project_ids or other_project.id in project_ids:
            raise AssertionError("Project relationship isolation failed")
        project_detail = get_client_portal_project(linked_project.id, db, tenant)  # type: ignore[arg-type]
        milestone_ids = {item.id for item in project_detail.milestones}
        if shared_milestone.id not in milestone_ids:
            raise AssertionError("Explicitly shared milestone missing from Client Portal")
        if internal_milestone.id in milestone_ids or other_milestone.id in milestone_ids:
            raise AssertionError("Internal or unrelated milestone leaked into Client Portal")
        expect_not_found(lambda: get_client_portal_project(other_project.id, db, tenant))  # type: ignore[arg-type]

        orders = list_client_portal_orders(db, tenant)  # type: ignore[arg-type]
        order_ids = {order.id for order in orders}
        if linked_order.id not in order_ids or other_order.id in order_ids:
            raise AssertionError("Order relationship isolation failed")
        get_client_portal_order(linked_order.id, db, tenant)  # type: ignore[arg-type]
        expect_not_found(lambda: get_client_portal_order(other_order.id, db, tenant))  # type: ignore[arg-type]

        invoices = list_client_portal_invoices(db, tenant)  # type: ignore[arg-type]
        invoice_ids = {invoice.id for invoice in invoices}
        if visible_invoice.id not in invoice_ids or draft_invoice.id in invoice_ids or other_invoice.id in invoice_ids:
            raise AssertionError("Invoice visibility/isolation failed")
        get_client_portal_invoice(visible_invoice.id, db, tenant)  # type: ignore[arg-type]
        expect_not_found(lambda: get_client_portal_invoice(draft_invoice.id, db, tenant))  # type: ignore[arg-type]
        expect_not_found(lambda: get_client_portal_invoice(other_invoice.id, db, tenant))  # type: ignore[arg-type]

        quotations = list_client_portal_quotations(db, tenant)  # type: ignore[arg-type]
        quotation_ids = {quotation.id for quotation in quotations}
        if visible_quotation.id not in quotation_ids or draft_quotation.id in quotation_ids or other_quotation.id in quotation_ids:
            raise AssertionError("Quotation visibility/isolation failed")
        get_client_portal_quotation(visible_quotation.id, db, tenant)  # type: ignore[arg-type]
        expect_not_found(lambda: get_client_portal_quotation(draft_quotation.id, db, tenant))  # type: ignore[arg-type]
        expect_not_found(lambda: get_client_portal_quotation(other_quotation.id, db, tenant))  # type: ignore[arg-type]

        print("Client Portal relationship and sharing isolation verification passed")
    finally:
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
