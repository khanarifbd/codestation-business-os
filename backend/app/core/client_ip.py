from __future__ import annotations

from ipaddress import ip_address

from fastapi import Request

from app.core.config import settings

_TRUSTED_CLIENT_IP_HEADER = "x-business-os-client-ip"


def _parse_ip(value: str | None):
    candidate = (value or "").strip()
    if not candidate:
        return None
    if candidate.startswith("[") and "]" in candidate:
        candidate = candidate[1:candidate.index("]")]
    try:
        return ip_address(candidate)
    except ValueError:
        return None


def _forwarded_candidates(value: str | None):
    return [parsed for item in (value or "").split(",") if (parsed := _parse_ip(item)) is not None]


def _is_external_client_ip(candidate) -> bool:
    """Return true for an address that may represent the user's network edge.

    RFC1918/private, loopback, link-local, multicast and unspecified addresses
    are internal infrastructure values and must never be presented as a user's
    public/security IP. Shared-address/CGNAT space is allowed because some ISPs
    legitimately expose it at an upstream trusted proxy even though Python does
    not classify it as globally routable.
    """

    return bool(
        candidate is not None
        and not candidate.is_private
        and not candidate.is_loopback
        and not candidate.is_link_local
        and not candidate.is_multicast
        and not candidate.is_unspecified
    )


def displayable_client_ip(value: str | None) -> str | None:
    parsed = _parse_ip(value)
    return str(parsed) if _is_external_client_ip(parsed) else None


def request_client_ip(request: Request) -> str | None:
    """Resolve the browser/client IP across the trusted Business OS proxy chain.

    The public Nginx ingress overwrites X-Business-OS-Client-IP with its direct
    peer address. Next.js forwards that header to FastAPI, so it is the primary
    source for BFF traffic and cannot be chosen by the browser. X-Forwarded-For
    and X-Real-IP remain compatibility fallbacks while older live Nginx configs
    are upgraded.
    """

    trusted_edge_ip = _parse_ip(request.headers.get(_TRUSTED_CLIENT_IP_HEADER))
    if _is_external_client_ip(trusted_edge_ip):
        return str(trusted_edge_ip)

    forwarded = _forwarded_candidates(request.headers.get("x-forwarded-for"))
    for candidate in reversed(forwarded):
        if _is_external_client_ip(candidate):
            return str(candidate)

    real_ip = _parse_ip(request.headers.get("x-real-ip"))
    if _is_external_client_ip(real_ip):
        return str(real_ip)

    direct_ip = _parse_ip(request.client.host if request.client else None)
    if _is_external_client_ip(direct_ip):
        return str(direct_ip)

    # Local development legitimately uses loopback/private addresses. In
    # staging/production, returning a Docker/private proxy address would mislead
    # users and weaken security telemetry, so omit it instead.
    if settings.environment.lower().strip() not in {"staging", "production"}:
        if trusted_edge_ip is not None:
            return str(trusted_edge_ip)
        if forwarded:
            return str(forwarded[-1])
        if real_ip is not None:
            return str(real_ip)
        if direct_ip is not None:
            return str(direct_ip)

    return None
