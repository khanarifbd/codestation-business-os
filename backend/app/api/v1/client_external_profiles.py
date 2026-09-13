from __future__ import annotations

from typing import Annotated
from urllib.parse import urlparse

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError

from app.api.dependencies import DbSession, require_tenant_permission
from app.models.client_profiles import ClientExternalProfile
from app.models.crm import Client, LeadSource
from app.models.team import OrganizationRole
from app.services.activity_log import record_activity
from app.tenancy.context import TenantContext

router = APIRouter(prefix="/crm/clients", tags=["Client External Profiles"])
ClientProfileViewer = Annotated[TenantContext, Depends(require_tenant_permission("clients.view"))]
ClientProfileManager = Annotated[TenantContext, Depends(require_tenant_permission("clients.manage"))]


class ClientSourceOption(BaseModel):
    id: str
    name: str
    slug: str
    is_active: bool


class ClientExternalProfileCreate(BaseModel):
    platform: str = Field(min_length=1, max_length=64)
    profile_url: str = Field(min_length=3, max_length=500)
    username_handle: str | None = Field(default=None, max_length=160)
    label: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class ClientExternalProfileUpdate(BaseModel):
    platform: str | None = Field(default=None, min_length=1, max_length=64)
    profile_url: str | None = Field(default=None, min_length=3, max_length=500)
    username_handle: str | None = Field(default=None, max_length=160)
    label: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class ClientExternalProfileRead(BaseModel):
    id: str
    platform: str
    profile_url: str
    username_handle: str | None
    label: str | None
    notes: str | None
    created_at: str
    updated_at: str


class ClientProfilesOverview(BaseModel):
    client_id: str
    acquisition_source_id: str | None
    acquisition_source_name: str | None
    can_manage: bool
    sources: list[ClientSourceOption]
    profiles: list[ClientExternalProfileRead]


class ClientAcquisitionSourceUpdate(BaseModel):
    acquisition_source_id: str | None = None


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _client(db: DbSession, organization_id: str, client_id: str) -> Client:
    client = db.scalar(
        select(Client).where(
            Client.id == client_id,
            Client.organization_id == organization_id,
        )
    )
    if client is None:
        raise HTTPException(status_code=404, detail="Client not found")
    return client


def _can_manage(db: DbSession, tenant: TenantContext) -> bool:
    role = db.scalar(
        select(OrganizationRole).where(
            OrganizationRole.id == tenant.membership.role_id,
            OrganizationRole.organization_id == tenant.organization_id,
            OrganizationRole.is_active.is_(True),
        )
    )
    return bool(role and ("*" in (role.permissions or []) or "clients.manage" in (role.permissions or [])))


def _source(db: DbSession, organization_id: str, source_id: str | None) -> LeadSource | None:
    if source_id is None:
        return None
    source = db.scalar(
        select(LeadSource).where(
            LeadSource.id == source_id,
            LeadSource.organization_id == organization_id,
        )
    )
    if source is None:
        raise HTTPException(status_code=400, detail="Client source does not belong to this company")
    return source


def _normalize_platform(value: str) -> str:
    normalized = "_".join(value.strip().lower().split())
    if not normalized:
        raise HTTPException(status_code=400, detail="Platform is required")
    return normalized[:64]


def _normalize_url(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="Profile URL is required")
    if "://" not in normalized:
        normalized = f"https://{normalized}"
    parsed = urlparse(normalized)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise HTTPException(status_code=400, detail="Enter a valid http or https profile URL")
    if len(normalized) > 500:
        raise HTTPException(status_code=400, detail="Profile URL is too long")
    return normalized


def _read(profile: ClientExternalProfile) -> ClientExternalProfileRead:
    return ClientExternalProfileRead(
        id=profile.id,
        platform=profile.platform,
        profile_url=profile.profile_url,
        username_handle=profile.username_handle,
        label=profile.label,
        notes=profile.notes,
        created_at=profile.created_at.isoformat(),
        updated_at=profile.updated_at.isoformat(),
    )


@router.get("/{client_id}/external-profiles/overview", response_model=ClientProfilesOverview)
def get_client_profiles_overview(
    client_id: str,
    db: DbSession,
    tenant: ClientProfileViewer,
) -> ClientProfilesOverview:
    client = _client(db, tenant.organization_id, client_id)
    sources = db.scalars(
        select(LeadSource)
        .where(
            LeadSource.organization_id == tenant.organization_id,
            or_(
                LeadSource.is_active.is_(True),
                LeadSource.id == client.acquisition_source_id,
            ),
        )
        .order_by(LeadSource.sort_order.asc(), LeadSource.name.asc())
    ).all()
    source_name = None
    if client.acquisition_source_id:
        source_name = db.scalar(
            select(LeadSource.name).where(
                LeadSource.id == client.acquisition_source_id,
                LeadSource.organization_id == tenant.organization_id,
            )
        )
    profiles = db.scalars(
        select(ClientExternalProfile)
        .where(
            ClientExternalProfile.organization_id == tenant.organization_id,
            ClientExternalProfile.client_id == client.id,
        )
        .order_by(ClientExternalProfile.created_at.desc())
    ).all()
    return ClientProfilesOverview(
        client_id=client.id,
        acquisition_source_id=client.acquisition_source_id,
        acquisition_source_name=source_name,
        can_manage=_can_manage(db, tenant),
        sources=[
            ClientSourceOption(id=item.id, name=item.name, slug=item.slug, is_active=item.is_active)
            for item in sources
        ],
        profiles=[_read(item) for item in profiles],
    )


