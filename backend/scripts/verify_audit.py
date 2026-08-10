from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.db.session import SessionLocal
from app.models.activity_log import ActivityLog
from app.models.user import User
from app.services.activity_log import record_activity


def main() -> None:
    with SessionLocal() as db:
        baseline = db.scalar(
            select(ActivityLog).where(ActivityLog.action == "system.audit.initialized").limit(1)
        )
        if baseline is None:
            raise RuntimeError("Audit baseline event was not created by migration")

        blocked_user = User(
            email=f"audit-blocked-{uuid4()}@example.com",
            full_name="Audit Guard Blocked",
            password_hash="not-a-real-password-hash",
        )
        db.add(blocked_user)
        try:
            db.commit()
        except RuntimeError as exc:
            if "Audit guard blocked database commit" not in str(exc):
                raise
            db.rollback()
        else:
            raise RuntimeError("ORM audit guard allowed a mutation without an ActivityLog")

        allowed_user = User(
            email=f"audit-allowed-{uuid4()}@example.com",
            full_name="Audit Guard Allowed",
            password_hash="not-a-real-password-hash",
        )
        db.add(allowed_user)
        db.flush()
        log = record_activity(
            db,
            action="ci.audit.guard_verified",
            scope="system",
            actor_type="system",
            entity_type="user",
            entity_id=allowed_user.id,
            message="CI verified audit transaction coverage",
            after={"id": allowed_user.id, "email": allowed_user.email},
            metadata={"environment": "ci"},
        )
        db.commit()

        log.message = "This update must be blocked"
        try:
            db.commit()
        except SQLAlchemyError:
            db.rollback()
        else:
            raise RuntimeError("PostgreSQL allowed an UPDATE to append-only activity_logs")

    print("audit invariant verification passed")


if __name__ == "__main__":
    main()
