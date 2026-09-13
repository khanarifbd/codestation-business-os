from datetime import datetime, timezone
from types import SimpleNamespace

from app.services.functional_currency import organization_local_date


def main() -> None:
    dhaka = SimpleNamespace(timezone="Asia/Dhaka")
    dhaka_boundary = datetime(2026, 8, 17, 21, 30, tzinfo=timezone.utc)
    if organization_local_date(dhaka, dhaka_boundary).isoformat() != "2026-08-18":
        raise AssertionError("Asia/Dhaka business date did not advance across the UTC date boundary")

    new_york = SimpleNamespace(timezone="America/New_York")
    new_york_boundary = datetime(2026, 8, 18, 0, 30, tzinfo=timezone.utc)
    if organization_local_date(new_york, new_york_boundary).isoformat() != "2026-08-17":
        raise AssertionError("America/New_York business date incorrectly followed the UTC server date")

    print("organization-local currency business date verification passed")


if __name__ == "__main__":
    main()
