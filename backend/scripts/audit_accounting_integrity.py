from __future__ import annotations

import argparse
import json

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.organization import Organization
from app.services.accounting_integrity_audit import audit_organization_accounting


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Read-only accounting integrity audit for one organization. "
            "This command does not synchronize, repair, post, or commit financial data."
        )
    )
    selector = parser.add_mutually_exclusive_group(required=True)
    selector.add_argument("--organization-id")
    selector.add_argument("--organization-name")
    selector.add_argument(
        "--organization-name-prefix",
        help="CI/internal fixture selector; audits the newest exact prefix match",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    return parser.parse_args()


def resolve_organization(db, args: argparse.Namespace) -> Organization:
    if args.organization_id:
        organization = db.scalar(select(Organization).where(Organization.id == args.organization_id))
        if organization is None:
            raise SystemExit(f"Organization not found: {args.organization_id}")
        return organization

    if args.organization_name:
        matches = db.scalars(
            select(Organization).where(Organization.name == args.organization_name).order_by(Organization.created_at.desc())
        ).all()
        if not matches:
            raise SystemExit(f"Organization not found: {args.organization_name}")
        if len(matches) > 1:
            raise SystemExit(
                f"Organization name is not unique ({len(matches)} matches). Use --organization-id instead."
            )
        return matches[0]

    prefix = str(args.organization_name_prefix)
    organization = db.scalar(
        select(Organization)
        .where(Organization.name.like(f"{prefix}%"))
        .order_by(Organization.created_at.desc())
        .limit(1)
    )
    if organization is None:
        raise SystemExit(f"No organization starts with: {prefix}")
    return organization


def main() -> None:
    args = parse_args()
    db = SessionLocal()
    try:
        organization = resolve_organization(db, args)
        report = audit_organization_accounting(db, organization.id)

        if args.as_json:
            print(
                json.dumps(
                    {
                        "ok": report.ok,
                        "organization_id": report.organization_id,
                        "organization_name": report.organization_name,
                        "stats": report.stats,
                        "issues": [
                            {"code": issue.code, "message": issue.message}
                            for issue in report.issues
                        ],
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
        else:
            print(f"Accounting integrity audit: {report.organization_name} ({report.organization_id})")
            for key in sorted(report.stats):
                print(f"  {key}: {report.stats[key]}")
            if report.ok:
                print("RESULT: PASS — no accounting integrity issues detected")
            else:
                print(f"RESULT: FAIL — {len(report.issues)} issue(s) detected")
                for issue in report.issues:
                    print(f"  [{issue.code}] {issue.message}")

        if not report.ok:
            raise SystemExit(1)
    finally:
        # Explicit rollback reinforces that this command is inspection-only even
        # if a future ORM read path accidentally triggers an autoflush.
        db.rollback()
        db.close()


if __name__ == "__main__":
    main()
