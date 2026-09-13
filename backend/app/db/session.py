from collections.abc import Generator, Iterator
from contextlib import contextmanager
from time import perf_counter

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.services.performance_metrics import record_db_query


class BusinessSession(Session):
    """SQLAlchemy session with opt-in deferred commits for atomic endpoint wrappers."""

    def commit(self) -> None:
        if int(self.info.get("deferred_commit_depth", 0)) > 0:
            self.flush()
            return
        super().commit()


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_recycle=settings.database_pool_recycle_seconds,
)


@event.listens_for(engine, "before_cursor_execute")
def _start_query_timer(conn, cursor, statement, parameters, context, executemany) -> None:
    # Connection objects can be reused by the pool. A small stack keeps nested
    # executions safe without storing SQL text or bind parameters.
    conn.info.setdefault("business_os_query_started_at", []).append(perf_counter())


@event.listens_for(engine, "after_cursor_execute")
def _finish_query_timer(conn, cursor, statement, parameters, context, executemany) -> None:
    stack = conn.info.get("business_os_query_started_at")
    if not stack:
        return
    started_at = stack.pop()
    if not stack:
        conn.info.pop("business_os_query_started_at", None)
    record_db_query((perf_counter() - started_at) * 1000)


SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    expire_on_commit=False,
    class_=BusinessSession,
)


@contextmanager
def defer_commits(db: Session) -> Iterator[None]:
    """Turn nested commit() calls into flushes until the outer wrapper commits once.

    Financial API wrappers use this when they call established service/endpoint
    functions that historically committed internally. It lets the business record,
    operational balance movement, journal, idempotency record, and audit entry commit
    as one database transaction without rewriting mature business logic.
    """

    previous_depth = int(db.info.get("deferred_commit_depth", 0))
    db.info["deferred_commit_depth"] = previous_depth + 1
    try:
        yield
    except Exception:
        db.rollback()
        raise
    finally:
        if previous_depth:
            db.info["deferred_commit_depth"] = previous_depth
        else:
            db.info.pop("deferred_commit_depth", None)


def _is_activity_log(instance: object) -> bool:
    from app.models.activity_log import ActivityLog

    return isinstance(instance, ActivityLog)


def _has_business_mutation(session: Session) -> bool:
    if any(not _is_activity_log(item) for item in session.new):
        return True
    if any(not _is_activity_log(item) for item in session.deleted):
        return True
    return any(
        not _is_activity_log(item) and session.is_modified(item, include_collections=False)
        for item in session.dirty
    )


@event.listens_for(Session, "before_flush")
def _remember_audit_coverage(session: Session, flush_context, instances) -> None:
    if _has_business_mutation(session):
        session.info["audit_mutation_seen"] = True
    if any(_is_activity_log(item) for item in session.new):
        session.info["audit_record_seen"] = True


@event.listens_for(Session, "before_commit")
def _require_audit_for_commit(session: Session) -> None:
    mutation_seen = session.info.get("audit_mutation_seen", False) or _has_business_mutation(session)
    audit_seen = session.info.get("audit_record_seen", False) or any(
        _is_activity_log(item) for item in session.new
    )
    if mutation_seen and not audit_seen:
        raise RuntimeError(
            "Audit guard blocked database commit: every ORM create/update/delete must include "
            "an ActivityLog in the same transaction."
        )


@event.listens_for(Session, "after_commit")
@event.listens_for(Session, "after_rollback")
def _clear_audit_state(session: Session) -> None:
    session.info.pop("audit_mutation_seen", None)
    session.info.pop("audit_record_seen", None)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
