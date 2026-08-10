from dataclasses import dataclass

from sqlalchemy import select, text

from app.api.v1.financial_correction_history import correction_history
from app.db.session import SessionLocal, engine
from app.models.activity_log import ActivityLog


@dataclass(frozen=True)
class Org:
    id: str
    timezone: str
    currency: str
    name: str


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    role: str
    organization: Org


def main() -> None:
    with engine.begin() as conn:
        row = conn.execute(text("""
            SELECT o.id organization_id, o.created_by_user_id user_id, o.timezone, o.currency, o.name, m.id membership_id
            FROM organizations o
            JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id
            WHERE o.name='Existing Tenant Fixture'
            ORDER BY o.created_at DESC LIMIT 1
        """)).mappings().one()

    tenant = Tenant(
        organization_id=str(row["organization_id"]),
        user_id=str(row["user_id"]),
        membership_id=str(row["membership_id"]),
        role="admin",
        organization=Org(
            id=str(row["organization_id"]),
            timezone=str(row["timezone"] or "UTC"),
            currency=str(row["currency"] or "BDT"),
            name=str(row["name"]),
        ),
    )

    db = SessionLocal()
    try:
        expected_count = db.scalar(
            select(ActivityLog.id)
            .where(
                ActivityLog.organization_id == tenant.organization_id,
                ActivityLog.action.like("finance.%.reversed"),
                ActivityLog.outcome == "success",
            )
            .limit(1)
        )
        if expected_count is None:
            raise AssertionError("correction history verification requires correction audit records")

        rows = correction_history(db, tenant, limit=200)  # type: ignore[arg-type]
        if not rows:
            raise AssertionError("correction history endpoint returned no rows")
        for item in rows:
            if not item["source_id"]:
                raise AssertionError("correction history source linkage is missing")
            if not item["reason"]:
                raise AssertionError("correction history reason is missing")
            if not item["reversal_date"]:
                raise AssertionError("correction history reversal date is missing")
            if item["status"] not in {"reversed", "voided"}:
                raise AssertionError(f"unexpected correction history status: {item['status']}")

        db_ids = set(db.scalars(
            select(ActivityLog.id).where(
                ActivityLog.organization_id == tenant.organization_id,
                ActivityLog.action.like("finance.%.reversed"),
                ActivityLog.outcome == "success",
            )
        ).all())
        returned_ids = {item["id"] for item in rows}
        if not returned_ids.issubset(db_ids):
            raise AssertionError("correction history returned records outside the current tenant")

        print(f"financial correction history verification passed: {len(rows)} auditable reversal records")
    finally:
        db.close()


if __name__ == "__main__":
    main()
