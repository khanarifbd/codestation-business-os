from dataclasses import dataclass

from fastapi.routing import APIRoute
from sqlalchemy import event, select

from app.main import app
from app.api.v1.client_access import list_client_access as legacy_client_access
from app.api.v1.inventory import products as legacy_products
from app.api.v1.inventory_management import list_suppliers as legacy_suppliers
from app.api.v1.phase4_read_fast import (
    list_client_access_fast,
    products_fast,
    project_workspace_fast,
    router as phase4_read_fast_router,
    suppliers_fast,
)
from app.api.v1.project_execution import get_workspace as legacy_workspace
from app.db.session import SessionLocal, engine
from app.models.inventory import Product
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.projects import Project
from app.models.team import OrganizationRole
from app.models.user import User
from app.services.sales_catalog import resolve_sales_line
from app.tenancy.context import TenantContext


API_PREFIX = "/api/v1"


@dataclass(frozen=True)
class TenantStub:
    organization_id: str


def count_selects(fn):
    count = 0

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        nonlocal count
        if statement.lstrip().upper().startswith("SELECT"):
            count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        result = fn()
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)
    return result, count


def source_route_endpoint(method: str, path: str):
    matches = [
        route
        for route in phase4_read_fast_router.routes
        if isinstance(route, APIRoute) and route.path == path and method in (route.methods or set())
    ]
    if len(matches) != 1:
        raise AssertionError(f"expected one Phase 4 source {method} {path}, found {len(matches)}")
    return matches[0].endpoint


def project_tenant(db):
    projects = db.scalars(select(Project).order_by(Project.created_at.desc())).all()
    for project in projects:
        organization = db.get(Organization, project.organization_id)
        if organization is None:
            continue
        memberships = db.scalars(
            select(Membership).where(
                Membership.organization_id == project.organization_id,
                Membership.status == "active",
            )
        ).all()
        for membership in memberships:
            role = db.get(OrganizationRole, membership.role_id) if membership.role_id else None
            permissions = set(role.permissions or []) if role and role.is_active else set()
            if "*" not in permissions and "projects.manage" not in permissions and "projects.view" not in permissions:
                continue
            user = db.get(User, membership.user_id)
            if user is None:
                continue
            return project, TenantContext(
                user=user,
                organization=organization,
                membership=membership,
                organization_role=role,
            )
    raise AssertionError("no project with a broad-view active tenant member found for Phase 4 verification")


def dump_models(rows):
    return [row.model_dump() for row in rows]


def main() -> None:
    db = SessionLocal()
    try:
        project, tenant = project_tenant(db)
        inventory_tenant = TenantStub(organization_id=tenant.organization_id)

        legacy_product_rows = legacy_products(db, inventory_tenant, include_inactive=True)  # type: ignore[arg-type]
        fast_product_rows, product_queries = count_selects(
            lambda: products_fast(db, inventory_tenant, include_inactive=True)  # type: ignore[arg-type]
        )
        if legacy_product_rows != fast_product_rows:
            raise AssertionError("batched inventory product list changed API output")
        if product_queries != 1:
            raise AssertionError(f"inventory product query regression: expected 1 SELECT, got {product_queries}")

        legacy_supplier_rows = legacy_suppliers(db, inventory_tenant, include_inactive=True)  # type: ignore[arg-type]
        fast_supplier_rows, supplier_queries = count_selects(
            lambda: suppliers_fast(db, inventory_tenant, include_inactive=True)  # type: ignore[arg-type]
        )
        if legacy_supplier_rows != fast_supplier_rows:
            raise AssertionError("batched inventory supplier list changed API output")
        if supplier_queries != 1:
            raise AssertionError(f"inventory supplier query regression: expected 1 SELECT, got {supplier_queries}")

        legacy_project = legacy_workspace(project.id, db, tenant)
        fast_project, workspace_queries = count_selects(lambda: project_workspace_fast(project.id, db, tenant))
        if legacy_project.model_dump() != fast_project.model_dump():
            raise AssertionError("batched project workspace changed API output")
        if workspace_queries > 10:
            raise AssertionError(f"project workspace query regression: expected <=10 SELECTs, got {workspace_queries}")

        legacy_access = legacy_client_access(db, tenant)
        fast_access, client_access_queries = count_selects(lambda: list_client_access_fast(db, tenant))
        if dump_models(legacy_access) != dump_models(fast_access):
            raise AssertionError("batched client-access list changed API output")
        if client_access_queries > 2:
            raise AssertionError(
                f"client-access query regression: expected <=2 SELECTs, got {client_access_queries}"
            )

        catalog_product = db.scalar(
            select(Product).where(Product.is_active.is_(True)).order_by(Product.created_at.asc()).limit(1)
        )
        if catalog_product is None:
            raise AssertionError("no active catalog product found for Phase 4 query verification")
        _, catalog_queries = count_selects(
            lambda: resolve_sales_line(
                db,
                organization_id=catalog_product.organization_id,
                currency=catalog_product.currency,
                product_id=catalog_product.id,
                item_name=None,
                item_type=None,
                unit=None,
                description=None,
            )
        )
        if catalog_queries != 1:
            raise AssertionError(f"sales catalog lookup regression: expected 1 SELECT, got {catalog_queries}")

        schema_paths = app.openapi().get("paths", {})
        for method, path, expected_name in (
            ("GET", "/inventory/products", "products_fast"),
            ("GET", "/inventory/suppliers", "suppliers_fast"),
            ("GET", "/projects/{project_id}/workspace", "project_workspace_fast"),
            ("GET", "/crm/client-access", "list_client_access_fast"),
        ):
            endpoint = source_route_endpoint(method, path)
            if endpoint.__name__ != expected_name:
                raise AssertionError(f"{method} {path} is not owned by the bounded Phase 4 read handler")
            public_path = f"{API_PREFIX}{path}"
            if public_path not in schema_paths or method.lower() not in schema_paths[public_path]:
                raise AssertionError(f"public OpenAPI operation is missing: {method} {public_path}")
    finally:
        db.close()

    print(
        "Phase 4 read performance verification passed: "
        f"products={product_queries}, suppliers={supplier_queries}, workspace={workspace_queries}, "
        f"client_access={client_access_queries}, catalog={catalog_queries}"
    )


if __name__ == "__main__":
    main()
