from datetime import date

from sqlalchemy import event, select

from app.api.v1.reports_fast import _client_rows_fast, _project_rows_fast
from app.db.session import SessionLocal, engine
from app.models.organization import Organization


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
    finally:
        db.close()

    print(f"reports performance verification passed: projects={project_queries}, clients={client_queries}")


if __name__ == "__main__":
    main()
