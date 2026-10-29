"""Actual invitation/conversion AST with recording fakes; no SQL, HTTP or provider.

These regression expectations intentionally fail before the atomicity fix. The
fake's commit snapshots represent observed call boundaries, not database proof.
No app module imports, credentials, service startup or invitation transmission.
"""
import ast
import copy
from datetime import datetime, timezone
from contextlib import contextmanager
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


class HTTPError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail
        super().__init__(detail)


class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return (self.name, '=', value)
    def is_(self, value): return (self.name, 'is', value)


class ModelType(type):
    def __getattr__(cls, name): return Column(cls.__name__ + '.' + name)


class Model(metaclass=ModelType):
    def __init__(self, **values): self.__dict__.update(values)


class JobCandidate(Model): pass
class JobOpening(Model): pass
class OrganizationRole(Model): pass
class EmployeeInvitation(Model): pass
class Employee(Model): pass
class User(Model): pass
class Membership(Model): pass


class Query:
    def __init__(self, target): self.target, self.conditions, self.locked = target, (), False
    def where(self, *conditions): self.conditions += conditions; return self
    def with_for_update(self): self.locked = True; return self


class SessionBase:
    """Physical commit hook only; actual BusinessSession defines deferral behavior."""
    def commit(self): self._physical_commit()


def session_mechanism():
    tree = ast.parse((ROOT / 'app/db/session.py').read_text())
    nodes = [copy.deepcopy(n) for n in tree.body
             if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in ('BusinessSession', 'defer_commits')]
    ns = {'Session': SessionBase, 'contextmanager': contextmanager}
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<actual-business-session>', 'exec'), ns)
    return ns


SESSION_MECHANISM = session_mechanism()


class RecordingDB(SESSION_MECHANISM['BusinessSession']):
    def __init__(self):
        self.candidate = NS(id='candidate', organization_id='org', stage='applied',
                            job_opening_id='job', email='person@example.invalid', full_name='Synthetic person')
        self.job = NS(id='job', department_id='department')
        self.previous = NS(id='old-invite', status='pending', email='person@example.invalid')
        self.added, self.events, self.queries, self.durable = [], [], [], []
        self.commits, self.candidate_reads = 0, 0
        self.info = {}
        self.rollbacks = 0
        self.fail_commit = False
        self.missing_second_candidate = False
        self.missing_job = False
        self.missing_candidate = False

    def scalar(self, query):
        self.queries.append(query)
        if query.target is JobCandidate:
            self.candidate_reads += 1
            if self.missing_candidate or self.missing_second_candidate and self.candidate_reads > 1:
                return None
            return self.candidate
        if query.target is JobOpening: return None if self.missing_job else self.job
        if isinstance(query.target, Column) and query.target.name == 'OrganizationRole.id': return 'role'
        return None  # No existing member or reserved employee code in this scenario.

    def scalars(self, query):
        self.queries.append(query)
        return NS(all=lambda: [self.previous])

    def add(self, item): self.added.append(item); self.events.append('add-invitation')
    def flush(self):
        self.events.append('flush')
        for index, item in enumerate(self.added): item.id = f'synthetic-invite-{index}'
    def refresh(self, item): self.events.append('refresh')
    def rollback(self):
        self.rollbacks += 1
        self.events.append('rollback')
        # Recording-fake restoration only, not SQL rollback verification.
        self.candidate.stage = 'applied'
        self.previous.status = 'pending'
        self.added.clear()
    def _physical_commit(self):
        if self.fail_commit: raise RuntimeError('Synthetic commit failure')
        self.commits += 1
        self.events.append('commit')
        self.durable.append({'candidate_stage': self.candidate.stage,
                             'previous_status': self.previous.status,
                             'invitations': len(self.added)})


