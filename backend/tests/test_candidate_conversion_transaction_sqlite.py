"""In-memory transaction semantics of actual BusinessSession/defer_commits.

Tiny synthetic tables only: no app imports, app schema, HTTP, Postgres locks,
concurrency or provider proof. Complements actual-handler AST recording tests.
"""
import ast
import copy
from contextlib import contextmanager
from pathlib import Path
import socket
import unittest
from unittest.mock import patch

from sqlalchemy import Column, Integer, MetaData, String, Table, create_engine, event, select
from sqlalchemy.orm import Session

ROOT = Path(__file__).resolve().parents[1]


def actual_session_mechanism():
    tree = ast.parse((ROOT / 'app/db/session.py').read_text())
    nodes = [copy.deepcopy(n) for n in tree.body
             if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in ('BusinessSession', 'defer_commits')]
    ns = {'Session': Session, 'contextmanager': contextmanager}
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), *nodes], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), '<actual-business-session-sqlite>', 'exec'), ns)
    return ns['BusinessSession'], ns['defer_commits']


class ConversionTransactionMechanismTests(unittest.TestCase):
    def setUp(self):
        def deny(*args, **kwargs): raise AssertionError('SQLite test forbids network')
        for obj, key in [(socket.socket, 'connect'), (socket.socket, 'connect_ex'),
                         (socket.socket, 'bind'), (socket.socket, 'listen'),
                         (socket, 'create_connection'), (socket, 'getaddrinfo')]:
            guard = patch.object(obj, key, deny); guard.start(); self.addCleanup(guard.stop)
        self.engine = create_engine('sqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        metadata = MetaData()
        self.candidate = Table('synthetic_candidate', metadata, Column('id', Integer, primary_key=True), Column('stage', String))
        self.invite = Table('synthetic_invitation', metadata, Column('id', Integer, primary_key=True), Column('status', String))
        self.audit = Table('synthetic_audit', metadata, Column('id', Integer, primary_key=True), Column('action', String))
        metadata.create_all(self.engine)
        with self.engine.begin() as conn:
            conn.execute(self.candidate.insert().values(id=1, stage='applied'))
            conn.execute(self.invite.insert().values(id=1, status='pending'))
        business_session, self.defer = actual_session_mechanism()
        self.db = business_session(self.engine, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.commits = []
        event.listen(self.db, 'after_commit', lambda session: self.commits.append('commit'))

    def nested_invitation(self):
        self.db.execute(self.invite.update().where(self.invite.c.id == 1).values(status='revoked'))
        self.db.execute(self.invite.insert().values(id=2, status='pending'))
        self.db.execute(self.audit.insert().values(id=1, action='employee.invited'))
        self.db.commit()  # Actual BusinessSession turns this into flush inside defer.

    def test_invitation_candidate_and_both_audits_commit_once(self):
        with self.defer(self.db):
            self.nested_invitation()
            self.assertEqual(self.commits, [])
            self.db.execute(self.candidate.update().where(self.candidate.c.id == 1).values(stage='hired'))
            self.db.execute(self.audit.insert().values(id=2, action='hr.candidate.converted'))
        self.assertEqual(self.commits, [])
        self.db.commit()
        self.assertEqual(self.commits, ['commit'])
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(select(self.candidate.c.stage)), 'hired')
            self.assertEqual(conn.execute(select(self.invite.c.status).order_by(self.invite.c.id)).scalars().all(), ['revoked', 'pending'])
            self.assertEqual(len(conn.execute(select(self.audit)).all()), 2)

    def test_audit_failure_restores_pending_invite_and_candidate(self):
        with self.assertRaisesRegex(RuntimeError, 'synthetic audit failure'):
            with self.defer(self.db):
                self.nested_invitation()
                self.db.execute(self.candidate.update().values(stage='hired'))
                raise RuntimeError('synthetic audit failure')
        self.assertEqual(self.commits, [])
        self.assertNotIn('deferred_commit_depth', self.db.info)
        with self.engine.connect() as conn:
            self.assertEqual(conn.scalar(select(self.candidate.c.stage)), 'applied')
            self.assertEqual(conn.execute(select(self.invite.c.id, self.invite.c.status)).all(), [(1, 'pending')])
            self.assertEqual(conn.execute(select(self.audit)).all(), [])

    def test_nested_context_restores_depth_until_outer_commit(self):
        with self.defer(self.db):
            with self.defer(self.db):
                self.assertEqual(self.db.info['deferred_commit_depth'], 2)
                self.nested_invitation()
            self.assertEqual(self.db.info['deferred_commit_depth'], 1)
            self.db.commit()
            self.assertEqual(self.commits, [])
        self.assertNotIn('deferred_commit_depth', self.db.info)
        self.db.commit()
        self.assertEqual(self.commits, ['commit'])


if __name__ == '__main__': unittest.main()
