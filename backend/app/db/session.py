from collections.abc import Generator

from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=settings.database_pool_size,
    max_overflow=settings.database_max_overflow,
    pool_recycle=settings.database_pool_recycle_seconds,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


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
