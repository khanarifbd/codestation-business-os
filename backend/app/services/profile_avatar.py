from __future__ import annotations

import os
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, status

from app.core.config import settings

AVATAR_MAX_BYTES = 5 * 1024 * 1024
_CONTENT_TYPES = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def detect_avatar_content_type(data: bytes) -> str | None:
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


class LocalProfileAvatarStorage:
    """Private user-avatar storage backed by the existing persistent upload volume."""

    def __init__(self) -> None:
        self.root = Path(settings.local_storage_path).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def save(self, *, user_id: str, data: bytes, declared_content_type: str | None) -> tuple[str, str]:
        if not data:
            raise HTTPException(status_code=400, detail="Choose an image to upload")
        if len(data) > AVATAR_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Profile photo must be 5 MB or smaller",
            )

        detected = detect_avatar_content_type(data)
        if detected is None:
            raise HTTPException(
                status_code=400,
                detail="Profile photo must be a JPEG, PNG or WebP image",
            )
        if declared_content_type and declared_content_type not in _CONTENT_TYPES:
            raise HTTPException(
                status_code=400,
                detail="Profile photo must be a JPEG, PNG or WebP image",
            )
        if declared_content_type and declared_content_type != detected:
            raise HTTPException(status_code=400, detail="Profile photo content does not match its file type")

        relative = Path("users") / user_id / "avatar" / f"{uuid4().hex}{_CONTENT_TYPES[detected]}"
        destination = (self.root / relative).resolve()
        if self.root not in destination.parents:
            raise HTTPException(status_code=400, detail="Invalid profile photo storage path")

        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_suffix(destination.suffix + ".uploading")
        try:
            with temporary.open("wb") as output:
                output.write(data)
            os.replace(temporary, destination)
        except Exception:
            temporary.unlink(missing_ok=True)
            destination.unlink(missing_ok=True)
            raise
        return relative.as_posix(), detected

    def resolve(self, storage_key: str) -> Path:
        path = (self.root / storage_key).resolve()
        if self.root not in path.parents or not path.is_file():
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile photo not found")
        return path

    def delete(self, storage_key: str | None) -> None:
        if not storage_key:
            return
        path = (self.root / storage_key).resolve()
        if self.root not in path.parents:
            return
        path.unlink(missing_ok=True)


avatar_storage = LocalProfileAvatarStorage()
