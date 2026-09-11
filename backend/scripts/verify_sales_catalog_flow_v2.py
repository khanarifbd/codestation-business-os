"""Run the existing sales catalog flow through the Quotation V2 revision contract.

The legacy verification module still exercises PATCH-on-sent/rejected behavior.
For V2 those states are immutable, so this wrapper maps those two legacy edit
calls to the explicit revision workflow while preserving all of the existing
catalog/order/invoice/accounting assertions.
"""

from sqlalchemy import select

import verify_sales_catalog_flow as catalog_flow
from app.api.v1.sales import update_quotation as update_draft_quotation
from app.models.sales import Quotation
from app.services.quotation_v2 import clone_revision


def revision_aware_update(quotation_id, payload, request, db, tenant):
    source = db.scalar(
        select(Quotation)
        .where(
            Quotation.id == quotation_id,
            Quotation.organization_id == tenant.organization_id,
        )
        .with_for_update()
    )
    if source is None:
        return update_draft_quotation(quotation_id, payload, request, db, tenant)

    if source.status not in {"sent", "rejected"}:
        return update_draft_quotation(quotation_id, payload, request, db, tenant)

    source_status = source.status
    expected_root_id = source.root_quotation_id or source.id
    revision = clone_revision(
        db,
        source,
        user_id=tenant.user_id,
        revision_reason=f"Negotiation revision after {source_status}",
        issue_date=source.issue_date,
        valid_until=source.valid_until,
    )

    if revision.quotation_number != source.quotation_number:
        raise AssertionError("quotation revision changed the commercial quotation number")
    if revision.revision_number != source.revision_number + 1:
        raise AssertionError("quotation revision number did not increment")
    if revision.root_quotation_id != expected_root_id:
        raise AssertionError("quotation revision root lineage is incorrect")
    if revision.supersedes_quotation_id != source.id:
        raise AssertionError("quotation revision does not point to the superseded document")
    if revision.status != "draft":
        raise AssertionError("new quotation revision must start as draft")

    updated = update_draft_quotation(revision.id, payload, request, db, tenant)
    db.refresh(source)
    if source.status != source_status:
        raise AssertionError("source quotation was mutated while creating a revision")
    return updated


def main() -> None:
    catalog_flow.update_quotation = revision_aware_update
    catalog_flow.main()


if __name__ == "__main__":
    main()
