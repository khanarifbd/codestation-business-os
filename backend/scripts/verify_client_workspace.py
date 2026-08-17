from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.crm_client_workspace import get_client_workspace
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole


@dataclass(frozen=True)
class Tenant:
    organization: Organization
    membership: Membership

    @property
    def organization_id(self) -> str:
        return self.organization.id


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
            .where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
            .limit(1)
        )
        if organization is None:
            raise AssertionError("Existing tenant fixture was not found")

        client = db.scalar(
            select(Client)
            .where(Client.organization_id == organization.id)
            .order_by(Client.created_at.desc())
            .limit(1)
        )
        if client is None:
            raise AssertionError("CRM won-flow fixture did not create a client")

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
            raise AssertionError("Existing tenant fixture has no active membership")

        role = db.scalar(
            select(OrganizationRole).where(
                OrganizationRole.id == membership.role_id,
                OrganizationRole.organization_id == organization.id,
                OrganizationRole.is_active.is_(True),
            )
        )
        if role is None:
            raise AssertionError("Existing tenant fixture membership has no active organization role")

        workspace = get_client_workspace(
            client.id,
            db,
            Tenant(organization=organization, membership=membership),  # type: ignore[arg-type]
            10,
        )
        if workspace.client.id != client.id or workspace.client.client_code != client.client_code:
            raise AssertionError("Client workspace returned the wrong tenant client")

        permissions = set(role.permissions or [])
        has = lambda permission: "*" in permissions or permission in permissions
        expected = {
            "clients_manage": has("clients.manage"),
            "quotations": has("quotations.view"),
            "quotations_manage": has("quotations.manage"),
            "orders": has("orders.view"),
            "projects": has("projects.view"),
            "finance": has("finance.view"),
            "finance_manage": has("finance.manage"),
        }
        if workspace.access.model_dump() != expected:
            raise AssertionError(f"Client workspace capability mismatch: {workspace.access.model_dump()} != {expected}")

        if not workspace.access.orders and workspace.business_value:
            raise AssertionError("Order value leaked without orders.view permission")
        if not workspace.access.finance and (workspace.invoice_summary or workspace.invoices or workspace.payments):
            raise AssertionError("Finance data leaked without finance.view permission")
        if not workspace.access.projects and workspace.projects:
            raise AssertionError("Project data leaked without projects.view permission")
        if not workspace.access.quotations and workspace.quotations:
            raise AssertionError("Quotation data leaked without quotations.view permission")

        expect_not_found(
            lambda: get_client_workspace(
                str(uuid4()),
                db,
                Tenant(organization=organization, membership=membership),  # type: ignore[arg-type]
                10,
            )
        )
    finally:
        db.close()

    print("Client 360 workspace tenant/RBAC verification passed")


if __name__ == "__main__":
    main()
