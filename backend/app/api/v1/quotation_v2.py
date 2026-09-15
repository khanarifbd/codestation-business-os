from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.sales import (
    Quotation,
    QuotationItem,
    QuotationMilestone,
    QuotationPaymentMilestone,
    QuotationSection,
)
from app.schemas.quotation_v2 import (
    QuotationCommercialDetail,
    QuotationCommercialUpdate,
    QuotationMilestoneRead,
    QuotationPaymentMilestoneRead,
    QuotationRevisionCreate,
    QuotationRevisionListItem,
    QuotationSectionRead,
    QuotationV2ItemRead,
)
from app.services.activity_log import record_activity
from app.services.quotation_v2 import (
    clean_text,
    clone_revision,
    latest_revision,
    replace_milestones,
    replace_payment_milestones,
    replace_sections,
)
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/sales/quotations", tags=["Sales - Quotation V2"])

QuotationViewer = Annotated[TenantContext, Depends(require_tenant_permission("quotations.view"))]
QuotationManager = Annotated[TenantContext, Depends(require_tenant_permission("quotations.manage"))]


def _quotation(db: DbSession, organization_id: str, quotation_id: str, *, for_update: bool = False) -> Quotation:
    query = select(Quotation).where(
        Quotation.id == quotation_id,
        Quotation.organization_id == organization_id,
    )
    if for_update:
        query = query.with_for_update()
    quotation = db.scalar(query)
    if quotation is None:
        raise HTTPException(status_code=404, detail="Quotation not found")
    return quotation


def _effective_status(db: DbSession, quotation: Quotation) -> str:
    _root_id, latest = latest_revision(db, quotation)
    return quotation.status if latest.id == quotation.id else "superseded"


def _require_latest_revision(db: DbSession, quotation: Quotation) -> None:
    _root_id, latest = latest_revision(db, quotation)
    if latest.id != quotation.id:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Quotation R{quotation.revision_number} has been superseded by "
                f"R{latest.revision_number}; use the latest revision"
            ),
        )


def _item_read(item: QuotationItem) -> QuotationV2ItemRead:
    return QuotationV2ItemRead(
        id=item.id,
        product_id=item.product_id,
        lead_interest_id=item.lead_interest_id,
        sort_order=item.sort_order,
        item_name_snapshot=item.item_name_snapshot,
        sku_snapshot=item.sku_snapshot,
        item_type_snapshot=item.item_type_snapshot,
        unit_snapshot=item.unit_snapshot,
        service_duration_months_snapshot=item.service_duration_months_snapshot,
        description=item.description,
        quantity=item.quantity,
        unit_price=item.unit_price,
        discount_percent=item.discount_percent,
        tax_rate=item.tax_rate,
        line_subtotal=item.line_subtotal,
        discount_amount=item.discount_amount,
        taxable_amount=item.taxable_amount,
        tax_amount=item.tax_amount,
        line_total=item.line_total,
    )


