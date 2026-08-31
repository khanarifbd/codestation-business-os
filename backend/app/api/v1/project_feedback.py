from __future__ import annotations

from collections import defaultdict
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.accounting import LedgerAccount
from app.models.accounting_money import AccountingMoneyEntry
from app.models.finance import FinancialAccount
from app.models.membership import Membership
from app.models.projects import Project, ProjectMember, ProjectReview
from app.models.team import Employee, OrganizationRole
from app.schemas.project_feedback import (
    ProjectFeedbackWorkspace,
    ProjectReviewRead,
    ProjectReviewUpsert,
    ProjectTipCurrencyTotal,
    ProjectTipRead,
)
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/projects", tags=["Project Feedback"])
ProjectWorker = Annotated[TenantContext, Depends(require_tenant_permission("projects.work"))]


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _project(db: DbSession, tenant: TenantContext, project_id: str, *, lock: bool = False) -> Project:
    query = select(Project).where(
        Project.id == project_id,
        Project.organization_id == tenant.organization_id,
    )
    if lock:
        query = query.with_for_update()
    project = db.scalar(query)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _employee_for_user(db: DbSession, tenant: TenantContext) -> Employee | None:
    return db.scalar(
        select(Employee)
        .join(Membership, Membership.id == Employee.membership_id)
        .where(
            Employee.organization_id == tenant.organization_id,
            Membership.organization_id == tenant.organization_id,
            Membership.user_id == tenant.user_id,
            Membership.status == "active",
            Employee.employment_status == "active",
        )
    )


def _permissions(db: DbSession, tenant: TenantContext) -> set[str]:
    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    return set(role.permissions or []) if role else set()


def _has_permission(permissions: set[str], permission: str) -> bool:
    return "*" in permissions or permission in permissions


def _is_project_member(db: DbSession, project: Project, employee: Employee | None) -> bool:
    if employee is None:
        return False
    return db.scalar(
        select(ProjectMember.id).where(
            ProjectMember.organization_id == project.organization_id,
            ProjectMember.project_id == project.id,
            ProjectMember.employee_id == employee.id,
            ProjectMember.is_active.is_(True),
        )
    ) is not None


def _require_participant(
    db: DbSession,
    tenant: TenantContext,
    project: Project,
    permissions: set[str],
    employee: Employee | None,
) -> None:
    can_manage = _has_permission(permissions, "projects.manage") or bool(
        employee and project.project_manager_employee_id == employee.id
    )
    if can_manage or _is_project_member(db, project, employee):
        return
    raise HTTPException(status_code=403, detail="You are not assigned to this project")


def _can_manage_review(
    project: Project,
    permissions: set[str],
    employee: Employee | None,
) -> bool:
    if project.status != "completed":
        return False
    return _has_permission(permissions, "projects.manage") or bool(
        employee and project.project_manager_employee_id == employee.id
    )


