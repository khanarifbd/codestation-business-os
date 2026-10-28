"""Read-only hiring handler characterization using AST and recording fakes.

No HTTP auth, SQL execution, tenant isolation enforcement, database concurrency,
provider or invitation proof. Conversion is inspected only, never executed.
"""
import ast
import copy
from decimal import Decimal
from pathlib import Path
import socket
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
TREE = ast.parse((ROOT / 'app/api/v1/hr.py').read_text())
EXTENDED = ast.parse((ROOT / 'app/api/v1/hr_extended.py').read_text())
TEAM = ast.parse((ROOT / 'app/api/v1/team.py').read_text())


def function(tree, name):
    return next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name)


class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, other): return (self.name, '=', other)
    def desc(self): return (self.name, 'desc')


class Model:
    def __init__(self, name): self.name = name
    def __getattr__(self, name): return Column(self.name + '.' + name)


class Query:
    def __init__(self, target): self.target, self.conditions, self.order, self.cap = target, (), (), None
    def where(self, *args): self.conditions += args; return self
    def order_by(self, *args): self.order = args; return self
    def limit(self, cap): self.cap = cap; return self


class TalentReadContract(unittest.TestCase):
    def setUp(self):
        def denied(*args, **kwargs): raise AssertionError('Offline characterization forbids network')
        for obj, name in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'), (socket.socket, 'bind'), (socket.socket, 'listen'), (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, name, denied); guard.start(); self.addCleanup(guard.stop)
        self.queries, self.rows = [], []
        def scalars(q):
            self.queries.append(q)
            return NS(all=lambda: self.rows.pop(0))
        self.db = NS(scalars=scalars)  # No mutation methods are available.
        self.tenant = NS(organization_id='synthetic-org')
        self.ns = dict(select=Query, JobOpening=Model('JobOpening'), JobCandidate=Model('JobCandidate'))
        nodes = [copy.deepcopy(function(TREE, n)) for n in ['list_jobs', 'list_candidates']]
        for n in nodes: n.decorator_list = []
        module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
        exec(compile(ast.fix_missing_locations(module), '<extracted-talent-read>', 'exec'), self.ns)
        self.job = NS(id='job-A', title='Synthetic role', department_id=None, employment_type='full_time', location=None, openings=2, status='open', description=None)
        self.candidate = NS(id='candidate-A', job_opening_id='job-A', full_name='Synthetic person', email='person@example.invalid', phone=None, stage='applied', rating=Decimal('4.50'), resume_url=None, notes=None)

    def jobs(self, rows=None):
        self.rows = [rows if rows is not None else [self.job]]
        return self.ns['list_jobs'](self.db, self.tenant)

    def candidates(self, jobs=None, rows=None):
        self.rows = [jobs if jobs is not None else [self.job], rows if rows is not None else [self.candidate]]
        return self.ns['list_candidates'](self.db, self.tenant)

    def test_jobs_exact_receipt(self):
        self.assertEqual(self.jobs(), [vars(self.job)])

    def test_jobs_latest_100_query(self):
        self.jobs(); q = self.queries[0]
        self.assertEqual(q.cap, 100)
        self.assertEqual(q.order, (('JobOpening.created_at', 'desc'),))

    def test_jobs_tenant_predicate(self):
        self.jobs(); self.assertEqual(self.queries[0].conditions, (('JobOpening.organization_id', '=', 'synthetic-org'),))

    def test_jobs_empty_plain_list(self): self.assertEqual(self.jobs([]), [])

    def test_jobs_null_and_zero_preserved(self):
        self.job.openings = 0
        row = self.jobs()[0]
        self.assertEqual(row['openings'], 0); self.assertIsNone(row['description']); self.assertIsNone(row['location'])

    def test_jobs_no_status_filter(self):
        self.job.status = 'closed'; self.assertEqual(self.jobs()[0]['status'], 'closed')
        self.assertEqual(len(self.queries[0].conditions), 1)

    def test_candidates_exact_receipt(self):
        expected = dict(vars(self.candidate), job_title='Synthetic role', rating='4.50')
        self.assertEqual(self.candidates(), [expected])

    def test_candidates_latest_200_query(self):
        self.candidates(); q = self.queries[1]
        self.assertEqual(q.cap, 200); self.assertEqual(q.order, (('JobCandidate.created_at', 'desc'),))

    def test_both_candidate_queries_tenant_scoped(self):
        self.candidates()
        self.assertEqual([q.conditions for q in self.queries], [(('JobOpening.organization_id', '=', 'synthetic-org'),), (('JobCandidate.organization_id', '=', 'synthetic-org'),)])

    def test_candidate_job_lookup_unbounded_separate_query(self):
        self.candidates(); self.assertEqual(len(self.queries), 2)
        self.assertIsNone(self.queries[0].cap); self.assertEqual(self.queries[0].order, ())

    def test_missing_job_title_is_null(self): self.assertIsNone(self.candidates(jobs=[])[0]['job_title'])

    def test_missing_rating_is_null(self):
        self.candidate.rating = None; self.assertIsNone(self.candidates()[0]['rating'])

    def test_zero_rating_is_string_zero(self):
        self.candidate.rating = Decimal('0'); self.assertEqual(self.candidates()[0]['rating'], '0')

    def test_candidates_empty_plain_list(self): self.assertEqual(self.candidates(rows=[]), [])

    def test_no_stage_filter_or_pagination_arguments(self):
        self.candidate.stage = 'hired'; self.assertEqual(self.candidates()[0]['stage'], 'hired')
        for name in ['list_jobs', 'list_candidates']:
            self.assertEqual([a.arg for a in function(TREE, name).args.args], ['db', 'tenant'])

    def test_declared_hr_view_permission_not_http_auth_proof(self):
        declaration = next(n for n in TREE.body if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'HRViewer' for t in n.targets))
        self.assertIn("require_tenant_permission('hr.view')", ast.unparse(declaration))
        for name in ['list_jobs', 'list_candidates']:
            self.assertEqual(ast.unparse(function(TREE, name).args.args[1].annotation), 'HRViewer')

    def test_no_single_record_get_in_hr_routers(self):
        paths = []
        for tree in [TREE, EXTENDED]:
            for n in tree.body:
                if isinstance(n, ast.FunctionDef):
                    for d in n.decorator_list:
                        if isinstance(d, ast.Call) and isinstance(d.func, ast.Attribute) and d.func.attr == 'get' and d.args and isinstance(d.args[0], ast.Constant): paths.append(d.args[0].value)
        self.assertIn('/jobs', paths); self.assertIn('/candidates', paths)
        self.assertFalse(any(p.startswith(('/jobs/', '/candidates/')) for p in paths))

    def test_read_handlers_do_not_call_mutations(self):
        for name in ['list_jobs', 'list_candidates']:
            calls = [n.func.attr for n in ast.walk(function(TREE, name)) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
            self.assertFalse(set(calls) & {'commit', 'flush', 'add', 'delete', 'with_for_update'})

    def test_conversion_defers_invitation_commit_and_keeps_one_candidate_lock_static_only(self):
        convert = function(EXTENDED, 'convert_candidate'); invite = function(TEAM, 'create_invitation')
        boundary = next(n for n in convert.body if isinstance(n, ast.With))
        self.assertEqual(ast.unparse(boundary.items[0].context_expr), 'defer_commits(db)')
        invitation_calls = [n for n in ast.walk(boundary) if isinstance(n, ast.Call)
                            and isinstance(n.func, ast.Name) and n.func.id == 'create_invitation']
        self.assertEqual(len(invitation_calls), 1)
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name)
                            and n.func.id == '_audit' for n in ast.walk(boundary)))
        self.assertFalse(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                             and n.func.attr == 'scalar' for n in ast.walk(boundary)))
        commits = [n for n in ast.walk(convert) if isinstance(n, ast.Call)
                   and isinstance(n.func, ast.Attribute) and n.func.attr == 'commit']
        self.assertEqual(len(commits), 1)
        self.assertGreater(commits[0].lineno, boundary.end_lineno)
        self.assertTrue(any(isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
                            and n.func.attr == 'commit' for n in ast.walk(invite)))



if __name__ == '__main__': unittest.main()