def _section_read(item: QuotationSection) -> QuotationSectionRead:
    return QuotationSectionRead(
        id=item.id,
        section_type=item.section_type,
        title=item.title,
        content=item.content,
        sort_order=item.sort_order,
        is_visible=item.is_visible,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _milestone_read(item: QuotationMilestone) -> QuotationMilestoneRead:
    return QuotationMilestoneRead(
        id=item.id,
        title=item.title,
        description=item.description,
        estimated_start_date=item.estimated_start_date,
        estimated_end_date=item.estimated_end_date,
        estimated_duration=item.estimated_duration,
        acceptance_criteria=item.acceptance_criteria,
        sort_order=item.sort_order,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _payment_read(item: QuotationPaymentMilestone) -> QuotationPaymentMilestoneRead:
    return QuotationPaymentMilestoneRead(
        id=item.id,
        quotation_milestone_id=item.quotation_milestone_id,
        title=item.title,
        description=item.description,
        payment_type=item.payment_type,
        percentage=item.percentage,
        amount=item.amount,
        due_condition=item.due_condition,
        due_date=item.due_date,
        sort_order=item.sort_order,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


def _detail(db: DbSession, quotation: Quotation) -> QuotationCommercialDetail:
    items = db.scalars(
        select(QuotationItem)
        .where(
            QuotationItem.organization_id == quotation.organization_id,
            QuotationItem.quotation_id == quotation.id,
        )
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()
    sections = db.scalars(
        select(QuotationSection)
        .where(
            QuotationSection.organization_id == quotation.organization_id,
            QuotationSection.quotation_id == quotation.id,
        )
        .order_by(QuotationSection.sort_order.asc(), QuotationSection.created_at.asc())
    ).all()
    milestones = db.scalars(
        select(QuotationMilestone)
        .where(
            QuotationMilestone.organization_id == quotation.organization_id,
            QuotationMilestone.quotation_id == quotation.id,
        )
        .order_by(QuotationMilestone.sort_order.asc(), QuotationMilestone.created_at.asc())
    ).all()
    payments = db.scalars(
        select(QuotationPaymentMilestone)
        .where(
            QuotationPaymentMilestone.organization_id == quotation.organization_id,
            QuotationPaymentMilestone.quotation_id == quotation.id,
        )
        .order_by(QuotationPaymentMilestone.sort_order.asc(), QuotationPaymentMilestone.created_at.asc())
    ).all()
    return QuotationCommercialDetail(
        id=quotation.id,
        quotation_number=quotation.quotation_number,
        root_quotation_id=quotation.root_quotation_id,
        supersedes_quotation_id=quotation.supersedes_quotation_id,
        revision_number=quotation.revision_number,
        revision_reason=quotation.revision_reason,
        status=_effective_status(db, quotation),
        client_id=quotation.client_id,
        source_lead_id=quotation.source_lead_id,
        assigned_employee_id=quotation.assigned_employee_id,
        subject=quotation.subject,
        project_title=quotation.project_title,
        executive_summary=quotation.executive_summary,
        issue_date=quotation.issue_date,
        valid_until=quotation.valid_until,
        estimated_start_date=quotation.estimated_start_date,
        estimated_end_date=quotation.estimated_end_date,
        estimated_duration=quotation.estimated_duration,
        start_condition=quotation.start_condition,
        currency=quotation.currency,
        tax_calculation_mode=quotation.tax_calculation_mode,
        seller_name_snapshot=quotation.seller_name_snapshot,
        seller_email_snapshot=quotation.seller_email_snapshot,
        seller_phone_snapshot=quotation.seller_phone_snapshot,
        seller_address_snapshot=quotation.seller_address_snapshot,
        seller_tax_identifier_snapshot=quotation.seller_tax_identifier_snapshot,
        client_name_snapshot=quotation.client_name_snapshot,
        client_contact_snapshot=quotation.client_contact_snapshot,
        client_email_snapshot=quotation.client_email_snapshot,
        client_phone_snapshot=quotation.client_phone_snapshot,
        client_address_snapshot=quotation.client_address_snapshot,
        client_tax_identifier_snapshot=quotation.client_tax_identifier_snapshot,
        prepared_by_name_snapshot=quotation.prepared_by_name_snapshot,
        prepared_by_email_snapshot=quotation.prepared_by_email_snapshot,
        prepared_by_designation_snapshot=quotation.prepared_by_designation_snapshot,
        subtotal=quotation.subtotal,
        discount_total=quotation.discount_total,
        tax_total=quotation.tax_total,
        total=quotation.total,
        internal_notes=quotation.internal_notes,
        sent_at=quotation.sent_at,
        accepted_at=quotation.accepted_at,
        rejected_at=quotation.rejected_at,
        cancelled_at=quotation.cancelled_at,
        items=[_item_read(item) for item in items],
        sections=[_section_read(item) for item in sections],
        milestones=[_milestone_read(item) for item in milestones],
        payment_milestones=[_payment_read(item) for item in payments],
        created_at=quotation.created_at,
        updated_at=quotation.updated_at,
    )


def _delete_payment_milestones(db: DbSession, quotation: Quotation) -> None:
    rows = db.scalars(
        select(QuotationPaymentMilestone).where(
            QuotationPaymentMilestone.organization_id == quotation.organization_id,
            QuotationPaymentMilestone.quotation_id == quotation.id,
        )
    ).all()
    for row in rows:
        db.delete(row)
    db.flush()


@router.get("/{quotation_id}/commercial", response_model=QuotationCommercialDetail)
def get_commercial_quotation(
    quotation_id: str,
    db: DbSession,
    tenant: QuotationViewer,
) -> QuotationCommercialDetail:
    quotation = _quotation(db, tenant.organization_id, quotation_id)
    return _detail(db, quotation)


@router.patch("/{quotation_id}/commercial", response_model=QuotationCommercialDetail)
def update_commercial_quotation(
    quotation_id: str,
    payload: QuotationCommercialUpdate,
    request: Request,
    db: DbSession,
    tenant: QuotationManager,
) -> QuotationCommercialDetail:
    quotation = _quotation(db, tenant.organization_id, quotation_id, for_update=True)
    _require_latest_revision(db, quotation)
    if quotation.status != "draft":
        raise HTTPException(status_code=409, detail="Sent, accepted, rejected, or cancelled quotations are immutable; create a revision instead")

    fields = payload.model_fields_set
    before = {
        "project_title": quotation.project_title,
        "estimated_start_date": quotation.estimated_start_date.isoformat() if quotation.estimated_start_date else None,
        "estimated_end_date": quotation.estimated_end_date.isoformat() if quotation.estimated_end_date else None,
    }
    for field in (
        "project_title",
        "executive_summary",
        "estimated_start_date",
        "estimated_end_date",
        "estimated_duration",
        "start_condition",
    ):
        if field not in fields:
            continue
        value = getattr(payload, field)
        if isinstance(value, str):
            value = clean_text(value)
        setattr(quotation, field, value)

    if quotation.estimated_start_date and quotation.estimated_end_date and quotation.estimated_end_date < quotation.estimated_start_date:
        raise HTTPException(status_code=400, detail="Estimated end date cannot be before start date")

    if "milestones" in fields and "payment_milestones" not in fields:
        payment_count = db.scalar(
            select(func.count(QuotationPaymentMilestone.id)).where(
                QuotationPaymentMilestone.organization_id == quotation.organization_id,
                QuotationPaymentMilestone.quotation_id == quotation.id,
            )
        )
        if payment_count:
            raise HTTPException(status_code=409, detail="Resubmit payment milestones when replacing delivery milestones")

    if "sections" in fields:
        replace_sections(db, quotation, payload.sections or [])

    new_milestones = None
    if "milestones" in fields:
        if "payment_milestones" in fields:
            _delete_payment_milestones(db, quotation)
        new_milestones = replace_milestones(db, quotation, payload.milestones or [])

    if "payment_milestones" in fields:
        replace_payment_milestones(
            db,
            quotation,
            payload.payment_milestones or [],
            new_milestones=new_milestones,
        )

    db.flush()
    after = {
        "project_title": quotation.project_title,
        "estimated_start_date": quotation.estimated_start_date.isoformat() if quotation.estimated_start_date else None,
        "estimated_end_date": quotation.estimated_end_date.isoformat() if quotation.estimated_end_date else None,
        "section_count": db.scalar(select(func.count(QuotationSection.id)).where(QuotationSection.quotation_id == quotation.id)),
        "milestone_count": db.scalar(select(func.count(QuotationMilestone.id)).where(QuotationMilestone.quotation_id == quotation.id)),
        "payment_milestone_count": db.scalar(select(func.count(QuotationPaymentMilestone.id)).where(QuotationPaymentMilestone.quotation_id == quotation.id)),
    }
    record_activity(
        db,
        action="sales.quotation.commercial_updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="quotation",
        entity_id=quotation.id,
        before=before,
        after=after,
        message=f"Quotation commercial proposal updated: {quotation.quotation_number} R{quotation.revision_number}",
        request=request,
    )
    db.commit()
    return _detail(db, quotation)


@router.get("/{quotation_id}/revisions", response_model=list[QuotationRevisionListItem])
def list_quotation_revisions(
    quotation_id: str,
    db: DbSession,
    tenant: QuotationViewer,
) -> list[QuotationRevisionListItem]:
    quotation = _quotation(db, tenant.organization_id, quotation_id)
    root_id = quotation.root_quotation_id or quotation.id
    rows = db.scalars(
        select(Quotation)
        .where(
            Quotation.organization_id == tenant.organization_id,
            or_(Quotation.id == root_id, Quotation.root_quotation_id == root_id),
        )
        .order_by(Quotation.revision_number.asc(), Quotation.created_at.asc())
    ).all()
    latest_id = rows[-1].id if rows else None
    return [
        QuotationRevisionListItem(
            id=item.id,
            quotation_number=item.quotation_number,
            revision_number=item.revision_number,
            revision_reason=item.revision_reason,
            status=item.status if item.id == latest_id else "superseded",
            issue_date=item.issue_date,
            valid_until=item.valid_until,
            currency=item.currency,
            total=item.total,
            created_at=item.created_at,
        )
        for item in rows
    ]


@router.post("/{quotation_id}/revisions", response_model=QuotationCommercialDetail, status_code=status.HTTP_201_CREATED)
def create_quotation_revision(
    quotation_id: str,
    payload: QuotationRevisionCreate,
    request: Request,
    db: DbSession,
    tenant: QuotationManager,
) -> QuotationCommercialDetail:
    source = _quotation(db, tenant.organization_id, quotation_id, for_update=True)
    revision = clone_revision(
        db,
        source,
        user_id=tenant.user_id,
        revision_reason=payload.revision_reason,
        issue_date=payload.issue_date,
        valid_until=payload.valid_until,
    )
    record_activity(
        db,
        action="sales.quotation.revision_created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="quotation",
        entity_id=revision.id,
        before={
            "source_quotation_id": source.id,
            "source_revision_number": source.revision_number,
            "source_status": source.status,
        },
        after={
            "revision_number": revision.revision_number,
            "status": revision.status,
            "revision_reason": revision.revision_reason,
        },
        message=f"Quotation revision created: {revision.quotation_number} R{revision.revision_number}",
        request=request,
    )
    db.commit()
    return _detail(db, revision)
