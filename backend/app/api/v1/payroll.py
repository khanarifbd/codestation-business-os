from datetime import timedelta, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.company_settings import OrganizationDocumentSequence
from app.models.finance import FinancialAccount, FinancialTransaction
from app.models.membership import Membership
from app.models.payroll import PayrollEntry, PayrollPeriod, PayrollRun, SalaryProfile
from app.models.team import Employee
from app.models.user import User
from app.schemas.payroll import (
    PayrollAccountOption,
    PayrollEmployeeOption,
    PayrollEntryRead,
    PayrollEntryUpdate,
    PayrollMeta,
    PayrollPayRequest,
    PayrollPeriodCreate,
    PayrollPeriodRead,
    PayrollRunCreate,
    PayrollRunRead,
    SalaryProfileCreate,
    SalaryProfileRead,
    SalaryProfileUpdate,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/payroll", tags=["Payroll"])
PayrollViewer = Annotated[TenantContext, Depends(require_tenant_permission("payroll.view"))]
PayrollManager = Annotated[TenantContext, Depends(require_tenant_permission("payroll.manage"))]
MONEY = Decimal("0.01")


def _money(value) -> Decimal:
    return Decimal(value or 0).quantize(MONEY, rounding=ROUND_HALF_UP)


def _component_dicts(items) -> list[dict]:
    return [{"name": item.name.strip(), "amount": str(_money(item.amount))} for item in items]


def _component_total(items: list[dict]) -> Decimal:
    return _money(sum((Decimal(str(item.get("amount", 0))) for item in items), Decimal("0")))


def _ensure_payroll_sequence(db: DbSession, organization_id: str) -> None:
    exists = db.scalar(
        select(OrganizationDocumentSequence.id).where(
            OrganizationDocumentSequence.organization_id == organization_id,
            OrganizationDocumentSequence.document_type == "payroll",
        )
    )
    if exists is None:
        db.add(OrganizationDocumentSequence(organization_id=organization_id, document_type="payroll", prefix="PAY"))
        db.flush()


def _employee_rows(db: DbSession, organization_id: str):
    return db.execute(
        select(Employee.id, Employee.employee_code, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(Employee.organization_id == organization_id, Employee.employment_status == "active", Membership.status == "active")
        .order_by(User.full_name.asc())
    ).all()


def _employee_name_map(db: DbSession, organization_id: str, ids: set[str]) -> dict[str, tuple[str, str]]:
    if not ids:
        return {}
    rows = db.execute(
        select(Employee.id, Employee.employee_code, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id)
        .join(User, User.id == Membership.user_id)
        .where(Employee.organization_id == organization_id, Employee.id.in_(ids))
    ).all()
    return {row.id: (row.employee_code, row.full_name) for row in rows}


def _account_balance(db: DbSession, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(func.coalesce(func.sum(
            func.case((FinancialTransaction.direction == "credit", FinancialTransaction.amount), else_=-FinancialTransaction.amount)
        ), 0)).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    )
    return _money(Decimal(account.opening_balance) + Decimal(net or 0))


def _profile_read(profile: SalaryProfile, employee_code: str, employee_name: str) -> SalaryProfileRead:
    return SalaryProfileRead(
        id=profile.id, employee_id=profile.employee_id, employee_code=employee_code, employee_name=employee_name,
        currency=profile.currency, pay_frequency=profile.pay_frequency, base_salary=profile.base_salary,
        default_allowances=profile.default_allowances, default_deductions=profile.default_deductions,
        effective_from=profile.effective_from, effective_to=profile.effective_to, is_active=profile.is_active,
        notes=profile.notes, created_at=profile.created_at,
    )


def _entry_reads(db: DbSession, organization_id: str, run_id: str) -> list[PayrollEntryRead]:
    entries = db.scalars(
        select(PayrollEntry).where(PayrollEntry.organization_id == organization_id, PayrollEntry.run_id == run_id).order_by(PayrollEntry.created_at.asc())
    ).all()
    names = _employee_name_map(db, organization_id, {item.employee_id for item in entries})
    return [
        PayrollEntryRead(
            id=item.id, employee_id=item.employee_id,
            employee_code=names.get(item.employee_id, ("—", "—"))[0], employee_name=names.get(item.employee_id, ("—", "—"))[1],
            currency=item.currency, base_salary=item.base_salary, allowances=item.allowances, deductions=item.deductions,
            allowance_total=item.allowance_total, deduction_total=item.deduction_total, tax_amount=item.tax_amount,
            gross_pay=item.gross_pay, net_pay=item.net_pay, notes=item.notes,
        ) for item in entries
    ]


def _run_read(db: DbSession, organization_id: str, run: PayrollRun, include_entries: bool = True) -> PayrollRunRead:
    period = db.scalar(select(PayrollPeriod).where(PayrollPeriod.id == run.period_id, PayrollPeriod.organization_id == organization_id))
    return PayrollRunRead(
        id=run.id, run_number=run.run_number, period_id=run.period_id, period_name=period.name if period else "—",
        currency=run.currency, status=run.status, employee_count=run.employee_count,
        gross_total=run.gross_total, allowance_total=run.allowance_total, deduction_total=run.deduction_total,
        tax_total=run.tax_total, net_total=run.net_total, paid_account_id=run.paid_account_id,
        approved_at=run.approved_at, paid_at=run.paid_at, created_at=run.created_at,
        entries=_entry_reads(db, organization_id, run.id) if include_entries else [],
    )


def _recalculate_run(db: DbSession, run: PayrollRun) -> None:
    row = db.execute(
        select(
            func.count(PayrollEntry.id), func.coalesce(func.sum(PayrollEntry.gross_pay), 0),
            func.coalesce(func.sum(PayrollEntry.allowance_total), 0), func.coalesce(func.sum(PayrollEntry.deduction_total), 0),
            func.coalesce(func.sum(PayrollEntry.tax_amount), 0), func.coalesce(func.sum(PayrollEntry.net_pay), 0),
        ).where(PayrollEntry.organization_id == run.organization_id, PayrollEntry.run_id == run.id)
    ).one()
    run.employee_count = int(row[0] or 0)
    run.gross_total, run.allowance_total, run.deduction_total, run.tax_total, run.net_total = map(_money, row[1:])


@router.get("/meta", response_model=PayrollMeta)
def payroll_meta(db: DbSession, tenant: PayrollViewer) -> PayrollMeta:
    employees = [PayrollEmployeeOption(id=row.id, employee_code=row.employee_code, full_name=row.full_name) for row in _employee_rows(db, tenant.organization_id)]
    accounts = db.scalars(select(FinancialAccount).where(FinancialAccount.organization_id == tenant.organization_id).order_by(FinancialAccount.is_active.desc(), FinancialAccount.name.asc())).all()
    currencies = sorted({tenant.organization.currency, *(item.currency for item in accounts)})
    return PayrollMeta(employees=employees, accounts=[PayrollAccountOption(id=a.id, name=a.name, currency=a.currency, is_active=a.is_active) for a in accounts], currencies=currencies)


@router.get("/salary-profiles", response_model=list[SalaryProfileRead])
def list_salary_profiles(db: DbSession, tenant: PayrollViewer):
    profiles = db.scalars(select(SalaryProfile).where(SalaryProfile.organization_id == tenant.organization_id).order_by(SalaryProfile.is_active.desc(), SalaryProfile.created_at.desc())).all()
    names = _employee_name_map(db, tenant.organization_id, {item.employee_id for item in profiles})
    return [_profile_read(item, *names.get(item.employee_id, ("—", "—"))) for item in profiles]


@router.post("/salary-profiles", response_model=SalaryProfileRead, status_code=status.HTTP_201_CREATED)
def create_salary_profile(payload: SalaryProfileCreate, request: Request, db: DbSession, tenant: PayrollManager):
    employee = db.execute(
        select(Employee.id, Employee.employee_code, User.full_name)
        .join(Membership, Membership.id == Employee.membership_id).join(User, User.id == Membership.user_id)
        .where(Employee.id == payload.employee_id, Employee.organization_id == tenant.organization_id, Employee.employment_status == "active")
    ).first()
    if employee is None: raise HTTPException(status_code=404, detail="Active employee not found")
    if payload.pay_frequency not in {"monthly", "biweekly", "weekly"}: raise HTTPException(status_code=400, detail="Unsupported pay frequency")
    existing = db.scalars(select(SalaryProfile).where(SalaryProfile.organization_id == tenant.organization_id, SalaryProfile.employee_id == payload.employee_id, SalaryProfile.is_active.is_(True)).with_for_update()).all()
    for old in existing:
        old.is_active = False
        if old.effective_from < payload.effective_from:
            old.effective_to = payload.effective_from - timedelta(days=1)
    profile = SalaryProfile(
        organization_id=tenant.organization_id, employee_id=payload.employee_id, currency=payload.currency.upper(),
        pay_frequency=payload.pay_frequency, base_salary=_money(payload.base_salary),
        default_allowances=_component_dicts(payload.default_allowances), default_deductions=_component_dicts(payload.default_deductions),
        effective_from=payload.effective_from, notes=payload.notes, created_by_user_id=tenant.user_id,
    )
    db.add(profile); db.flush()
    record_activity(db, action="payroll.salary_profile.created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="salary_profile", entity_id=profile.id, after={"employee_id": profile.employee_id, "currency": profile.currency, "base_salary": str(profile.base_salary)}, request=request)
    db.commit(); db.refresh(profile)
    return _profile_read(profile, employee.employee_code, employee.full_name)


@router.patch("/salary-profiles/{profile_id}", response_model=SalaryProfileRead)
def update_salary_profile(profile_id: str, payload: SalaryProfileUpdate, request: Request, db: DbSession, tenant: PayrollManager):
    profile = db.scalar(select(SalaryProfile).where(SalaryProfile.id == profile_id, SalaryProfile.organization_id == tenant.organization_id).with_for_update())
    if profile is None: raise HTTPException(status_code=404, detail="Salary profile not found")
    before = {"base_salary": str(profile.base_salary), "is_active": profile.is_active}
    changes = payload.model_dump(exclude_unset=True)
    if changes.get("base_salary") is not None: changes["base_salary"] = _money(changes["base_salary"])
    if changes.get("default_allowances") is not None: changes["default_allowances"] = _component_dicts(payload.default_allowances or [])
    if changes.get("default_deductions") is not None: changes["default_deductions"] = _component_dicts(payload.default_deductions or [])
    for key, value in changes.items(): setattr(profile, key, value)
    db.flush()
    record_activity(db, action="payroll.salary_profile.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="salary_profile", entity_id=profile.id, before=before, after={"base_salary": str(profile.base_salary), "is_active": profile.is_active}, request=request)
    db.commit(); db.refresh(profile)
    name = _employee_name_map(db, tenant.organization_id, {profile.employee_id}).get(profile.employee_id, ("—", "—"))
    return _profile_read(profile, *name)


@router.get("/periods", response_model=list[PayrollPeriodRead])
def list_periods(db: DbSession, tenant: PayrollViewer):
    return db.scalars(select(PayrollPeriod).where(PayrollPeriod.organization_id == tenant.organization_id).order_by(PayrollPeriod.period_start.desc()).limit(100)).all()


@router.post("/periods", response_model=PayrollPeriodRead, status_code=status.HTTP_201_CREATED)
def create_period(payload: PayrollPeriodCreate, request: Request, db: DbSession, tenant: PayrollManager):
    overlap = db.scalar(select(PayrollPeriod.id).where(PayrollPeriod.organization_id == tenant.organization_id, PayrollPeriod.period_start <= payload.period_end, PayrollPeriod.period_end >= payload.period_start))
    if overlap is not None: raise HTTPException(status_code=409, detail="Payroll period overlaps an existing period")
    item = PayrollPeriod(organization_id=tenant.organization_id, name=payload.name.strip(), period_start=payload.period_start, period_end=payload.period_end,
        pay_date=payload.pay_date, notes=payload.notes, created_by_user_id=tenant.user_id)
    db.add(item); db.flush()
    record_activity(db, action="payroll.period.created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payroll_period", entity_id=item.id, after={"name": item.name, "period_start": str(item.period_start), "period_end": str(item.period_end)}, request=request)
    db.commit(); db.refresh(item); return item


@router.get("/runs", response_model=list[PayrollRunRead])
def list_runs(db: DbSession, tenant: PayrollViewer):
    runs = db.scalars(select(PayrollRun).where(PayrollRun.organization_id == tenant.organization_id).order_by(PayrollRun.created_at.desc()).limit(100)).all()
    return [_run_read(db, tenant.organization_id, item, include_entries=False) for item in runs]


@router.get("/runs/{run_id}", response_model=PayrollRunRead)
def get_run(run_id: str, db: DbSession, tenant: PayrollViewer):
    run = db.scalar(select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.organization_id == tenant.organization_id))
    if run is None: raise HTTPException(status_code=404, detail="Payroll run not found")
    return _run_read(db, tenant.organization_id, run)


@router.post("/runs", response_model=PayrollRunRead, status_code=status.HTTP_201_CREATED)
def create_run(payload: PayrollRunCreate, request: Request, db: DbSession, tenant: PayrollManager):
    period = db.scalar(select(PayrollPeriod).where(PayrollPeriod.id == payload.period_id, PayrollPeriod.organization_id == tenant.organization_id).with_for_update())
    if period is None: raise HTTPException(status_code=404, detail="Payroll period not found")
    if period.status != "open": raise HTTPException(status_code=409, detail="Payroll period is not open")
    currency = payload.currency.upper()
    if db.scalar(select(PayrollRun.id).where(PayrollRun.organization_id == tenant.organization_id, PayrollRun.period_id == period.id, PayrollRun.currency == currency)):
        raise HTTPException(status_code=409, detail=f"A {currency} payroll run already exists for this period")
    profiles = db.scalars(select(SalaryProfile).where(
        SalaryProfile.organization_id == tenant.organization_id, SalaryProfile.currency == currency, SalaryProfile.is_active.is_(True),
        SalaryProfile.effective_from <= period.period_end,
        or_(SalaryProfile.effective_to.is_(None), SalaryProfile.effective_to >= period.period_start),
    )).all()
    if not profiles: raise HTTPException(status_code=409, detail=f"No active {currency} salary profiles found for this period")
    _ensure_payroll_sequence(db, tenant.organization_id)
    run = PayrollRun(organization_id=tenant.organization_id, run_number=next_sequence_code(db, tenant.organization_id, "payroll"),
        period_id=period.id, currency=currency, created_by_user_id=tenant.user_id)
    db.add(run); db.flush()
    for profile in profiles:
        allowances = profile.default_allowances or []; deductions = profile.default_deductions or []
        allowance_total = _component_total(allowances); deduction_total = _component_total(deductions)
        gross = _money(profile.base_salary + allowance_total); net = _money(gross - deduction_total)
        if net < 0: raise HTTPException(status_code=409, detail="Payroll entry cannot have negative net pay")
        db.add(PayrollEntry(organization_id=tenant.organization_id, run_id=run.id, employee_id=profile.employee_id, salary_profile_id=profile.id,
            currency=currency, base_salary=profile.base_salary, allowances=allowances, deductions=deductions,
            allowance_total=allowance_total, deduction_total=deduction_total, tax_amount=Decimal("0"), gross_pay=gross, net_pay=net))
    db.flush(); _recalculate_run(db, run); db.flush()
    record_activity(db, action="payroll.run.created", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payroll_run", entity_id=run.id, after={"run_number": run.run_number, "currency": run.currency, "employee_count": run.employee_count, "net_total": str(run.net_total)}, request=request)
    db.commit(); db.refresh(run); return _run_read(db, tenant.organization_id, run)


@router.patch("/runs/{run_id}/entries/{entry_id}", response_model=PayrollRunRead)
def update_entry(run_id: str, entry_id: str, payload: PayrollEntryUpdate, request: Request, db: DbSession, tenant: PayrollManager):
    run = db.scalar(select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.organization_id == tenant.organization_id).with_for_update())
    if run is None: raise HTTPException(status_code=404, detail="Payroll run not found")
    if run.status != "draft": raise HTTPException(status_code=409, detail="Only draft payroll can be edited")
    entry = db.scalar(select(PayrollEntry).where(PayrollEntry.id == entry_id, PayrollEntry.run_id == run.id, PayrollEntry.organization_id == tenant.organization_id).with_for_update())
    if entry is None: raise HTTPException(status_code=404, detail="Payroll entry not found")
    if payload.allowances is not None: entry.allowances = _component_dicts(payload.allowances); entry.allowance_total = _component_total(entry.allowances)
    if payload.deductions is not None: entry.deductions = _component_dicts(payload.deductions); entry.deduction_total = _component_total(entry.deductions)
    if payload.tax_amount is not None: entry.tax_amount = _money(payload.tax_amount)
    if payload.notes is not None: entry.notes = payload.notes.strip() or None
    entry.gross_pay = _money(entry.base_salary + entry.allowance_total)
    entry.net_pay = _money(entry.gross_pay - entry.deduction_total - entry.tax_amount)
    if entry.net_pay < 0: raise HTTPException(status_code=400, detail="Net pay cannot be negative")
    db.flush(); _recalculate_run(db, run); db.flush()
    record_activity(db, action="payroll.entry.updated", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payroll_entry", entity_id=entry.id, after={"net_pay": str(entry.net_pay), "tax_amount": str(entry.tax_amount)}, request=request)
    db.commit(); db.refresh(run); return _run_read(db, tenant.organization_id, run)


@router.post("/runs/{run_id}/approve", response_model=PayrollRunRead)
def approve_run(run_id: str, request: Request, db: DbSession, tenant: PayrollManager):
    run = db.scalar(select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.organization_id == tenant.organization_id).with_for_update())
    if run is None: raise HTTPException(status_code=404, detail="Payroll run not found")
    if run.status != "draft": raise HTTPException(status_code=409, detail="Only draft payroll can be approved")
    if run.employee_count == 0: raise HTTPException(status_code=409, detail="Payroll run has no employees")
    run.status = "approved"; run.approved_at = datetime.now(timezone.utc)
    record_activity(db, action="payroll.run.approved", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payroll_run", entity_id=run.id, after={"status": run.status, "net_total": str(run.net_total)}, request=request)
    db.commit(); db.refresh(run); return _run_read(db, tenant.organization_id, run)


@router.post("/runs/{run_id}/pay", response_model=PayrollRunRead)
def pay_run(run_id: str, payload: PayrollPayRequest, request: Request, db: DbSession, tenant: PayrollManager):
    run = db.scalar(select(PayrollRun).where(PayrollRun.id == run_id, PayrollRun.organization_id == tenant.organization_id).with_for_update())
    if run is None: raise HTTPException(status_code=404, detail="Payroll run not found")
    if run.status != "approved": raise HTTPException(status_code=409, detail="Only approved payroll can be paid")
    period = db.scalar(select(PayrollPeriod).where(PayrollPeriod.id == run.period_id, PayrollPeriod.organization_id == tenant.organization_id).with_for_update())
    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id, FinancialAccount.is_active.is_(True)).with_for_update())
    if account is None: raise HTTPException(status_code=404, detail="Active financial account not found")
    if account.currency != run.currency: raise HTTPException(status_code=400, detail=f"Payroll currency is {run.currency}; select a {run.currency} account")
    balance = _account_balance(db, account)
    if run.net_total > balance: raise HTTPException(status_code=409, detail=f"Insufficient balance. Available {balance} {account.currency}")
    db.add(FinancialTransaction(organization_id=tenant.organization_id, account_id=account.id, transaction_date=period.pay_date,
        direction="debit", amount=run.net_total, currency=run.currency, source_type="payroll_run", source_id=run.id,
        reference=run.run_number, description=f"Payroll {run.run_number} · {period.name}", created_by_user_id=tenant.user_id))
    run.status = "paid"; run.paid_account_id = account.id; run.paid_at = datetime.now(timezone.utc)
    remaining = db.scalar(select(func.count(PayrollRun.id)).where(PayrollRun.organization_id == tenant.organization_id, PayrollRun.period_id == period.id, PayrollRun.id != run.id, PayrollRun.status != "paid")) or 0
    if remaining == 0: period.status = "paid"
    record_activity(db, action="payroll.run.paid", scope="tenant", actor_user_id=tenant.user_id, organization_id=tenant.organization_id,
        entity_type="payroll_run", entity_id=run.id, after={"status": "paid", "account_id": account.id, "amount": str(run.net_total), "currency": run.currency}, request=request)
    db.commit(); db.refresh(run); return _run_read(db, tenant.organization_id, run)
