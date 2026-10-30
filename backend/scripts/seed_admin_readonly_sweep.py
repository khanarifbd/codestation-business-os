"""Prepare a NEW isolated CI-only read-only sweep organization via normal services.
No credentials/roles are created here. Partial failures are fatal and never retried.
"""
from datetime import date
import json
import os
from pathlib import Path
from uuid import uuid4
from sqlalchemy import select
from starlette.requests import Request
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User
from app.api.dependencies import get_tenant_context
from app.api.v1.organizations import create_organization
from app.schemas.organization import OrganizationCreate
from app.services.accounting_integrity_audit import audit_organization_accounting
from scripts.seed_admin_readonly_financial import seed_financial, seed_remaining_financial
from scripts.admin_readonly_shared_contracts import shared_route_contracts


def require(condition, message):
    if not condition: raise RuntimeError(message)


def assert_target_before_creation(db):
    url = db.get_bind().url
    require(settings.environment == 'test' and os.environ.get('CI') == 'true'
            and os.environ.get('GITHUB_ACTIONS') == 'true'
            and os.environ.get('QC_BROWSER_FIXTURE') == '1', 'Explicit disposable CI target required')
    require(url.get_backend_name() == 'postgresql' and url.host in {'localhost', '127.0.0.1'}
            and url.port == 5432 and url.database == 'codestation_business_os', 'Exact loopback disposable database required')
    require(not settings.smtp_host.strip() and not settings.smtp_configured, 'Mail must stay disabled')
    require(bool(os.environ.get('E2E_EMAIL', '').strip()), 'Explicit existing owner email required')


def request_factory(method, path):
    return Request({'type': 'http', 'method': method, 'path': '/api/v1'+path,
                    'raw_path': ('/api/v1'+path).encode(), 'headers': [], 'query_string': b'',
                    'scheme': 'http', 'server': ('127.0.0.1', 8000), 'client': ('127.0.0.1', 50000)})


def merge_registry(registry, section):
    for name in ('route_overrides', 'route_contracts'):
        incoming = section.get(name, {})
        require(not (set(registry[name]) & set(incoming)), 'Duplicate fixture route ownership')
    for name in ('route_overrides', 'route_contracts'):
        registry[name].update(section.get(name, {}))
    return {key: value for key, value in section.items() if key not in ('route_overrides', 'route_contracts')}


def main():
    output = Path(os.environ.get('ADMIN_SWEEP_FIXTURE', ''))
    require(bool(os.environ.get('ADMIN_SWEEP_FIXTURE')), 'Explicit metadata output path required')
    require(not output.exists(), 'Existing sweep metadata must not be overwritten or replayed')
    db = SessionLocal()
    try:
        assert_target_before_creation(db)
        email = os.environ['E2E_EMAIL'].strip().lower()
        owner = db.scalar(select(User).where(User.email == email))
        require(owner is not None and owner.is_active and owner.is_verified and owner.password_hash,
                'Existing verified password fixture owner required; never create or reset credentials')
        output.parent.mkdir(parents=True, exist_ok=True)
        # Persistent attempt marker blocks blindly rerunning after partial fixture writes.
        marker = output.with_suffix(output.suffix + '.started')
        with marker.open('x') as stream: stream.write('Synthetic read-only fixture setup started; no automatic retry\n')
        name = 'Read-only admin sweep ' + uuid4().hex[:8]
        response = create_organization(OrganizationCreate(name=name, currency='USD', country_code='US', timezone='UTC'),
                                       request_factory('POST', '/organizations'), db, owner)
        tenant = get_tenant_context(db, owner, response.organization.id)
        today = date.today()
        registry = {'schema_version': 1, 'organization_id': tenant.organization_id,
                    'membership_id': tenant.membership_id, 'owner_email': email,
                    'fixture_date': str(today), 'currency': 'USD', 'route_overrides': {}, 'route_contracts': {}, 'sections': {}}
        financial = seed_financial(db, tenant, request_factory, today)
        registry['sections']['financial'] = merge_registry(registry, financial)
        # Dedicated family adapters are reviewed independently; imports occur only
        # after target verification and must not invent IDs when unavailable.
        from scripts.seed_admin_readonly_commercial import seed_commercial
        from scripts.seed_admin_readonly_hr import seed_hr
        commercial = seed_commercial(db, tenant, request_factory, today, shared_ids=registry['sections']['financial'])
        registry['sections']['commercial'] = merge_registry(registry, commercial)
        shared = {**registry['sections']['financial'], **registry['sections']['commercial'].get('typed_ids', {})}
        remaining = seed_remaining_financial(db, tenant, request_factory, today, shared_ids=shared)
        registry['sections']['remaining_financial'] = merge_registry(registry, remaining)
        shared.update(registry['sections']['remaining_financial'])
        hr = seed_hr(db, tenant, request_factory, today, shared_ids=shared)
        registry['sections']['hr'] = merge_registry(registry, hr)
        merge_registry(registry, {'route_contracts': shared_route_contracts(name, owner.full_name)})
        audit = audit_organization_accounting(db, tenant.organization_id)
        # Exact audit result contract is independently reviewed alongside fixture
        # helper; do not publish metadata for a failed accounting audit.
        require(audit.ok, 'Final synthetic accounting integrity audit failed')
        with output.open('x') as stream:
            os.chmod(output, 0o600)
            json.dump(registry, stream, indent=2)
        print(f'Read-only fixture ready: {len(registry["route_contracts"])} typed route contracts; no credentials in metadata')
    finally:
        db.close()


if __name__ == '__main__': main()
