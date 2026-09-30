"""Backend-authoritative attendance mode and office geofence resolution."""
from datetime import date
from math import asin, cos, isfinite, radians, sin, sqrt

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.hr_attendance import EmployeeAttendancePolicy, HRAttendanceRequest, HROfficeLocation


MODES = {"office", "remote", "field", "off"}


def distance_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance; degrees must be validated before calling."""
    a = sin(radians(lat2 - lat1) / 2) ** 2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371000 * asin(min(1.0, sqrt(max(0.0, a))))


def validate_weekly_modes(modes: list[str]) -> None:
    if len(modes) != 7 or any(mode not in MODES for mode in modes):
        raise HTTPException(status_code=400, detail="Provide Monday–Sunday modes: office, remote, field or off")


def effective_attendance_mode(
    db: Session, *, organization_id: str, employee_id: str, work_date: date,
) -> tuple[str, EmployeeAttendancePolicy | None, HROfficeLocation | None]:
    """Return the schedule for a local work date, applying only approved day overrides.

    Unconfigured employees retain their pre-existing self-attendance behavior until
    HR assigns a policy; a configured office day can never silently fall back to remote.
    """
    policy = db.scalar(
        select(EmployeeAttendancePolicy).where(
            EmployeeAttendancePolicy.organization_id == organization_id,
            EmployeeAttendancePolicy.employee_id == employee_id,
        )
    )
    if policy is None:
        return "unconfigured", None, None
    modes = policy.weekly_modes or []
    if len(modes) != 7 or any(m not in MODES for m in modes):
        raise HTTPException(status_code=409, detail="Employee attendance policy needs HR correction")
    mode = modes[work_date.weekday()]
    override = db.scalar(
        select(HRAttendanceRequest).where(
            HRAttendanceRequest.organization_id == organization_id,
            HRAttendanceRequest.employee_id == employee_id,
            HRAttendanceRequest.work_date == work_date,
            HRAttendanceRequest.request_type == "mode",
            HRAttendanceRequest.status == "approved",
        ).limit(1)
    )
    if override is not None:
        mode = override.requested_mode or mode
    office = None
    if mode == "office":
        office = db.scalar(
            select(HROfficeLocation).where(
                HROfficeLocation.organization_id == organization_id,
                HROfficeLocation.id == policy.office_id,
                HROfficeLocation.is_active.is_(True),
            )
        )
        if office is None:
            raise HTTPException(status_code=409, detail="Assigned office is unavailable; contact HR")
    return mode, policy, office


def verify_office_location(
    office: HROfficeLocation, *, latitude: float | None, longitude: float | None,
    accuracy_meters: float | None,
) -> float:
    if (
        latitude is None or longitude is None or accuracy_meters is None
        or not all(isfinite(value) for value in (latitude, longitude, accuracy_meters))
        or not (-90 <= latitude <= 90 and -180 <= longitude <= 180)
        or accuracy_meters < 0
    ):
        raise HTTPException(status_code=400, detail="Accurate browser location is required for office check-in")
    if accuracy_meters > min(float(office.radius_meters), 100.0):
        raise HTTPException(status_code=422, detail="Location accuracy is too low. Enable precise location and try again")
    distance = distance_meters(latitude, longitude, office.latitude, office.longitude)
    if distance > office.radius_meters:
        raise HTTPException(status_code=403, detail="Outside your assigned office geofence")
    return distance
