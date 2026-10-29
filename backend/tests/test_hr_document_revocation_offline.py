"""Current-request HR document authorization after URL issuance.

Actual dependency/handler bodies and model queries on SQLite memory. Authentication
middleware, HTTP transport, real storage, and PostgreSQL concurrency are excluded.
"""
from contextlib import nullcontext
import ast
import mimetypes
from pathlib import Path
import re
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import Mock, patch

from fastapi import HTTPException, status
from sqlalchemy import and_, create_engine, select
from sqlalchemy.orm import Session
from starlette.responses import FileResponse

from app.models.membership import Membership
from app.models.organization import Organization
from app.models.team import Employee, OrganizationRole
from app.models.hr import EmployeeHRDocument
from app.tenancy.context import TenantContext
from test_hr_document_upload_commit_safety_offline import actual_function, FixtureCompiler


class HRDocumentRevocationTests(unittest.TestCase):
    def setUp(self):
        for name in ('connect', 'connect_ex'):
            self.enterContext(patch('socket.socket.' + name, side_effect=AssertionError('network forbidden')))
        for name in ('create_connection', 'getaddrinfo'):
            self.enterContext(patch('socket.' + name, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (Organization, OrganizationRole, Membership, Employee, EmployeeHRDocument):
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Organization.__table__.insert(), [
                dict(id='org', name='Synthetic Org', slug='synthetic', created_by_user_id='actor'),
                dict(id='foreign', name='Foreign Org', slug='foreign', created_by_user_id='foreign-user'),
            ])
            conn.execute(OrganizationRole.__table__.insert(), dict(
                id='role', organization_id='org', name='Synthetic HR', slug='synthetic-hr',
                permissions=['hr.manage', 'hr.self'], is_active=True))
            conn.execute(Membership.__table__.insert(), dict(
                id='member', organization_id='org', user_id='actor', role_id='role', status='active'))
            conn.execute(Employee.__table__.insert(), [
                dict(id='employee', organization_id='org', membership_id='member', employee_code='SYN1'),
                dict(id='other', organization_id='org', membership_id='other-member', employee_code='SYN2'),
                dict(id='foreign-employee', organization_id='foreign', membership_id='foreign-member', employee_code='SYN3'),
            ])
            conn.execute(EmployeeHRDocument.__table__.insert(), [
                dict(id='own-doc', organization_id='org', employee_id='employee', title='Synthetic', document_type='contract', storage_key='synthetic-own.pdf'),
                dict(id='other-doc', organization_id='org', employee_id='other', title='Synthetic', document_type='contract', storage_key='synthetic-other.pdf'),
                dict(id='foreign-doc', organization_id='foreign', employee_id='foreign-employee', title='Synthetic', document_type='contract', storage_key='synthetic-foreign.pdf'),
            ])
        self.storage = NS(resolve=Mock(return_value=Path('/synthetic/not-read.pdf')))
        values = dict(select=select, and_=and_, Membership=Membership, Organization=Organization,
                      OrganizationRole=OrganizationRole, TenantContext=TenantContext,
                      HTTPException=HTTPException, status=status, ORGANIZATION_STATUS_ACTIVE='active',
                      track_performance_phase=lambda *args: nullcontext(),
                      PERFORMANCE_PHASE_TENANT_RESOLUTION='tenant', PERFORMANCE_PHASE_PERMISSION='permission')
        for name in ('get_tenant_context', '_active_role', 'require_tenant_permission'):
            values[name] = actual_function('app/api/dependencies.py', name, values)
        self.resolve_tenant = values['get_tenant_context']
        self.permission = values['require_tenant_permission']
        values.update(Employee=Employee, EmployeeHRDocument=EmployeeHRDocument, storage=self.storage,
                      FileResponse=FileResponse, mimetypes=mimetypes, Path=Path, re=re)
        values['_filename'] = actual_function('app/api/v1/hr_uploads.py', '_filename', values)
        self.handlers = {name: actual_function('app/api/v1/hr_uploads.py', name, values)
                         for name in ('manager_file', 'self_file')}

    def request_file(self, document='own-doc', *, own=False, organization='org'):
        # Each authenticated request has a new Session, as the real dependency does.
        with Session(self.engine) as db:
            tenant = self.resolve_tenant(db, NS(id='actor'), organization)
            self.permission('hr.self' if own else 'hr.manage')(db, tenant)
            return self.handlers['self_file' if own else 'manager_file'](document, db, tenant)

    def change(self, model, row_id, **values):
        with self.engine.begin() as conn:
            conn.execute(model.__table__.update().where(model.id == row_id).values(**values))

    def assert_denied(self, code, **kwargs):
        self.storage.resolve.reset_mock()
        with self.assertRaises(HTTPException) as raised:
            self.request_file(**kwargs)
        self.assertEqual(raised.exception.status_code, code)
        self.storage.resolve.assert_not_called()

    def test_file_routes_remain_bound_to_current_permission_dependencies(self):
        source = Path(__file__).resolve().parents[1] / 'app/api/v1/hr_uploads.py'
        tree = ast.parse(source.read_text())
        aliases = {node.targets[0].id: ast.unparse(node.value) for node in tree.body
                   if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name)}
        for handler, alias, permission in [('manager_file', 'HRManager', 'hr.manage'),
                                            ('self_file', 'HRSelf', 'hr.self')]:
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == handler)
            tenant = next(arg for arg in node.args.args if arg.arg == 'tenant')
            self.assertEqual(ast.unparse(tenant.annotation), alias)
            self.assertIn(f"require_tenant_permission('{permission}')", aliases[alias])
            self.assertTrue(any(ast.unparse(d).startswith('router.get(') for d in node.decorator_list))

    def test_url_reuse_after_membership_revoked_denies_before_storage(self):
        self.assertIsInstance(self.request_file(), FileResponse)
        self.change(Membership, 'member', status='left')
        self.assert_denied(404)

    def test_url_reuse_after_role_permission_removed_denies_before_storage(self):
        self.request_file()
        self.change(OrganizationRole, 'role', permissions=['hr.self'])
        self.assert_denied(403)
        self.assertIsInstance(self.request_file(own=True), FileResponse)

    def test_url_reuse_after_role_disabled_denies(self):
        self.request_file()
        self.change(OrganizationRole, 'role', is_active=False)
        self.assert_denied(403)

    def test_url_reuse_after_company_suspended_denies(self):
        self.request_file()
        self.change(Organization, 'org', status='suspended')
        self.assert_denied(403)

    def test_foreign_document_id_denies_manager_and_self_before_storage(self):
        self.assert_denied(404, document='foreign-doc')
        self.assert_denied(404, document='foreign-doc', own=True)

    def test_foreign_tenant_header_cannot_reuse_original_membership(self):
        self.request_file()
        self.assert_denied(404, organization='foreign', document='foreign-doc')

    def test_self_url_reuse_after_document_reassigned_denies(self):
        self.request_file(own=True)
        self.change(EmployeeHRDocument, 'own-doc', employee_id='other')
        self.assert_denied(404, own=True)

    def test_self_other_employee_document_denied(self):
        self.assert_denied(404, own=True, document='other-doc')

    def test_self_url_reuse_after_employee_membership_reassigned_denies(self):
        self.request_file(own=True)
        self.change(Employee, 'employee', membership_id='reassigned-member')
        self.assert_denied(404, own=True)

    def test_missing_storage_key_after_link_creation_denies(self):
        self.request_file()
        self.change(EmployeeHRDocument, 'own-doc', storage_key=None)
        self.assert_denied(404)


if __name__ == '__main__':
    unittest.main()
