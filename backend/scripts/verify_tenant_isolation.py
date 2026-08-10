from dataclasses import dataclass
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import select

from app.api.v1.crm_clients import get_client_detail
from app.api.v1.finance import get_invoice
from app.api.v1.finance_expenses import _expense_detail
from app.api.v1.orders import _detail as order_detail
from app.api.v1.projects import _detail as project_detail
from app.db.session import SessionLocal
from app.models.crm import Client
from app.models.expenses import Expense
from app.models.finance import Invoice
from app.models.orders import Order
from app.models.organization import Organization
from app.models.projects import Project


@dataclass(frozen=True)
class FixtureOrganization:
    timezone: str


@dataclass(frozen=True)
class FixtureTenant:
    organization_id: str
    user_id: str
    organization: FixtureOrganization


def expect_not_found(label: str, fn) -> None:
    try:
        fn()
    except HTTPException as exc:
        if exc.status_code != 404:
            raise AssertionError(f"{label}: expected HTTP 404, got {exc.status_code}: {exc.detail}") from exc
        return
    raise AssertionError(f"{label}: cross-tenant access unexpectedly succeeded")


def main() -> None:
    with SessionLocal() as db:
        organization = db.scalar(
            select(Organization)
            .where(Organization.name == "Existing Tenant Fixture")
            .order_by(Organization.created_at.desc())
            .limit(1)
        )
        if organization is None:
            raise AssertionError("existing tenant fixture missing")

        client = db.scalar(
            select(Client)
            .where(Client.organization_id == organization.id)
            .order_by(Client.created_at.desc())
            .limit(1)
        )
        order = db.scalar(
            select(Order)
            .where(Order.organization_id == organization.id)
            .order_by(Order.created_at.desc())
            .limit(1)
        )
        project = db.scalar(
            select(Project)
            .where(Project.organization_id == organization.id)
            .order_by(Project.created_at.desc())
            .limit(1)
        )
        invoice = db.scalar(
            select(Invoice)
            .where(Invoice.organization_id == organization.id)
            .order_by(Invoice.created_at.desc())
            .limit(1)
        )
        expense = db.scalar(
            select(Expense)
            .where(Expense.organization_id == organization.id)
            .order_by(Expense.created_at.desc())
            .limit(1)
        )
        if client is None or order is None or project is None or invoice is None or expense is None:
            raise AssertionError("tenant isolation fixtures require client, order, project, invoice and expense records")

        foreign_tenant = FixtureTenant(
            organization_id=str(uuid4()),
            user_id=str(organization.created_by_user_id),
            organization=FixtureOrganization(timezone=organization.timezone or "UTC"),
        )

        expect_not_found(
            "CRM client detail",
            lambda: get_client_detail(client.id, db, foreign_tenant),  # type: ignore[arg-type]
        )
        expect_not_found(
            "Order detail",
            lambda: order_detail(db, foreign_tenant.organization_id, order.id),
        )
        expect_not_found(
            "Project detail",
            lambda: project_detail(db, foreign_tenant.organization_id, project.id),
        )
        expect_not_found(
            "Finance invoice detail",
            lambda: get_invoice(invoice.id, db, foreign_tenant),  # type: ignore[arg-type]
        )
        expect_not_found(
            "Finance expense detail",
            lambda: _expense_detail(db, foreign_tenant.organization_id, expense.id),
        )

    print("tenant isolation verification passed: client, order, project, invoice and expense cross-tenant access denied")


if __name__ == "__main__":
    main()
