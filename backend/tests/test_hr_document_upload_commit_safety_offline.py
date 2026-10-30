"""Actual HR upload handler fault injection; SQLite memory and synthetic byte storage.

Loads exact route/audit/guard bodies without importing configured engines or real
storage. SQLite does not prove PostgreSQL durability, locks or provider behavior.
"""
import ast
import copy
import hashlib
import io
from collections.abc import Mapping, Sequence
from contextlib import suppress
from datetime import date
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

from fastapi import HTTPException
from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.hr import EmployeeHRDocument
from app.models.team import Employee

ROOT = Path(__file__).resolve().parents[1]
KEY = 'organizations/synthetic-org/company-documents/synthetic-document.pdf'
CONTENT = b'SYNTHETIC HR DOCUMENT BOUNDARY TEST; NOT A REAL RECEIPT OR FILE'


def actual_function(relative, name, context):
    source = ROOT / relative
    node = copy.deepcopy(next(item for item in ast.parse(source.read_text()).body
                             if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == name))
    node.decorator_list = []
    node.args.defaults = [ast.Constant(value=None) for _ in node.args.defaults]
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    namespace = dict(context)
    exec(compile(ast.fix_missing_locations(module), str(source), 'exec'), namespace)
    return namespace[name]


def actual_audit():
    tree = ast.parse((ROOT / 'app/services/activity_log.py').read_text())
    sensitive = next(ast.literal_eval(item.value) for item in tree.body if isinstance(item, ast.Assign)
                     and any(isinstance(n, ast.Name) and n.id == 'SENSITIVE_KEYS' for n in item.targets))
    context = {'Mapping': Mapping, 'Sequence': Sequence, 'ActivityLog': ActivityLog, 'SENSITIVE_KEYS': sensitive}
    for name in ('_is_sensitive_key', 'sanitize_for_audit', '_request_fields', 'record_activity'):
        context[name] = actual_function('app/services/activity_log.py', name, context)
    return context['record_activity']


def audit_guards():
    context = {'Session': Session}
    for name in ('_is_activity_log', '_has_business_mutation', '_remember_audit_coverage',
                 '_require_audit_for_commit', '_clear_audit_state'):
        context[name] = actual_function('app/db/session.py', name, context)
    return context


class FixtureCompiler(SQLiteTypeCompiler):
    def visit_JSONB(self, _type, **_kwargs):
        return 'JSON'


class InjectedError(RuntimeError):
    pass


class FaultSession(Session):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.failure = None
        self.rollback_failure = False
        self.commits = self.rollbacks = self.refreshes = 0
        self.events = []
        self.committed = False

    def add(self, instance, *args, **kwargs):
        result = super().add(instance, *args, **kwargs)
        if self.failure == 'add' and isinstance(instance, EmployeeHRDocument):
            raise InjectedError('document add failed')
        return result

    def flush(self, *args, **kwargs):
        result = super().flush(*args, **kwargs)
        if self.failure == 'flush':
            raise InjectedError('precommit flush failed')
        return result

    def commit(self):
        self.commits += 1
        self.events.append('commit-attempt')
        if self.failure == 'commit-before':
            raise InjectedError('commit outcome uncertain')
        result = super().commit()
        self.committed = True
        self.events.append('commit-acknowledged')
        if self.failure == 'commit-after':
            raise InjectedError('commit outcome uncertain')
        if self.failure == 'response-readback':
            self.expire_all()
        return result

    def rollback(self):
        self.rollbacks += 1
        if self.rollback_failure:
            raise InjectedError('rollback also failed')
        return super().rollback()

    def _execute_internal(self, statement, *args, **kwargs):
        if self.committed and self.failure == 'response-readback' and getattr(statement, 'is_select', False):
            raise InjectedError('postcommit response readback failed')
        return super()._execute_internal(statement, *args, **kwargs)

    def refresh(self, *args, **kwargs):
        self.refreshes += 1
        return super().refresh(*args, **kwargs)


class MemoryStorage:
    def __init__(self, events):
        self.objects = {}
        self.saved = []
        self.deleted = []
        self.events = events
        self.failure = None
        self.fail_delete = False

    def save(self, **kwargs):
        self.saved.append({key: value for key, value in kwargs.items() if key != 'source'})
        self.events.append('storage-attempt')
        if self.failure:
            raise self.failure
        data = kwargs['source'].read()
        self.objects[KEY] = data
        self.events.append('storage-saved')
        return KEY, len(data)

    def delete(self, key):
        self.deleted.append(key)
        self.events.append('storage-delete')
        if self.fail_delete:
            raise OSError('synthetic cleanup failed')
        self.objects.pop(key, None)


class HRDocumentUploadCommitSafetyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for table in (Employee.__table__, EmployeeHRDocument.__table__, ActivityLog.__table__):
            table.create(self.engine)
        with self.engine.begin() as connection:
            connection.execute(Employee.__table__.insert(), [
                {'id': 'synthetic-employee', 'organization_id': 'synthetic-org', 'membership_id': 'synthetic-member', 'employee_code': 'SYN-01'},
                {'id': 'other-employee', 'organization_id': 'other-org', 'membership_id': 'other-member', 'employee_code': 'SYN-02'},
            ])
        for event_name, name in (('before_flush', '_remember_audit_coverage'), ('before_commit', '_require_audit_for_commit'),
                                 ('after_commit', '_clear_audit_state'), ('after_rollback', '_clear_audit_state')):
            callback = audit_guards()[name]
            event.listen(FaultSession, event_name, callback)
            self.addCleanup(event.remove, FaultSession, event_name, callback)
        self.db = FaultSession(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.storage = MemoryStorage(self.db.events)
        self.audit = Mock(side_effect=actual_audit())
        self.tenant = SimpleNamespace(organization_id='synthetic-org', user_id='synthetic-user')
        self.file = SimpleNamespace(file=io.BytesIO(CONTENT), filename='synthetic-document.pdf', content_type='application/pdf')
        self.context = {'select': select, 'Employee': Employee, 'EmployeeHRDocument': EmployeeHRDocument,
                        'HTTPException': HTTPException, 'record_activity': self.audit, 'storage': self.storage,
                        'date': date, 'suppress': suppress}
        self.context['_date'] = actual_function('app/api/v1/hr_uploads.py', '_date', self.context)

    def invoke(self, **overrides):
        args = {'request': None, 'db': self.db, 'tenant': self.tenant, 'file': self.file,
                'employee_id': 'synthetic-employee', 'title': ' Synthetic contract ', 'document_type': ' CONTRACT ',
                'reference_number': ' SYN-REF ', 'issued_on': '2026-01-02', 'expires_on': '2027-01-02', 'notes': ' Synthetic note '}
        args.update(overrides)
        return actual_function('app/api/v1/hr_uploads.py', 'upload_document', self.context)(**args)

    def stored(self):
        with Session(self.engine) as check:
            docs = check.scalars(select(EmployeeHRDocument)).all()
            audits = check.scalars(select(ActivityLog)).all()
            return docs, audits

    def assert_no_rows(self):
        docs, audit = self.stored()
        self.assertEqual((len(docs), len(audit)), (0, 0))

    def test_title_and_reference_model_bounds_reject_before_storage(self):
        self.assertEqual(EmployeeHRDocument.__table__.c.title.type.length, 180)
        self.assertEqual(EmployeeHRDocument.__table__.c.reference_number.type.length, 120)
        for field, size in (("title", 181), ("reference_number", 121)):
            for character in ("x", "😀"):
                with self.subTest(field=field, character=character):
                    with self.assertRaises(HTTPException) as caught:
                        self.invoke(**{field: character * size})
                    self.assertEqual(caught.exception.status_code, 422)
                    self.assertEqual(self.storage.saved, [])
                    self.assertEqual(self.storage.deleted, [])
                    self.assertEqual(self.db.commits, 0)
                    self.audit.assert_not_called()
                    self.assert_no_rows()

    def test_exact_unicode_model_bounds_and_surrounding_whitespace_survive(self):
        self.invoke(title="  " + "😀" * 180 + "  ", reference_number="  " + "ব" * 120 + "  ")
        docs, _ = self.stored()
        self.assertEqual(docs[0].title, "😀" * 180)
        self.assertEqual(docs[0].reference_number, "ব" * 120)
        self.assertEqual(len(self.storage.saved), 1)

    def test_no_new_required_title_or_optional_reference_semantics(self):
        self.invoke(title="  ", reference_number=" " * 121)
        docs, _ = self.stored()
        self.assertEqual(docs[0].title, "")
        self.assertIsNone(docs[0].reference_number)

    def test_invalid_issued_date_cleans_saved_object_without_partial_rows(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(issued_on='not-a-date')
        self.assertEqual((error.exception.status_code, error.exception.detail), (400, 'Invalid date'))
        self.assertEqual(self.storage.objects, {}, 'Known precommit date failure must clean the synthetic saved object')
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertEqual((len(self.storage.saved), self.db.commits, self.db.rollbacks), (1, 0, 1))
        self.audit.assert_not_called()
        self.assert_no_rows()

    def test_invalid_expiry_date_cleans_saved_object_without_partial_rows(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(expires_on='2026-99-99')
        self.assertEqual(error.exception.status_code, 400)
        self.assertEqual(self.storage.objects, {})
        self.assertEqual(self.storage.deleted, [KEY])
        self.assert_no_rows()

    def test_commit_after_persist_exception_retains_committed_document_object(self):
        self.db.failure = 'commit-after'
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        docs, audit = self.stored()
        self.assertEqual((len(docs), len(audit)), (1, 1))
        self.assertEqual(docs[0].storage_key, KEY)
        self.assertIn(KEY, self.storage.objects, 'A commit exception cannot establish rollback; retain possibly committed object')
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, len(self.storage.saved)), (1, 1, 1))

    def test_commit_before_persist_exception_is_uncertain_and_retains_object(self):
        self.db.failure = 'commit-before'
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        self.assert_no_rows()
        self.assertIn(KEY, self.storage.objects)
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, len(self.storage.saved)), (1, 1, 1))

    def test_success_preserves_exact_response_fields_dates_metadata_and_audit(self):
        result = self.invoke()
        docs, audit = self.stored()
        self.assertEqual(len(docs), 1)
        item = docs[0]
        self.assertEqual(result, {'id': item.id, 'file_url': f'/api/hr-documents/{item.id}/file'})
        self.assertEqual((item.organization_id, item.employee_id, item.title, item.document_type, item.reference_number,
                          item.issued_on, item.expires_on, item.notes, item.storage_key, item.original_filename, item.content_type, item.size_bytes),
                         ('synthetic-org', 'synthetic-employee', 'Synthetic contract', 'contract', 'SYN-REF',
                          date(2026, 1, 2), date(2027, 1, 2), 'Synthetic note', KEY, self.file.filename, 'application/pdf', len(CONTENT)))
        self.assertEqual(self.storage.objects, {KEY: CONTENT})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((len(self.storage.saved), self.db.commits, self.db.rollbacks, self.db.refreshes), (1, 1, 0, 0))
        self.assertEqual(len(audit), 1)
        entry = audit[0]
        self.assertEqual((entry.action, entry.scope, entry.organization_id, entry.actor_user_id, entry.entity_type, entry.entity_id, entry.outcome),
                         ('hr.document.uploaded', 'tenant', 'synthetic-org', 'synthetic-user', 'employee_hr_document', item.id, 'success'))
        self.assertEqual(entry.after_data, {'employee_id': 'synthetic-employee', 'title': 'Synthetic contract', 'document_type': 'contract'})
        self.assertEqual(entry.metadata_json, {'filename': self.file.filename, 'size_bytes': len(CONTENT)})

    def test_optional_blank_date_and_text_contract_is_unchanged(self):
        self.invoke(issued_on='', expires_on=None, reference_number='  ', notes='  ')
        item = self.stored()[0][0]
        self.assertEqual((item.issued_on, item.expires_on, item.reference_number, item.notes), (None, None, None, None))

    def test_existing_date_order_semantics_are_not_silently_restricted(self):
        self.invoke(issued_on='2027-01-02', expires_on='2026-01-02')
        item = self.stored()[0][0]
        self.assertEqual((item.issued_on, item.expires_on), (date(2027, 1, 2), date(2026, 1, 2)))

    def test_cross_tenant_employee_rejected_before_storage(self):
        with self.assertRaises(HTTPException) as error:
            self.invoke(employee_id='other-employee')
        self.assertEqual((error.exception.status_code, error.exception.detail), (404, 'Employee not found'))
        self.assertEqual(self.storage.saved, [])
        self.assertEqual(self.db.commits, 0)
        self.audit.assert_not_called()

    def test_file_rejection_precedes_date_parsing_and_preserves_failure_audit(self):
        self.storage.failure = HTTPException(status_code=400, detail='Unsupported document file type')
        with self.assertRaises(HTTPException) as error:
            self.invoke(issued_on='not-a-date')
        self.assertEqual(error.exception.detail, 'Unsupported document file type')
        docs, audits = self.stored()
        self.assertEqual((len(docs), len(audits)), (0, 1))
        self.assertEqual((audits[0].action, audits[0].outcome, audits[0].message),
                         ('hr.document.upload_failed', 'failure', 'Unsupported document file type'))
        self.assertEqual(audits[0].metadata_json, {'employee_id': 'synthetic-employee', 'filename': self.file.filename})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual(self.db.commits, 1)

    def test_non_http_storage_failure_preserves_exception_without_database_write(self):
        self.storage.failure = InjectedError('synthetic storage unavailable')
        with self.assertRaisesRegex(InjectedError, 'synthetic storage unavailable'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual(self.db.commits, 0)

    def test_constructor_failure_cleans_precommit_object(self):
        self.context['EmployeeHRDocument'] = Mock(side_effect=InjectedError('document construction failed'))
        with self.assertRaisesRegex(InjectedError, 'document construction failed'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertEqual(self.db.commits, 0)

    def test_add_failure_cleans_precommit_object(self):
        self.db.failure = 'add'
        with self.assertRaisesRegex(InjectedError, 'document add failed'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.objects, {})
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_flush_failure_rolls_back_insert_and_cleans_object(self):
        self.db.failure = 'flush'
        with self.assertRaisesRegex(InjectedError, 'precommit flush failed'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_audit_failure_rolls_back_insert_and_cleans_object(self):
        self.audit.side_effect = InjectedError('audit recording failed')
        with self.assertRaisesRegex(InjectedError, 'audit recording failed'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_cleanup_failure_preserves_original_invalid_date_exception(self):
        self.storage.fail_delete = True
        with self.assertRaises(HTTPException) as error:
            self.invoke(issued_on='not-a-date')
        self.assertEqual((error.exception.status_code, error.exception.detail), (400, 'Invalid date'))
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertIn(KEY, self.storage.objects)  # Explicit best-effort orphan, not claimed deleted.

    def test_rollback_and_cleanup_failures_do_not_mask_primary_audit_error(self):
        self.audit.side_effect = InjectedError('audit recording failed')
        self.db.rollback_failure = True
        self.storage.fail_delete = True
        with self.assertRaisesRegex(InjectedError, 'audit recording failed'):
            self.invoke()
        self.assertEqual(self.storage.deleted, [KEY])
        self.assertEqual(self.db.commits, 0)
        self.db.close()  # Fixture teardown rolls back the still-open synthetic transaction.
        self.assert_no_rows()

    def test_uncertain_commit_rollback_failure_never_deletes_object(self):
        self.db.failure = 'commit-after'
        self.db.rollback_failure = True
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual(len(self.stored()[0]), 1)
        self.assertEqual(len(self.storage.saved), 1)

    def test_acknowledged_commit_response_readback_failure_never_deletes_or_reuploads(self):
        self.db.failure = 'response-readback'
        with self.assertRaisesRegex(InjectedError, 'postcommit response readback failed'):
            self.invoke()
        self.assertEqual(tuple(map(len, self.stored())), (1, 1))
        self.assertEqual(self.storage.objects, {KEY: CONTENT})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, self.db.refreshes, len(self.storage.saved)), (1, 0, 0, 1))

    def test_actual_audit_guard_rejects_omission_without_deleting_uncertain_object(self):
        self.audit.side_effect = None
        with self.assertRaisesRegex(RuntimeError, 'Audit guard blocked database commit'):
            self.invoke()
        self.assert_no_rows()
        self.assertEqual(self.storage.deleted, [])
        self.assertIn(KEY, self.storage.objects)
        self.assertEqual((self.db.commits, self.db.rollbacks), (1, 1))


    def test_frozen_route_signature_permissions_dates_and_file_readers_are_unchanged(self):
        text = (ROOT / 'app/api/v1/hr_uploads.py').read_text()
        tree = ast.parse(text)
        expected = {'_date': 'c4c08f695c5c37ec2f228c18576c5b97c49754ada91b4bd4e07bcc058900f401', '_filename': '320573259c3670f24a43f7f277730f6d85023ee74ac96301591798adfdf5b1fc', 'manager_file': 'f0125dc5bc59db5bb59128577b1c776bee1ca13b0e893bd0feb445628888dbb6', 'self_file': '4ce88817de0bfeee7ab1c71e612122490b0fcd5f03c965badfeed327e8cb8056', 'upload_header': '5a1e51c335bdf032864a5c7b374395a5a396a739b15bcf99b99289b5269dc33b'}
        for name in ('_date', '_filename', 'manager_file', 'self_file'):
            node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)
            self.assertEqual(hashlib.sha256(ast.get_source_segment(text, node).encode()).hexdigest(), expected[name], name)
        node = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'upload_document')
        start = min(node.lineno, *[n.lineno for n in node.decorator_list]) - 1
        header = ''.join(text.splitlines(keepends=True)[start:node.body[0].lineno-1])
        self.assertEqual(hashlib.sha256(header.encode()).hexdigest(), expected['upload_header'])
        self.assertIn('HRManager = Annotated[TenantContext, Depends(require_tenant_permission("hr.manage"))]', text)
        self.assertIn('HRSelf = Annotated[TenantContext, Depends(require_tenant_permission("hr.self"))]', text)


if __name__ == '__main__':
    unittest.main()
