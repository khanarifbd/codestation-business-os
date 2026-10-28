"""Pure, versioned payroll math. No database, clock, network or attendance side effects.

Resolvers provide the explicit salary-enrolled candidate roster, all profile currencies,
plus holidays covering complete reference cycles. This module never infers that an
employee with missing salary coverage should disappear from automatic payroll.
"""
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
from fractions import Fraction
import hashlib
import json

from app.schemas.payroll_policy import (
    PayrollCalculatedComponent, PayrollCalculatedEntry, PayrollCalculationInput,
    PayrollCalculationResult, PayrollEmployeeInput, PayrollPolicyConfig, PayrollSalaryProfileInput,
    PayrollSetupIssue,
)

ENGINE_VERSION = "payroll-policy-v1"
LEGACY_ENGINE_VERSION = "payroll-legacy-v0"
MONEY = Decimal("0.01")
ZERO = Decimal("0.00")
DAY = timedelta(days=1)
# Technical response/computation capacity, never a truncated financial date range.
MAX_BREAKDOWN_SLICES = 20_000


class PayrollCalculationError(ValueError):
    def __init__(self, issues: tuple[PayrollSetupIssue, ...] | list[PayrollSetupIssue]):
        self.issues = tuple(issues)
        super().__init__("; ".join(issue.message for issue in self.issues))

    @property
    def code(self) -> str:
        return self.issues[0].code


def _issue(code, message, employee_id=None, profile_ids=()):
    return PayrollSetupIssue(code=code, message=message, employee_id=employee_id, profile_ids=tuple(profile_ids))


def _fail(code, message, employee_id=None, profile_ids=()):
    raise PayrollCalculationError([_issue(code, message, employee_id, profile_ids)])


def _money(value: Decimal | Fraction) -> Decimal:
    if isinstance(value, Fraction):
        # Exact HALF_UP at the cent boundary. A finite Decimal approximation of
        # 1/26 can otherwise turn an exact half-cent into a value just below it.
        cents, remainder = divmod(abs(value.numerator) * 100, value.denominator)
        cents += int(remainder * 2 >= value.denominator)
        rounded = Decimal(-cents if value < 0 else cents).scaleb(-2)
    else:
        rounded = value.quantize(MONEY, rounding=ROUND_HALF_UP)
    if abs(rounded) >= Decimal("10000000000000000"):
        _fail("MONEY_OUT_OF_RANGE", "Calculated money exceeds the existing Numeric(18, 2) storage range")
    return ZERO if rounded == 0 else rounded


def _fraction_snapshot(value: Fraction) -> dict:
    return {"numerator": str(value.numerator), "denominator": str(value.denominator)}


def _repeating_fraction(value: Fraction) -> bool:
    denominator = value.denominator
    for divisor in (2, 5):
        while denominator % divisor == 0:
            denominator //= divisor
    return denominator != 1


def _decimal_preview(value: Fraction) -> str:
    # Display only; exact numerator/denominator is snapshotted alongside this.
    return format(Decimal(value.numerator) / Decimal(value.denominator), "f")


def _json(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)


