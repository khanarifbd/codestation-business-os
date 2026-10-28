"""Transactional input adapter. No commits, numbering, journals or hidden defaults.

Call lock_payroll_inputs before participating input writes; then lock organization,
period, employee rows and profile rows in that order. All lock claims require the
real PostgreSQL concurrency suite before release; unit mocks are not that proof.
"""
from datetime import date, datetime, timezone
import hashlib
import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, text

from app.models.hr_extended import HRHoliday
from app.models.organization import Organization
from app.models.payroll import PayrollPeriod, SalaryProfile
from app.models.payroll_policy import PayrollPolicyVersion
from app.models.team import Employee
from app.schemas.payroll_policy import (
    PayrollCalculationInput, PayrollEmployeeInput, PayrollHolidayInput,
    PayrollPolicyConfig, PayrollPolicySnapshot, PayrollSalaryProfileInput, PayrollSetupIssue,
)
from app.services.payroll_policy import PayrollCalculationError, calculate_payroll, payroll_reference_horizon


def lock_payroll_inputs(db, organization_id: str) -> None:
    # Signed 64-bit stable namespace. Collisions only serialize unrelated tenants;
    # every following query still has its independent organization predicate.
    key = int.from_bytes(hashlib.sha256(("business-os:payroll-inputs:v1:" + organization_id).encode()).digest()[:8], "big", signed=True)
    db.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": key})


def locked_payroll_organization(db, organization_id: str):
    organization = db.scalar(
        select(Organization).where(Organization.id == organization_id)
        .with_for_update(read=True).execution_options(populate_existing=True)
    )
    if organization is None:
        raise HTTPException(status_code=404, detail="Company not found")
    return organization


def payroll_local_today(organization) -> date:
    try:
        return datetime.now(timezone.utc).astimezone(ZoneInfo(organization.timezone)).date()
    except (ZoneInfoNotFoundError, ValueError, TypeError):
        raise HTTPException(status_code=409, detail="Configure a valid company timezone before using payroll policies") from None


def policy_for_date(db, organization_id: str, as_of: date):
    return db.scalar(
        select(PayrollPolicyVersion).where(
            PayrollPolicyVersion.organization_id == organization_id,
            PayrollPolicyVersion.effective_from <= as_of,
        ).order_by(PayrollPolicyVersion.effective_from.desc(), PayrollPolicyVersion.version.desc()).limit(1)
    )


def locked_payroll_period(db, organization_id: str, period_id: str, *, for_create: bool):
    period = db.scalar(
        select(PayrollPeriod).where(PayrollPeriod.organization_id == organization_id, PayrollPeriod.id == period_id)
        .with_for_update(read=not for_create).execution_options(populate_existing=True)
    )
    if period is None:
        raise HTTPException(status_code=404, detail="Payroll period not found")
    if period.status != "open":
        raise HTTPException(status_code=409, detail="Payroll period is not open")
    return period


def resolve_payroll_calculation(db, organization, period, currency: str, policy):
    """Authoritative salary-enrolled roster, all currencies, full-cycle holidays."""
    org = organization.id
    # Profile writers share the already-held tenant mutex, including first inserts.
    candidate_ids = db.scalars(select(SalaryProfile.employee_id).where(SalaryProfile.organization_id == org).distinct()).all()
    employees = db.scalars(
        select(Employee).where(Employee.organization_id == org, Employee.id.in_(candidate_ids))
        .order_by(Employee.id).with_for_update(read=True).execution_options(populate_existing=True)
    ).all()
    profiles = db.scalars(
        select(SalaryProfile).where(SalaryProfile.organization_id == org)
        .order_by(SalaryProfile.id).with_for_update(read=True).execution_options(populate_existing=True)
    ).all()
    try:
        employee_inputs = tuple(PayrollEmployeeInput(id=row.id, organization_id=row.organization_id,
            employment_status=row.employment_status, join_date=row.join_date, end_date=row.end_date) for row in employees)
        profile_inputs = tuple(PayrollSalaryProfileInput(
            id=row.id, organization_id=row.organization_id, employee_id=row.employee_id,
            currency=row.currency, pay_frequency=row.pay_frequency, base_salary=row.base_salary,
            default_allowances=row.default_allowances or [], default_deductions=row.default_deductions or [],
            effective_from=row.effective_from, effective_to=row.effective_to, is_active=row.is_active,
        ) for row in profiles)
        config = PayrollPolicyConfig.model_validate(policy.configuration) if policy else None
        holidays = []
        if config and config.mode == "working_day":
            # Coverage/digest still use every currency below. Calendar anchors
            # and holiday horizons belong only to the native-currency slices paid.
            horizon_profiles = tuple(profile for profile in profile_inputs if profile.currency == currency.upper())
            start, end = payroll_reference_horizon(period.period_start, period.period_end, horizon_profiles, config, employees=employee_inputs)
            # No list-endpoint300-row cap; these are exact complete-cycle inputs.
            holidays = db.scalars(select(HRHoliday).where(
                HRHoliday.organization_id == org, HRHoliday.holiday_date >= start, HRHoliday.holiday_date <= end,
            ).order_by(HRHoliday.holiday_date, HRHoliday.id)).all()
        data = PayrollCalculationInput(
            organization_id=org, timezone=organization.timezone, period_id=period.id,
            period_start=period.period_start, period_end=period.period_end, currency=currency.upper(),
            policy=PayrollPolicySnapshot(id=policy.id, version=policy.version, effective_from=policy.effective_from, config=config) if policy else None,
            employees=employee_inputs,
            profiles=profile_inputs,
            holidays=tuple(PayrollHolidayInput(id=row.id, organization_id=row.organization_id,
                holiday_date=row.holiday_date, name=row.name, is_paid=row.is_paid) for row in holidays),
        )
    except ValidationError:
        # Do not echo complete employee/profile input values in a validation error.
        raise PayrollCalculationError([PayrollSetupIssue(code="INVALID_PAYROLL_INPUT", message="A saved payroll input is invalid; review company timezone, salary profiles and policy configuration")]) from None
    return calculate_payroll(data)


def snapshot_policy_context(run) -> dict | None:
    """Safe common context only, never the run-wide employee/profile inputs."""
    if not run.calculation_input_snapshot:
        return None
    source = json.loads(run.calculation_input_snapshot)
    return {"policy": source.get("policy"), "timezone": source.get("timezone"),
        "engine_version": run.calculation_engine_version, "calculation_hash": run.calculation_hash}
