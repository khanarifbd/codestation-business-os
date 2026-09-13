from datetime import date

from sqlalchemy import event, select

from app.api.v1.dashboard_pulse import (
    crm_pulse,
    finance_pulse,
    order_pulse,
    people_pulse,
    project_pulse,
)
from app.api.v1.reports_fast import _client_rows_fast, _project_rows_fast
from app.db.session import SessionLocal, engine
from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import OrganizationRole
from app.models.user import User
from app.tenancy.context import TenantContext


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


def main() -> None:
    db = SessionLocal()
    try:
        organization = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        if organization is None:
            raise AssertionError("existing tenant fixture missing")

        _, project_queries = count_selects(
            lambda: _project_rows_fast(db, organization.id, date(2020, 1, 1), date(2035, 12, 31), None, None, None)
        )
        _, client_queries = count_selects(
            lambda: _client_rows_fast(db, organization.id, date(2020, 1, 1), date(2035, 12, 31), None, None)
        )

        if project_queries > 4:
            raise AssertionError(f"project report query regression: expected <=4 SELECTs, got {project_queries}")
        if client_queries > 4:
            raise AssertionError(f"client report query regression: expected <=4 SELECTs, got {client_queries}")

        membership = db.scalar(
            select(Membership).where(
                Membership.organization_id == organization.id,
                Membership.user_id == organization.created_by_user_id,
                Membership.status == "active",
            )
        )
        user = db.get(User, organization.created_by_user_id)
        if membership is None or user is None:
            raise AssertionError("dashboard performance fixture membership missing")
        role = db.scalar(
            select(OrganizationRole).where(
                OrganizationRole.id == membership.role_id,
                OrganizationRole.organization_id == organization.id,
            )
        )
        tenant = TenantContext(
            user=user,
            organization=organization,
            membership=membership,
            organization_role=role,
        )

        pulse_query_counts = {}
        for name, fn in (
            ("orders", order_pulse),
            ("projects", project_pulse),
            ("crm", crm_pulse),
            ("finance", finance_pulse),
            ("people", people_pulse),
        ):
            _, query_count = count_selects(lambda fn=fn: fn(db, tenant))
            pulse_query_counts[name] = query_count
            if query_count != 1:
                raise AssertionError(
                    f"dashboard {name} pulse query regression: expected 1 SELECT, got {query_count}"
                )
    finally:
        db.close()

    print(
        "reports performance verification passed: "
        f"projects={project_queries}, clients={client_queries}, pulses={pulse_query_counts}"
    )


if __name__ == "__main__":
    main()