def _review_read(review: ProjectReview | None) -> ProjectReviewRead | None:
    if review is None:
        return None
    return ProjectReviewRead(
        id=review.id,
        rating=review.rating,
        review_text=review.review_text,
        source=review.source,
        reviewer_name=review.reviewer_name,
        received_at=review.received_at,
        notes=review.notes,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


def _tip_reads(db: DbSession, project: Project) -> list[ProjectTipRead]:
    rows = db.execute(
        select(AccountingMoneyEntry, FinancialAccount.name, LedgerAccount.name)
        .join(
            FinancialAccount,
            FinancialAccount.id == AccountingMoneyEntry.financial_account_id,
        )
        .join(
            LedgerAccount,
            LedgerAccount.id == AccountingMoneyEntry.category_ledger_account_id,
        )
        .where(
            AccountingMoneyEntry.organization_id == project.organization_id,
            AccountingMoneyEntry.project_id == project.id,
            AccountingMoneyEntry.kind == "income",
            FinancialAccount.organization_id == project.organization_id,
            LedgerAccount.organization_id == project.organization_id,
        )
        .order_by(
            AccountingMoneyEntry.entry_date.desc(),
            AccountingMoneyEntry.created_at.desc(),
            AccountingMoneyEntry.id.desc(),
        )
    ).all()
    return [
        ProjectTipRead(
            id=item.id,
            entry_date=item.entry_date,
            currency=item.currency,
            amount=item.amount,
            financial_account_id=item.financial_account_id,
            financial_account_name=financial_account_name,
            category_ledger_account_id=item.category_ledger_account_id,
            category_ledger_account_name=category_name,
            description=item.description,
            reference=item.reference,
            notes=item.notes,
            created_at=item.created_at,
        )
        for item, financial_account_name, category_name in rows
    ]


def _tip_totals(tips: list[ProjectTipRead]) -> list[ProjectTipCurrencyTotal]:
    totals: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    for item in tips:
        totals[item.currency] += Decimal(item.amount)
    return [
        ProjectTipCurrencyTotal(currency=currency, amount=amount)
        for currency, amount in sorted(totals.items())
    ]


@router.get("/{project_id}/feedback", response_model=ProjectFeedbackWorkspace)
def get_project_feedback(
    project_id: str,
    db: DbSession,
    tenant: ProjectWorker,
) -> ProjectFeedbackWorkspace:
    project = _project(db, tenant, project_id)
    employee = _employee_for_user(db, tenant)
    permissions = _permissions(db, tenant)
    _require_participant(db, tenant, project, permissions, employee)

    review = db.scalar(
        select(ProjectReview).where(
            ProjectReview.organization_id == tenant.organization_id,
            ProjectReview.project_id == project.id,
        )
    )
    can_view_tips = _has_permission(permissions, "finance.view") or _has_permission(
        permissions, "finance.manage"
    )
    can_record_tip = project.status == "completed" and _has_permission(
        permissions, "finance.manage"
    )
    tips = _tip_reads(db, project) if can_view_tips else []

    return ProjectFeedbackWorkspace(
        project_status=project.status,
        project_currency=project.currency,
        review=_review_read(review),
        tips=tips,
        tip_totals=_tip_totals(tips),
        can_manage_review=_can_manage_review(project, permissions, employee),
        can_view_tips=can_view_tips,
        can_record_tip=can_record_tip,
    )


@router.put("/{project_id}/review", response_model=ProjectReviewRead)
def upsert_project_review(
    project_id: str,
    payload: ProjectReviewUpsert,
    request: Request,
    db: DbSession,
    tenant: ProjectWorker,
) -> ProjectReviewRead:
    project = _project(db, tenant, project_id, lock=True)
    employee = _employee_for_user(db, tenant)
    permissions = _permissions(db, tenant)
    _require_participant(db, tenant, project, permissions, employee)
    if project.status != "completed":
        raise HTTPException(
            status_code=409,
            detail="Client review can be added after the project is completed",
        )
    if not _can_manage_review(project, permissions, employee):
        raise HTTPException(status_code=403, detail="Project manager access required")

    review = db.scalar(
        select(ProjectReview)
        .where(
            ProjectReview.organization_id == tenant.organization_id,
            ProjectReview.project_id == project.id,
        )
        .with_for_update()
    )
    created = review is None
    before = None
    if review is None:
        review = ProjectReview(
            organization_id=tenant.organization_id,
            project_id=project.id,
            created_by_user_id=tenant.user_id,
            updated_by_user_id=tenant.user_id,
        )
        db.add(review)
    else:
        before = {
            "rating": review.rating,
            "source": review.source,
            "reviewer_name": review.reviewer_name,
            "received_at": review.received_at.isoformat() if review.received_at else None,
            "review_text": review.review_text,
            "notes": review.notes,
        }

    review.rating = payload.rating
    review.review_text = _clean(payload.review_text)
    review.source = _clean(payload.source)
    review.reviewer_name = _clean(payload.reviewer_name)
    review.received_at = payload.received_at
    review.notes = _clean(payload.notes)
    review.updated_by_user_id = tenant.user_id
    db.flush()

    after = {
        "rating": review.rating,
        "source": review.source,
        "reviewer_name": review.reviewer_name,
        "received_at": review.received_at.isoformat() if review.received_at else None,
        "review_text": review.review_text,
        "notes": review.notes,
    }
    record_activity(
        db,
        action="projects.review.created" if created else "projects.review.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="project_review",
        entity_id=review.id,
        before=before,
        after=after,
        metadata={"project_id": project.id, "project_number": project.project_number},
        message=(
            f"Client review added for {project.project_number}"
            if created
            else f"Client review updated for {project.project_number}"
        ),
        request=request,
    )
    db.commit()
    db.refresh(review)
    result = _review_read(review)
    assert result is not None
    return result
