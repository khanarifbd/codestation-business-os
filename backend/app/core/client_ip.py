from __future__ import annotations

from ipaddress import ip_address

from fastapi import Request

from app.core.config import settings


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


def request_client_ip(request: Request) -> str | None:
    """Resolve the browser/client IP across the trusted Business OS proxy chain.

    Production traffic enters through the host Nginx reverse proxy and then may
    pass through the Next.js BFF before reaching FastAPI. We prefer the
    X-Forwarded-For chain and walk it from the trusted edge side back toward the
    client, skipping private/internal hops such as Docker bridge addresses.

    The edge Nginx configuration overwrites X-Forwarded-For with its direct peer
    address, which prevents a browser-supplied forwarding header from becoming
    authoritative. The right-to-left scan also remains compatible while older
    deployed Nginx configurations are being upgraded.
    """

    forwarded = _forwarded_candidates(request.headers.get("x-forwarded-for"))
    for candidate in reversed(forwarded):
        if candidate.is_global:
            return str(candidate)

    real_ip = _parse_ip(request.headers.get("x-real-ip"))
    if real_ip is not None and real_ip.is_global:
        return str(real_ip)

    direct_ip = _parse_ip(request.client.host if request.client else None)
    if direct_ip is not None and direct_ip.is_global:
        return str(direct_ip)

    # Local development legitimately uses loopback/private addresses. In
    # staging/production, returning a Docker/private proxy address would mislead
    # users and weaken security telemetry, so omit it instead.
    if settings.environment.lower().strip() not in {"staging", "production"}:
        if forwarded:
            return str(forwarded[-1])
        if real_ip is not None:
            return str(real_ip)
        if direct_ip is not None:
            return str(direct_ip)

    return None
