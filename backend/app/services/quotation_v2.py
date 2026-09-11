from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP

from fastapi import HTTPException
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models.membership import Membership
from app.models.sales import (
    Quotation,
    QuotationItem,
    QuotationMilestone,
    QuotationPaymentMilestone,
    QuotationSection,
)
from app.models.team import Designation, Employee
from app.models.user import User
from app.schemas.quotation_v2 import (
    QuotationMilestoneInput,
    QuotationPaymentMilestoneInput,
    QuotationSectionInput,
)

MONEY = Decimal("0.01")


def clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def prepared_by_snapshot(db: Session, organization_id: str, user_id: str) -> tuple[str | None, str | None, str | None]:
    user = db.scalar(select(User).where(User.id == user_id))
    if user is None:
        return None, None, None
    designation = db.scalar(
        select(Designation.name)
        .join(Employee, Employee.designation_id == Designation.id)
        .join(Membership, Membership.id == Employee.membership_id)
        .where(
            Membership.user_id == user_id,
            Membership.organization_id == organization_id,
            Employee.organization_id == organization_id,
            Designation.organization_id == organization_id,
        )
        .limit(1)
    )
    return user.full_name, user.email, designation


def replace_sections(db: Session, quotation: Quotation, payloads: list[QuotationSectionInput]) -> list[QuotationSection]:
    existing = db.scalars(
        select(QuotationSection).where(
            QuotationSection.organization_id == quotation.organization_id,
            QuotationSection.quotation_id == quotation.id,
        )
    ).all()
    for row in existing:
        db.delete(row)
    db.flush()

    rows: list[QuotationSection] = []
    for index, payload in enumerate(payloads):
        row = QuotationSection(
            organization_id=quotation.organization_id,
            quotation_id=quotation.id,
            section_type=payload.section_type,
            title=clean_text(payload.title),
            content=payload.content.strip(),
            sort_order=payload.sort_order if payload.sort_order is not None else index * 10,
            is_visible=payload.is_visible,
        )
        db.add(row)
        rows.append(row)

    ordered = sorted(rows, key=lambda item: (item.sort_order, item.section_type))
    notes = [item.content for item in ordered if item.section_type == "additional_notes" and item.is_visible]
    terms = [item.content for item in ordered if item.section_type == "terms_conditions" and item.is_visible]
    quotation.notes = "\n\n".join(notes) or None
    quotation.terms_conditions = "\n\n".join(terms) or None
    db.flush()
    return rows