@router.patch("/{client_id}/acquisition-source", response_model=ClientProfilesOverview)
def update_client_acquisition_source(
    client_id: str,
    payload: ClientAcquisitionSourceUpdate,
    request: Request,
    db: DbSession,
    tenant: ClientProfileManager,
) -> ClientProfilesOverview:
    client = _client(db, tenant.organization_id, client_id)
    source = _source(db, tenant.organization_id, payload.acquisition_source_id)
    before_source_id = client.acquisition_source_id
    client.acquisition_source_id = source.id if source else None
    db.flush()
    record_activity(
        db,
        action="crm.client.acquisition_source.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client",
        entity_id=client.id,
        before={"acquisition_source_id": before_source_id},
        after={"acquisition_source_id": client.acquisition_source_id},
        message=f"Client acquisition source updated: {client.client_code}",
        request=request,
    )
    db.commit()
    return get_client_profiles_overview(client.id, db, tenant)


@router.post("/{client_id}/external-profiles", response_model=ClientExternalProfileRead, status_code=status.HTTP_201_CREATED)
def create_client_external_profile(
    client_id: str,
    payload: ClientExternalProfileCreate,
    request: Request,
    db: DbSession,
    tenant: ClientProfileManager,
) -> ClientExternalProfileRead:
    client = _client(db, tenant.organization_id, client_id)
    profile = ClientExternalProfile(
        organization_id=tenant.organization_id,
        client_id=client.id,
        platform=_normalize_platform(payload.platform),
        profile_url=_normalize_url(payload.profile_url),
        username_handle=_clean(payload.username_handle),
        label=_clean(payload.label),
        notes=_clean(payload.notes),
        created_by_user_id=tenant.user_id,
    )
    db.add(profile)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This external profile URL is already saved for the client") from exc
    record_activity(
        db,
        action="crm.client.external_profile.created",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_external_profile",
        entity_id=profile.id,
        after={
            "client_id": client.id,
            "platform": profile.platform,
            "profile_url": profile.profile_url,
            "username_handle": profile.username_handle,
        },
        message=f"External profile added to {client.client_code}",
        request=request,
    )
    db.commit()
    db.refresh(profile)
    return _read(profile)


@router.patch("/{client_id}/external-profiles/{profile_id}", response_model=ClientExternalProfileRead)
def update_client_external_profile(
    client_id: str,
    profile_id: str,
    payload: ClientExternalProfileUpdate,
    request: Request,
    db: DbSession,
    tenant: ClientProfileManager,
) -> ClientExternalProfileRead:
    client = _client(db, tenant.organization_id, client_id)
    profile = db.scalar(
        select(ClientExternalProfile).where(
            ClientExternalProfile.id == profile_id,
            ClientExternalProfile.organization_id == tenant.organization_id,
            ClientExternalProfile.client_id == client.id,
        )
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="External profile not found")
    before = {
        "platform": profile.platform,
        "profile_url": profile.profile_url,
        "username_handle": profile.username_handle,
        "label": profile.label,
    }
    changes = payload.model_dump(exclude_unset=True)
    if "platform" in changes:
        platform = changes.pop("platform")
        if platform is None:
            raise HTTPException(status_code=400, detail="Platform cannot be cleared")
        profile.platform = _normalize_platform(platform)
    if "profile_url" in changes:
        profile_url = changes.pop("profile_url")
        if profile_url is None:
            raise HTTPException(status_code=400, detail="Profile URL cannot be cleared")
        profile.profile_url = _normalize_url(profile_url)
    for field, value in changes.items():
        setattr(profile, field, _clean(value) if isinstance(value, str) or value is None else value)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="This external profile URL is already saved for the client") from exc
    record_activity(
        db,
        action="crm.client.external_profile.updated",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_external_profile",
        entity_id=profile.id,
        before=before,
        after={
            "platform": profile.platform,
            "profile_url": profile.profile_url,
            "username_handle": profile.username_handle,
            "label": profile.label,
        },
        message=f"External profile updated for {client.client_code}",
        request=request,
    )
    db.commit()
    db.refresh(profile)
    return _read(profile)


@router.delete("/{client_id}/external-profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_client_external_profile(
    client_id: str,
    profile_id: str,
    request: Request,
    db: DbSession,
    tenant: ClientProfileManager,
) -> None:
    client = _client(db, tenant.organization_id, client_id)
    profile = db.scalar(
        select(ClientExternalProfile).where(
            ClientExternalProfile.id == profile_id,
            ClientExternalProfile.organization_id == tenant.organization_id,
            ClientExternalProfile.client_id == client.id,
        )
    )
    if profile is None:
        raise HTTPException(status_code=404, detail="External profile not found")
    before = {
        "client_id": client.id,
        "platform": profile.platform,
        "profile_url": profile.profile_url,
        "username_handle": profile.username_handle,
    }
    db.delete(profile)
    record_activity(
        db,
        action="crm.client.external_profile.deleted",
        scope="tenant",
        actor_user_id=tenant.user_id,
        organization_id=tenant.organization_id,
        entity_type="client_external_profile",
        entity_id=profile.id,
        before=before,
        after=None,
        message=f"External profile removed from {client.client_code}",
        request=request,
    )
    db.commit()