def load_actual(db, audit_failure=False, role_failure=False, invitation_audit_failure=False, dto_failure=False):
    def role_grant(*args):
        db.events.append('grant-check')
        if role_failure: raise HTTPError(403, 'Synthetic forbidden role')
    def audit(*args, **kwargs):
        db.events.append('candidate-audit')
        if audit_failure: raise RuntimeError('Synthetic candidate audit failure')
    def invitation_audit(*args, **kwargs):
        db.events.append('invitation-audit')
        if invitation_audit_failure: raise RuntimeError('Synthetic invitation audit failure')
    def invitation_read(item, role_name):
        if dto_failure: raise RuntimeError('Synthetic invitation response failure')
        return NS(model_dump=lambda: dict(id=item.id, employee_code=item.employee_code, email=item.email))
    ns = dict(select=Query, HTTPException=HTTPError, JobCandidate=JobCandidate,
              defer_commits=SESSION_MECHANISM['defer_commits'],
              JobOpening=JobOpening, OrganizationRole=OrganizationRole,
              EmployeeInvitation=EmployeeInvitation, Employee=Employee, User=User, Membership=Membership,
              InvitationCreate=lambda **kw: NS(**kw), InvitationCreated=lambda **kw: NS(**kw),
              ensure_grantable_employee_role=role_grant, _audit=audit,
              _role=lambda *args: NS(id='role', name='Synthetic role'),
              _department=lambda *args: NS(id='department'), _designation=lambda *args: None,
              _clean=lambda value: value.strip() if value else None,
              next_employee_code=lambda *args: 'SYN-001',
              create_invitation_token=lambda: ('synthetic-not-a-real-token', 'synthetic-hash'),
              invitation_expiry=lambda: datetime(2030, 1, 1, tzinfo=timezone.utc),
              record_activity=invitation_audit,
              _invitation_read=invitation_read)
    nodes = []
    for filename, names in [('team.py', ['prepare_invitation', 'create_invitation']),
                            ('hr_extended.py', ['convert_candidate'])]:
        tree = ast.parse((ROOT / 'app/api/v1' / filename).read_text())
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and node.name in names:
                node = copy.deepcopy(node); node.decorator_list = []; nodes.append(node)
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<actual-invitation-conversion>', 'exec'), ns)
    return ns


