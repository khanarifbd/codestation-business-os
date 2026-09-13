from __future__ import annotations

import re

USERNAME_MIN_LENGTH = 3
USERNAME_MAX_LENGTH = 32
USERNAME_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$")


def normalize_username(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().lower()
    return normalized or None


def validate_username(value: str | None) -> str | None:
    username = normalize_username(value)
    if username is None:
        return None
    if not USERNAME_MIN_LENGTH <= len(username) <= USERNAME_MAX_LENGTH:
        raise ValueError(
            f"Username must be between {USERNAME_MIN_LENGTH} and {USERNAME_MAX_LENGTH} characters"
        )
    if not USERNAME_PATTERN.fullmatch(username):
        raise ValueError(
            "Username can contain lowercase letters, numbers, dots, underscores and hyphens, "
            "and must start and end with a letter or number"
        )
    return username


def normalize_login_identifier(value: str) -> tuple[str, str]:
    identifier = value.strip().lower()
    if identifier.startswith("@") and identifier.count("@") == 1:
        return "username", identifier[1:]
    if "@" in identifier:
        return "email", identifier
    return "username", identifier