def replace_milestones(db: Session, quotation: Quotation, payloads: list[QuotationMilestoneInput]) -> list[QuotationMilestone]:
    existing = db.scalars(
        select(QuotationMilestone).where(
            QuotationMilestone.organization_id == quotation.organization_id,
            QuotationMilestone.quotation_id == quotation.id,
        )
    ).all()
    for row in existing:
        db.delete(row)
    db.flush()

    rows: list[QuotationMilestone] = []
    for index, payload in enumerate(payloads):
        row = QuotationMilestone(
            organization_id=quotation.organization_id,
            quotation_id=quotation.id,
            title=payload.title.strip(),
            description=clean_text(payload.description),
            estimated_start_date=payload.estimated_start_date,
            estimated_end_date=payload.estimated_end_date,
            estimated_duration=clean_text(payload.estimated_duration),
            acceptance_criteria=clean_text(payload.acceptance_criteria),
            sort_order=payload.sort_order if payload.sort_order is not None else index * 10,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def _payment_amounts(quotation: Quotation, payloads: list[QuotationPaymentMilestoneInput]) -> list[Decimal]:
    total = Decimal(quotation.total).quantize(MONEY, rounding=ROUND_HALF_UP)
    amounts: list[Decimal] = []
    percentage_indexes: list[int] = []
    all_percentage = bool(payloads) and all(item.payment_type == "percentage" for item in payloads)
    percentage_sum = Decimal("0")

    for index, payload in enumerate(payloads):
        if payload.payment_type == "percentage":
            percentage = Decimal(payload.percentage or 0)
            percentage_sum += percentage
            amount = (total * percentage / Decimal("100")).quantize(MONEY, rounding=ROUND_HALF_UP)
            percentage_indexes.append(index)
        else:
            amount = Decimal(payload.amount or 0).quantize(MONEY, rounding=ROUND_HALF_UP)
        amounts.append(amount)

    calculated_total = sum(amounts, Decimal("0")).quantize(MONEY, rounding=ROUND_HALF_UP)
    if all_percentage and percentage_sum == Decimal("100") and percentage_indexes:
        amounts[percentage_indexes[-1]] += total - calculated_total
        calculated_total = total

    if payloads and calculated_total != total:
        raise HTTPException(
            status_code=400,
            detail=f"Payment milestones must total quotation amount {total}; received {calculated_total}",
        )
    return amounts


def replace_payment_milestones(
    db: Session,
    quotation: Quotation,
    payloads: list[QuotationPaymentMilestoneInput],
    *,
    new_milestones: list[QuotationMilestone] | None = None,
) -> list[QuotationPaymentMilestone]:
    existing = db.scalars(
        select(QuotationPaymentMilestone).where(
            QuotationPaymentMilestone.organization_id == quotation.organization_id,
            QuotationPaymentMilestone.quotation_id == quotation.id,
        )
    ).all()
    for row in existing:
        db.delete(row)
    db.flush()

    amounts = _payment_amounts(quotation, payloads)
    rows: list[QuotationPaymentMilestone] = []
    for index, payload in enumerate(payloads):
        milestone_id = payload.quotation_milestone_id
        if payload.quotation_milestone_index is not None:
            if new_milestones is None or payload.quotation_milestone_index >= len(new_milestones):
                raise HTTPException(status_code=400, detail="Payment milestone references an invalid quotation milestone index")
            milestone_id = new_milestones[payload.quotation_milestone_index].id
        if milestone_id:
            linked = db.scalar(
                select(QuotationMilestone.id).where(
                    QuotationMilestone.id == milestone_id,
                    QuotationMilestone.organization_id == quotation.organization_id,
                    QuotationMilestone.quotation_id == quotation.id,
                )
            )
            if linked is None:
                raise HTTPException(status_code=400, detail="Payment milestone must reference a milestone on this quotation")

        row = QuotationPaymentMilestone(
            organization_id=quotation.organization_id,
            quotation_id=quotation.id,
            quotation_milestone_id=milestone_id,
            title=payload.title.strip(),
            description=clean_text(payload.description),
            payment_type=payload.payment_type,
            percentage=payload.percentage if payload.payment_type == "percentage" else None,
            amount=amounts[index],
            due_condition=clean_text(payload.due_condition),
            due_date=payload.due_date,
            sort_order=payload.sort_order if payload.sort_order is not None else index * 10,
        )
        db.add(row)
        rows.append(row)
    db.flush()
    return rows


def latest_revision(db: Session, quotation: Quotation, *, lock_root: bool = False) -> tuple[str, Quotation]:
    root_id = quotation.root_quotation_id or quotation.id
    if lock_root:
        db.scalar(select(Quotation.id).where(Quotation.id == root_id).with_for_update())
    latest = db.scalar(
        select(Quotation)
        .where(
            Quotation.organization_id == quotation.organization_id,
            or_(Quotation.id == root_id, Quotation.root_quotation_id == root_id),
        )
        .order_by(Quotation.revision_number.desc(), Quotation.created_at.desc())
        .limit(1)
    )
    if latest is None:
        raise HTTPException(status_code=404, detail="Quotation revision family not found")
    return root_id, latest


def clone_revision(
    db: Session,
    source: Quotation,
    *,
    user_id: str,
    revision_reason: str,
    issue_date: date | None,
    valid_until: date | None,
) -> Quotation:
    root_id, latest = latest_revision(db, source, lock_root=True)
    if latest.id != source.id:
        raise HTTPException(status_code=409, detail="A newer quotation revision already exists; revise the latest revision")
    if source.status not in {"sent", "rejected"}:
        raise HTTPException(status_code=409, detail="Only sent or rejected quotations can be revised")

    new_issue_date = issue_date or date.today()
    if valid_until is not None:
        new_valid_until = valid_until
    elif source.valid_until is not None:
        validity_days = max((source.valid_until - source.issue_date).days, 0)
        new_valid_until = new_issue_date + timedelta(days=validity_days)
    else:
        new_valid_until = None
    if new_valid_until is not None and new_valid_until < new_issue_date:
        raise HTTPException(status_code=400, detail="Valid until date cannot be before issue date")

    prepared_name, prepared_email, prepared_designation = prepared_by_snapshot(db, source.organization_id, user_id)
    revision = Quotation(
        organization_id=source.organization_id,
        quotation_number=source.quotation_number,
        client_id=source.client_id,
        source_lead_id=source.source_lead_id,
        assigned_employee_id=source.assigned_employee_id,
        created_by_user_id=user_id,
        root_quotation_id=root_id,
        supersedes_quotation_id=source.id,
        revision_number=source.revision_number + 1,
        revision_reason=revision_reason.strip(),
        status="draft",
        subject=source.subject,
        project_title=source.project_title,
        executive_summary=source.executive_summary,
        issue_date=new_issue_date,
        valid_until=new_valid_until,
        estimated_start_date=source.estimated_start_date,
        estimated_end_date=source.estimated_end_date,
        estimated_duration=source.estimated_duration,
        start_condition=source.start_condition,
        currency=source.currency,
        tax_calculation_mode=source.tax_calculation_mode,
        seller_name_snapshot=source.seller_name_snapshot,
        seller_email_snapshot=source.seller_email_snapshot,
        seller_phone_snapshot=source.seller_phone_snapshot,
        seller_address_snapshot=source.seller_address_snapshot,
        seller_tax_identifier_snapshot=source.seller_tax_identifier_snapshot,
        client_name_snapshot=source.client_name_snapshot,
        client_contact_snapshot=source.client_contact_snapshot,
        client_email_snapshot=source.client_email_snapshot,
        client_phone_snapshot=source.client_phone_snapshot,
        client_address_snapshot=source.client_address_snapshot,
        client_tax_identifier_snapshot=source.client_tax_identifier_snapshot,
        prepared_by_name_snapshot=prepared_name,
        prepared_by_email_snapshot=prepared_email,
        prepared_by_designation_snapshot=prepared_designation,
        subtotal=source.subtotal,
        discount_total=source.discount_total,
        tax_total=source.tax_total,
        total=source.total,
        notes=source.notes,
        terms_conditions=source.terms_conditions,
        internal_notes=source.internal_notes,
    )
    db.add(revision)
    db.flush()

    items = db.scalars(
        select(QuotationItem)
        .where(
            QuotationItem.organization_id == source.organization_id,
            QuotationItem.quotation_id == source.id,
        )
        .order_by(QuotationItem.sort_order.asc(), QuotationItem.created_at.asc())
    ).all()
    for item in items:
        db.add(
            QuotationItem(
                organization_id=source.organization_id,
                quotation_id=revision.id,
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
        )

    sections = db.scalars(
        select(QuotationSection)
        .where(
            QuotationSection.organization_id == source.organization_id,
            QuotationSection.quotation_id == source.id,
        )
        .order_by(QuotationSection.sort_order.asc(), QuotationSection.created_at.asc())
    ).all()
    for section in sections:
        db.add(
            QuotationSection(
                organization_id=source.organization_id,
                quotation_id=revision.id,
                section_type=section.section_type,
                title=section.title,
                content=section.content,
                sort_order=section.sort_order,
                is_visible=section.is_visible,
            )
        )

    source_milestones = db.scalars(
        select(QuotationMilestone)
        .where(
            QuotationMilestone.organization_id == source.organization_id,
            QuotationMilestone.quotation_id == source.id,
        )
        .order_by(QuotationMilestone.sort_order.asc(), QuotationMilestone.created_at.asc())
    ).all()
    milestone_map: dict[str, str] = {}
    for milestone in source_milestones:
        copied = QuotationMilestone(
            organization_id=source.organization_id,
            quotation_id=revision.id,
            title=milestone.title,
            description=milestone.description,
            estimated_start_date=milestone.estimated_start_date,
            estimated_end_date=milestone.estimated_end_date,
            estimated_duration=milestone.estimated_duration,
            acceptance_criteria=milestone.acceptance_criteria,
            sort_order=milestone.sort_order,
        )
        db.add(copied)
        db.flush()
        milestone_map[milestone.id] = copied.id

    source_payments = db.scalars(
        select(QuotationPaymentMilestone)
        .where(
            QuotationPaymentMilestone.organization_id == source.organization_id,
            QuotationPaymentMilestone.quotation_id == source.id,
        )
        .order_by(QuotationPaymentMilestone.sort_order.asc(), QuotationPaymentMilestone.created_at.asc())
    ).all()
    for payment in source_payments:
        db.add(
            QuotationPaymentMilestone(
                organization_id=source.organization_id,
                quotation_id=revision.id,
                quotation_milestone_id=milestone_map.get(payment.quotation_milestone_id) if payment.quotation_milestone_id else None,
                title=payment.title,
                description=payment.description,
                payment_type=payment.payment_type,
                percentage=payment.percentage,
                amount=payment.amount,
                due_condition=payment.due_condition,
                due_date=payment.due_date,
                sort_order=payment.sort_order,
            )
        )
    db.flush()
    return revision