def reference_cycle_bounds(day: date, frequency: str, config: PayrollPolicyConfig) -> tuple[date, date]:
    """Complete denominator cycle, even when outside the requested payroll period."""
    if frequency == "monthly":
        return day.replace(day=1), day.replace(day=monthrange(day.year, day.month)[1])
    anchor = config.weekly_anchor if frequency == "weekly" else config.biweekly_anchor
    if frequency not in {"weekly", "biweekly"}:
        _fail("UNSUPPORTED_FREQUENCY", "Unsupported salary frequency")
    if anchor is None:
        _fail("MISSING_CYCLE_ANCHOR", f"Configure an explicit {frequency} payroll-cycle anchor")
    length = 7 if frequency == "weekly" else 14
    try:
        start = anchor + timedelta(days=((day - anchor).days // length) * length)
        return start, start + timedelta(days=length - 1)
    except OverflowError:
        _fail("CYCLE_DATE_OUT_OF_RANGE", "Reference cycle extends beyond supported calendar dates")


def payroll_reference_horizon(period_start: date, period_end: date, profiles: tuple[PayrollSalaryProfileInput, ...], config: PayrollPolicyConfig, *, employees: tuple[PayrollEmployeeInput, ...] | None = None) -> tuple[date, date]:
    """Resolver helper: fetch holidays for this entire horizon, never period-only."""
    if period_end < period_start:
        _fail("INVALID_PERIOD", "Period end cannot precede period start")
    if config.mode != "working_day":
        return period_start, period_end
    starts, ends = [period_start], [period_end]
    roster = {employee.id: employee for employee in employees} if employees is not None else None
    for profile in profiles:
        start, end = max(period_start, profile.effective_from), min(period_end, profile.effective_to or period_end)
        if roster is not None:
            employee = roster.get(profile.employee_id)
            if employee is None:
                _fail("UNKNOWN_EMPLOYEE", "Every salary profile must belong to an explicit candidate employee")
            # Only known bounds clip the horizon. Ambiguous bounds still fail in
            # calculate_payroll; they are never inferred from status or attendance.
            if employee.join_date is not None:
                start = max(start, employee.join_date)
            if employee.end_date is not None:
                end = min(end, employee.end_date)
        if start <= end:
            starts.append(reference_cycle_bounds(start, profile.pay_frequency, config)[0])
            ends.append(reference_cycle_bounds(end, profile.pay_frequency, config)[1])
    return min(starts), max(ends)


def _units(start: date, end: date, config: PayrollPolicyConfig, holiday_dates: frozenset[date]) -> int:
    if end < start:
        return 0
    days = (end - start).days + 1
    if config.mode != "working_day":
        return days
    weekdays = frozenset(config.working_weekdays or ())
    weeks, remainder = divmod(days, 7)
    count = weeks * len(weekdays) + sum((start.weekday() + offset) % 7 in weekdays for offset in range(remainder))
    if config.holiday_treatment == "exclude":
        count -= sum(start <= day <= end and day.weekday() in weekdays for day in holiday_dates)
    return count


def _validate_identity(data: PayrollCalculationInput):
    employees = {employee.id: employee for employee in data.employees}
    if len(employees) != len(data.employees):
        _fail("DUPLICATE_EMPLOYEE", "Candidate employee IDs must be unique")
    if len({profile.id for profile in data.profiles}) != len(data.profiles):
        _fail("DUPLICATE_PROFILE", "Salary profile IDs must be unique")
    if any(item.organization_id != data.organization_id for item in (*data.employees, *data.profiles, *data.holidays)):
        _fail("TENANT_MISMATCH", "Calculation inputs must belong to the selected company")
    if any(profile.employee_id not in employees for profile in data.profiles):
        _fail("UNKNOWN_EMPLOYEE", "Every salary profile must belong to an explicit candidate employee")
    if data.policy and data.policy.effective_from > data.period_start:
        _fail("POLICY_NOT_EFFECTIVE", "This policy does not apply at the payroll period start")
    return employees


def _canonical_input(data: PayrollCalculationInput):
    value = data.model_dump(mode="json")
    for key in ("employees", "profiles", "holidays"):
        value[key] = sorted(value[key], key=lambda row: row["id"])
    # Derived audit field, alongside authoritative rows; not a write-request DTO.
    value["holiday_dates"] = sorted({str(row.holiday_date) for row in data.holidays})
    return value


def _component_lines(profile, field):
    return tuple(PayrollCalculatedComponent(name=item.name, amount=_money(item.amount), source_profile_id=profile.id, source_component_index=index) for index, item in enumerate(getattr(profile, field)))


def _entry(employee_id, currency, representative, profile_ids, base, allowances, deductions, snapshot):
    allowance_total = _money(sum((item.amount for item in allowances), ZERO))
    deduction_total = _money(sum((item.amount for item in deductions), ZERO))
    gross = _money(base + allowance_total)
    net = _money(gross - deduction_total)
    if net < 0:
        _fail("NEGATIVE_NET", "Payroll entry cannot have negative net pay", employee_id, profile_ids)
    totals = {"base_salary": str(base), "allowance_total": str(allowance_total), "deduction_total": str(deduction_total), "tax_amount": "0.00", "gross_pay": str(gross), "net_pay": str(net)}
    snapshot = {**snapshot, "snapshot_version": 1, "rounding": {"quantum": "0.01", "mode": "ROUND_HALF_UP", "base": "sum_slices_then_round", "components": "sum_source_component_slices_then_round"}, "totals": totals, "allowances": [item.model_dump(mode="json") for item in allowances], "deductions": [item.model_dump(mode="json") for item in deductions]}
    return PayrollCalculatedEntry(employee_id=employee_id, salary_profile_id=representative.id, profile_ids=tuple(profile_ids), currency=currency, base_salary=base, allowances=allowances, deductions=deductions, allowance_total=allowance_total, deduction_total=deduction_total, gross_pay=gross, net_pay=net, calculation_snapshot_json=_json(snapshot))


def _manual_entries(data):
    # Deliberately currency-first, latest-overlap, active OR historically closed:
    # this is the original create_run selection, not automatic eligibility rules.
    profiles = [profile for profile in data.profiles if profile.currency == data.currency and profile.effective_from <= data.period_end and (profile.effective_to is None or profile.effective_to >= data.period_start) and (profile.is_active or profile.effective_to is not None)]
    entries, seen = [], set()
    for profile in sorted(profiles, key=lambda row: row.effective_from, reverse=True):
        if profile.employee_id in seen:
            continue
        seen.add(profile.employee_id)
        entries.append(_entry(profile.employee_id, data.currency, profile, [profile.id], _money(profile.base_salary), _component_lines(profile, "default_allowances"), _component_lines(profile, "default_deductions"), {"method": "manual_latest_overlapping_profile", "profile": profile.model_dump(mode="json"), "automatic_proration": False}))
    return entries


def _coverage(data, employee, profiles):
    issues = []
    # Known bounds can prove no overlap without inventing a missing opposite bound.
    if employee.end_date is not None and employee.end_date < data.period_start or employee.join_date is not None and employee.join_date > data.period_end:
        return [], []
    if employee.join_date is None:
        return [], [_issue("EMPLOYMENT_START_REQUIRED", "Automatic payroll requires a known employment start date", employee.id)]
    if employee.employment_status != "active" and employee.end_date is None:
        return [], [_issue("EMPLOYMENT_END_REQUIRED", "A non-active employee requires a known historical employment end date", employee.id)]
    if employee.end_date and employee.end_date < employee.join_date:
        return [], [_issue("INVALID_EMPLOYMENT_RANGE", "Employment end cannot precede employment start", employee.id)]
    start, end = max(data.period_start, employee.join_date), min(data.period_end, employee.end_date or data.period_end)
    if end < start:
        return [], []
    segments = []
    for profile in profiles:
        if profile.effective_from > end or profile.effective_to is not None and profile.effective_to < start:
            continue
        if profile.effective_to is not None and profile.effective_to < profile.effective_from:
            issues.append(_issue("INVALID_PROFILE_RANGE", "Salary profile end precedes its start", employee.id, [profile.id]))
            continue
        if not profile.is_active and profile.effective_to is None:
            issues.append(_issue("INACTIVE_OPEN_PROFILE", "An inactive open-ended salary profile needs an explicit valid historical bound", employee.id, [profile.id]))
            continue
        segments.append((max(start, profile.effective_from), min(end, profile.effective_to or end), profile))
    segments.sort(key=lambda segment: (segment[0], segment[1], segment[2].id))
    cursor = start
    last_profile = None
    for left, right, profile in segments:
        if cursor is None:
            issues.append(_issue("PROFILE_OVERLAP", "Salary profiles overlap inside the employment/payroll interval", employee.id, [last_profile, profile.id]))
        elif left > cursor:
            issues.append(_issue("PROFILE_GAP", f"Salary coverage missing from {cursor} through {left - DAY}", employee.id))
        elif left < cursor:
            issues.append(_issue("PROFILE_OVERLAP", "Salary profiles overlap inside the employment/payroll interval", employee.id, [last_profile, profile.id]))
        next_cursor = None if right == date.max else right + DAY
        if cursor is not None and (next_cursor is None or next_cursor > cursor):
            cursor = next_cursor
        last_profile = profile.id
    if cursor is not None and cursor <= end:
        issues.append(_issue("PROFILE_GAP", f"Salary coverage missing from {cursor} through {end}", employee.id))
    return segments, issues


def _check_computation_budget(coverages, currency, config):
    total = 0
    for employee_id, segments in coverages.items():
        for left, right, profile in segments:
            if profile.currency != currency:
                continue
            if profile.pay_frequency == "monthly":
                count = (right.year - left.year) * 12 + right.month - left.month + 1
            else:
                try:
                    first = reference_cycle_bounds(left, profile.pay_frequency, config)[0]
                    last = reference_cycle_bounds(right, profile.pay_frequency, config)[0]
                except PayrollCalculationError as error:
                    raise PayrollCalculationError([issue.model_copy(update={"employee_id": employee_id, "profile_ids": (profile.id,)}) for issue in error.issues]) from error
                count = (last - first).days // (7 if profile.pay_frequency == "weekly" else 14) + 1
            total += count
            if total > MAX_BREAKDOWN_SLICES:
                _fail("CALCULATION_LIMIT_EXCEEDED", f"This calculation exceeds the technical limit of {MAX_BREAKDOWN_SLICES:,} breakdown slices. No payroll amounts have been returned; use a smaller supported calculation or contact support")


def _automatic_entry(data, employee, segments, config, holidays):
    selected = [(left, right, profile) for left, right, profile in segments if profile.currency == data.currency]
    if not selected:
        return None
    representative = max(selected, key=lambda row: (row[2].effective_from, row[2].id))[2]
    factors, slices = {}, []
    base = Fraction(0)
    for left, right, profile in selected:
        current = left
        while current <= right:
            try:
                cycle_start, cycle_end = reference_cycle_bounds(current, profile.pay_frequency, config)
            except PayrollCalculationError as error:
                raise PayrollCalculationError([issue.model_copy(update={"employee_id": employee.id, "profile_ids": (profile.id,)}) for issue in error.issues]) from error
            stop = min(right, cycle_end)
            denominator = _units(cycle_start, cycle_end, config, holidays)
            if denominator == 0:
                _fail("ZERO_DENOMINATOR", "The complete reference cycle contains no configured payroll working days", employee.id, [profile.id])
            numerator = _units(current, stop, config, holidays)
            fraction = Fraction(numerator, denominator)
            amount = Fraction(profile.base_salary) * fraction
            base += amount
            factors[profile.id] = factors.get(profile.id, Fraction(0)) + fraction
            slices.append({"profile_id": profile.id, "currency": profile.currency, "pay_frequency": profile.pay_frequency, "cycle_start": str(cycle_start), "cycle_end": str(cycle_end), "eligible_start": str(current), "eligible_end": str(stop), "numerator": numerator, "denominator": denominator, "cycle_base_salary": str(profile.base_salary), "unrounded_base": _decimal_preview(amount), "unrounded_base_fraction": _fraction_snapshot(amount), "unrounded_base_is_approximation": _repeating_fraction(amount)})
            if stop == right:
                break
            current = stop + DAY
    profiles = {profile.id: profile for _, _, profile in selected}

    component_calculations = []

    def components(field, treatment):
        sources = [representative] if treatment == "fixed_latest" else sorted(profiles.values(), key=lambda row: (row.effective_from, row.id))
        lines = []
        for profile in sources:
            factor = Fraction(1) if treatment == "fixed_latest" else factors[profile.id]
            for index, item in enumerate(getattr(profile, field)):
                exact = Fraction(item.amount) * factor
                amount = _money(exact)
                lines.append(PayrollCalculatedComponent(name=item.name, amount=amount, source_profile_id=profile.id, source_component_index=index))
                component_calculations.append({"category": field, "source_profile_id": profile.id, "source_component_index": index, "name": item.name, "treatment": treatment, "unrounded_amount_fraction": _fraction_snapshot(exact), "unrounded_amount_display": _decimal_preview(exact), "display_is_approximation": _repeating_fraction(exact), "rounded_amount": str(amount)})
        return tuple(lines)

    allowances = components("default_allowances", config.allowance_treatment)
    deductions = components("default_deductions", config.deduction_treatment)
    snapshot = {"method": config.mode, "employee": employee.model_dump(mode="json"), "policy": data.policy.model_dump(mode="json"), "timezone": data.timezone, "profiles": [profile.model_dump(mode="json") for profile in sorted(profiles.values(), key=lambda row: row.id)], "holiday_dates": sorted(str(day) for day in holidays), "slices": slices, "unrounded_base_total": _decimal_preview(base), "unrounded_base_total_fraction": _fraction_snapshot(base), "unrounded_base_total_is_approximation": _repeating_fraction(base), "display_decimal_precision": 50, "component_calculations": component_calculations, "proration_intermediate": "exact_rational_from_decimal_inputs", "allowance_treatment": config.allowance_treatment, "deduction_treatment": config.deduction_treatment}
    return _entry(employee.id, data.currency, representative, sorted(profiles), _money(base), allowances, deductions, snapshot)


def calculate_payroll(data: PayrollCalculationInput) -> PayrollCalculationResult:
    """Calculate only. Caller owns authorization, roster resolution and persistence."""
    employees = _validate_identity(data)
    config = data.policy.config if data.policy else PayrollPolicyConfig()
    with localcontext() as context:
        context.prec = 50
        if config.mode == "manual":
            entries = _manual_entries(data)
        else:
            coverages, issues = {}, []
            profiles_by_employee = {employee_id: [] for employee_id in employees}
            for profile in data.profiles:
                profiles_by_employee[profile.employee_id].append(profile)
            for employee in sorted(employees.values(), key=lambda row: row.id):
                coverages[employee.id], failures = _coverage(data, employee, profiles_by_employee[employee.id])
                issues.extend(failures)
            if issues:
                raise PayrollCalculationError(issues)
            _check_computation_budget(coverages, data.currency, config)
            holidays = frozenset(row.holiday_date for row in data.holidays)
            entries = []
            for employee in sorted(employees.values(), key=lambda row: row.id):
                try:
                    entry = _automatic_entry(data, employee, coverages[employee.id], config, holidays)
                    if entry is not None:
                        entries.append(entry)
                except PayrollCalculationError as error:
                    issues.extend(error.issues)
            if issues:
                raise PayrollCalculationError(issues)
        if not entries:
            _fail("NO_ELIGIBLE_PROFILES", f"No eligible salary profiles found for {data.currency} in this period")
        entries.sort(key=lambda row: row.employee_id)
        totals = {name: _money(sum((getattr(entry, field) for entry in entries), ZERO)) for name, field in (("gross_total", "gross_pay"), ("allowance_total", "allowance_total"), ("deduction_total", "deduction_total"), ("tax_total", "tax_amount"), ("net_total", "net_pay"))}
        engine = ENGINE_VERSION if data.policy else LEGACY_ENGINE_VERSION
        input_json = _json(_canonical_input(data))
        output_json = _json({"engine_version": engine, "policy_id": data.policy.id if data.policy else None, "policy_version": data.policy.version if data.policy else 0, "mode": config.mode, "currency": data.currency, "entries": [entry.model_dump(mode="json") for entry in entries], "employee_count": len(entries), **{name: str(value) for name, value in totals.items()}})
        digest = hashlib.sha256((engine + "\n" + input_json + "\n" + output_json).encode("utf-8")).hexdigest()
        return PayrollCalculationResult(engine_version=engine, policy_id=data.policy.id if data.policy else None, policy_version=data.policy.version if data.policy else 0, mode=config.mode, currency=data.currency, entries=tuple(entries), employee_count=len(entries), **totals, calculation_hash=digest, input_snapshot_json=input_json, output_snapshot_json=output_json)