class ConversionAtomicityTests(unittest.TestCase):
    def setUp(self):
        def deny(*args, **kwargs): raise AssertionError('Offline test forbids network')
        for obj, key in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'),
                         (socket.socket, 'bind'), (socket.socket, 'listen'),
                         (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, key, deny); guard.start(); self.addCleanup(guard.stop)
        self.db = RecordingDB()
        self.tenant = NS(organization_id='org', user_id='actor')
        self.payload = NS(role_id='role', department_id=None, designation_id=None, employee_code=None)

    def convert(self, **options):
        return load_actual(self.db, **options)['convert_candidate']('candidate', self.payload, None, self.db, self.tenant)

    def test_success_commits_invitation_candidate_and_audits_once(self):
        response = self.convert()
        self.assertEqual(response['stage'], 'hired')
        self.assertEqual(self.db.commits, 1, self.db.events)
        self.assertTrue(all(row['candidate_stage'] == 'hired' for row in self.db.durable))
        self.assertLess(self.db.events.index('candidate-audit'), self.db.events.index('commit'))
        self.assertLess(self.db.events.index('invitation-audit'), self.db.events.index('commit'))
        self.assertNotIn('deferred_commit_depth', self.db.info)

    def test_candidate_audit_failure_cannot_leave_committed_invitation(self):
        with self.assertRaisesRegex(RuntimeError, 'Synthetic candidate audit'):
            self.convert(audit_failure=True)
        self.assertEqual(self.db.commits, 0, self.db.events)
        self.assertEqual(self.db.durable, [])
        self.assertEqual(self.db.rollbacks, 1)
        self.assertNotIn('deferred_commit_depth', self.db.info)
        self.assertEqual(self.db.candidate.stage, 'applied')
        self.assertEqual(self.db.previous.status, 'pending')
        self.assertEqual(self.db.added, [])

    def test_locked_candidate_does_not_require_post_invitation_relookup(self):
        self.db.missing_second_candidate = True
        response = self.convert()
        self.assertEqual(response['stage'], 'hired')
        self.assertEqual(self.db.candidate_reads, 1)

    def test_outer_commit_failure_does_not_return_success_or_record_durable_write(self):
        self.db.fail_commit = True
        with self.assertRaisesRegex(RuntimeError, 'Synthetic commit failure'): self.convert()
        self.assertEqual(self.db.durable, [])
        self.assertEqual(self.db.commits, 0)
        # No claim of explicit rollback outside defer context: dependency closes session.

    def test_actual_nested_deferral_flushes_and_restores_prior_depth(self):
        self.db.info['deferred_commit_depth'] = 1
        with SESSION_MECHANISM['defer_commits'](self.db):
            self.assertEqual(self.db.info['deferred_commit_depth'], 2)
            self.db.commit()
        self.assertEqual(self.db.info['deferred_commit_depth'], 1)
        self.assertEqual(self.db.commits, 0)
        self.assertIn('flush', self.db.events)

    def test_invitation_audit_failure_rolls_back_without_physical_commit(self):
        with self.assertRaisesRegex(RuntimeError, 'Synthetic invitation audit'):
            self.convert(invitation_audit_failure=True)
        self.assertEqual(self.db.commits, 0)
        self.assertEqual(self.db.rollbacks, 1)
        self.assertNotIn('deferred_commit_depth', self.db.info)

    def test_invitation_response_failure_rolls_back_without_physical_commit(self):
        with self.assertRaisesRegex(RuntimeError, 'Synthetic invitation response'):
            self.convert(dto_failure=True)
        self.assertEqual(self.db.commits, 0)
        self.assertEqual(self.db.rollbacks, 1)
        self.assertNotIn('deferred_commit_depth', self.db.info)

    def test_repeat_after_success_is409_without_revoking_first_invitation(self):
        first = self.convert()
        before = (self.db.commits, len(self.db.added), len(self.db.events))
        with self.assertRaises(HTTPError) as caught: self.convert()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual((self.db.commits, len(self.db.added), len(self.db.events)), before)
        self.assertEqual(self.db.added[0].status, 'pending')
        self.assertEqual(first['invitation_id'], self.db.added[0].id)

    def test_actual_dependency_wires_business_session_without_expiration(self):
        tree = ast.parse((ROOT / 'app/db/session.py').read_text())
        assignment = next(n for n in tree.body if isinstance(n, ast.Assign)
                          and any(isinstance(t, ast.Name) and t.id == 'SessionLocal' for t in n.targets))
        keywords = {k.arg: ast.unparse(k.value) for k in assignment.value.keywords}
        self.assertEqual(keywords['class_'], 'BusinessSession')
        self.assertEqual(keywords['expire_on_commit'], 'False')
        dependency = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'get_db')
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                            and n.func.id == 'SessionLocal' for n in ast.walk(dependency)))
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                            and n.func.attr == 'close' for n in ast.walk(dependency)))

    def test_hired_conflict_preserved_without_invitation(self):
        self.db.candidate.stage = 'hired'
        with self.assertRaises(HTTPError) as caught: self.convert()
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(self.db.added, []); self.assertEqual(self.db.commits, 0)

    def test_missing_candidate_is404_before_invitation(self):
        self.db.missing_candidate = True
        with self.assertRaises(HTTPError) as caught: self.convert()
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.db.added, []); self.assertEqual(self.db.commits, 0)

    def test_missing_job_is404_before_invitation(self):
        self.db.missing_job = True
        with self.assertRaises(HTTPError) as caught: self.convert()
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.db.added, []); self.assertEqual(self.db.commits, 0)

    def test_role_grant_denial_before_any_invitation_mutation(self):
        with self.assertRaises(HTTPError) as caught: self.convert(role_failure=True)
        self.assertEqual(caught.exception.status_code, 403)
        self.assertEqual(self.db.added, []); self.assertEqual(self.db.commits, 0)
        self.assertEqual(self.db.previous.status, 'pending')

    def test_candidate_query_keeps_tenant_predicate_and_row_lock(self):
        self.convert()
        query = self.db.queries[0]
        self.assertTrue(query.locked)
        self.assertIn(('JobCandidate.organization_id', '=', 'org'), query.conditions)
        self.assertIn(('JobCandidate.id', '=', 'candidate'), query.conditions)

    def test_canonical_endpoint_still_commits_once_and_returns_same_fields(self):
        payload = NS(email='person@example.invalid', full_name='Synthetic person', role_id='role',
                     department_id=None, designation_id=None, employee_code=None)
        result = load_actual(self.db)['create_invitation'](payload, None, self.db, self.tenant)
        self.assertEqual(self.db.commits, 1)
        self.assertEqual(result.email, payload.email)
        self.assertEqual(result.employee_code, 'SYN-001')
        self.assertEqual(result.invite_token, 'synthetic-not-a-real-token')


if __name__ == '__main__': unittest.main()
