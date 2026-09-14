from datetime import date

from sqlalchemy import event, select

from app.api.v1.dashboard_pulse import (
    crm_pulse,
    dashboard_pulse_overview,
    finance_pulse,
    order_pulse,
    people_pulse,
    project_pulse,
)
from app.api.v1.reports import _financials, _operations, _trend
from app.api.v1.reports_fast import (
    _client_rows_fast,
    _financials_and_trend_fast,
    _operations_fast,
    _project_rows_fast,
    reports_dashboard_fast,
)
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


def _dump_rows(rows):
    return [row.model_dump() for row in rows]


def main() -> None:
    db = SessionLocal()
    try:
        organization = db.scalar(select(Organization).where(Organization.name == "Existing Tenant Fixture"))
        if organization is None:
            raise AssertionError("existing tenant fixture missing")

        start = date(2020, 1, 1)
        end = date(2035, 12, 31)

        _, project_queries = count_selects(
            lambda: _project_rows_fast(db, organization.id, start, end, None, None, None)
        )
        _, client_queries = count_selects(
            lambda: _client_rows_fast(db, organization.id, start, end, None, None)
        )

        if project_queries > 4:
            raise AssertionError(f"project report query regression: expected <=4 SELECTs, got {project_queries}")
        if client_queries > 4:
            raise AssertionError(f"client report query regression: expected <=4 SELECTs, got {client_queries}")

        legacy_financials = _financials(db, organization.id, start, end, None, None, None)
        legacy_trend = _trend(db, organization.id, start, end, None, None, None)
        (fast_financials, fast_trend), overview_aggregate_queries = count_selects(
            lambda: _financials_and_trend_fast(db, organization.id, start, end, None, None, None)
        )
        if overview_aggregate_queries > 5:
            raise AssertionError(
                "overview financial/trend query regression: "
                f"expected <=5 SELECTs, got {overview_aggregate_queries}"
            )
        if _dump_rows(fast_financials) != _dump_rows(legacy_financials):
            raise AssertionError("fast overview financial totals diverged from canonical report totals")
        if _dump_rows(fast_trend) != _dump_rows(legacy_trend):
            raise AssertionError("fast overview trend totals diverged from canonical report trend")

        legacy_operations = _operations(db, organization.id, organization.timezone)
        fast_operations, operations_queries = count_selects(
            lambda: _operations_fast(db, organization.id, organization.timezone)
        )
        if operations_queries != 1:
            raise AssertionError(
                f"overview operations query regression: expected 1 SELECT, got {operations_queries}"
            )
        if fast_operations.model_dump() != legacy_operations.model_dump():
            raise AssertionError("fast overview operational totals diverged from canonical report totals")

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

        dashboard_report, dashboard_report_queries = count_selects(
            lambda: reports_dashboard_fast(
                db,
                tenant,
                date_from=start,
                date_to=end,
                currency=None,
            )
        )
        if dashboard_report_queries > 6:
            raise AssertionError(
                f"dashboard report query regression: expected <=6 SELECTs, got {dashboard_report_queries}"
            )
        if dashboard_report.accounts or dashboard_report.projects or dashboard_report.clients:
            raise AssertionError("dashboard report must not materialize unused detail collections")

        _, combined_pulse_queries = count_selects(lambda: dashboard_pulse_overview(db, tenant))
        if combined_pulse_queries > 5:
            raise AssertionError(
                f"combined dashboard pulse query regression: expected <=5 SELECTs, got {combined_pulse_queries}"
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
        f"projects={project_queries}, clients={client_queries}, "
        f"overview_financial_trend={overview_aggregate_queries}, operations={operations_queries}, "
        f"dashboard_report={dashboard_report_queries}, combined_pulse={combined_pulse_queries}, "
        f"pulses={pulse_query_counts}"
    )


if __name__ == "__main__":
    main()
