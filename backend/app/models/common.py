from datetime import datetime, timezone
from uuid import uuid4


def new_uuid() -> str:
    return str(uuid4())


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
