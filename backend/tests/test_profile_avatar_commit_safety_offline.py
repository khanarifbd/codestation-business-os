"""Actual avatar handler fault injection; in-memory SQLite and object-store fake only.

No configured application engine, settings, storage implementation or provider is
imported. The actual handler, audit recorder and audit guard bodies are compiled
from current source; only boundary dependencies are supplied. PostgreSQL commit
acknowledgment and filesystem/cloud-storage behavior are NOT proven by this suite.
"""
import ast
import asyncio
import copy
from collections.abc import Mapping, Sequence
from contextlib import suppress
from pathlib import Path
import unittest
from unittest.mock import Mock

from sqlalchemy import create_engine, event, select
from sqlalchemy.dialects.sqlite.base import SQLiteTypeCompiler
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.user import User
from app.schemas.auth import UserProfileRead

ROOT = Path(__file__).resolve().parents[1]
OLD, NEW = 'synthetic-old-avatar', 'synthetic-new-avatar'


def actual_function(relative, name, context):
    source = ROOT / relative
    node = copy.deepcopy(next(item for item in ast.parse(source.read_text()).body
                             if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and item.name == name))
    node.decorator_list = []
    # Strip only route-binding defaults; the executed handler body is exact.
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
        self.events.append('commit-acknowledged')
        if self.failure == 'commit-after':
            raise InjectedError('commit outcome uncertain')
        return result

    def rollback(self):
        self.rollbacks += 1
        if self.rollback_failure:
            raise InjectedError('rollback also failed')
        return super().rollback()

    def refresh(self, *args, **kwargs):
        self.refreshes += 1
        if self.failure == 'refresh':
            raise InjectedError('postcommit refresh failed')
        return super().refresh(*args, **kwargs)


class MemoryStorage:
    def __init__(self, events):
        self.objects = {OLD: b'synthetic-old'}
        self.deleted, self.saved, self.events = [], [], events
        self.fail_delete = None
        self.fail_save = False

    def save(self, **kwargs):
        self.saved.append(kwargs)
        if self.fail_save:
            raise InjectedError('storage save failed')
        self.objects[NEW] = b'synthetic-new'
        self.events.append('storage-saved')
        return NEW, 'image/png'

    def delete(self, key):
        self.deleted.append(key)
        self.events.append('delete:' + str(key))
        if key == self.fail_delete:
            raise OSError('synthetic deletion failed')
        self.objects.pop(key, None)


class Upload:
    content_type = 'image/png'
    def __init__(self):
        self.closed = False
        self.read_sizes = []
    async def read(self, size):
        self.read_sizes.append(size)
        return b'synthetic-image-boundary-bytes'
    async def close(self):
        self.closed = True


class AvatarCommitSafetyTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        User.__table__.create(self.engine)
        ActivityLog.__table__.create(self.engine)
        with self.engine.begin() as connection:
            connection.execute(User.__table__.insert(), {
                'id': 'synthetic-user', 'email': 'avatar@example.com', 'full_name': 'Synthetic User',
                'avatar_storage_key': OLD, 'avatar_content_type': 'image/png', 'avatar_version': 2,
            })
        guards = audit_guards()
        for event_name, name in (('before_flush', '_remember_audit_coverage'),
                                 ('before_commit', '_require_audit_for_commit'),
                                 ('after_commit', '_clear_audit_state'), ('after_rollback', '_clear_audit_state')):
            callback = guards[name]
            event.listen(FaultSession, event_name, callback)
            self.addCleanup(event.remove, FaultSession, event_name, callback)
        self.db = FaultSession(self.engine, autoflush=False, expire_on_commit=False)
        self.addCleanup(self.db.close)
        self.user = self.db.get(User, 'synthetic-user')
        self.storage = MemoryStorage(self.db.events)
        self.upload = Upload()
        self.audit = Mock(side_effect=actual_audit())
        self.context = {'avatar_storage': self.storage, 'AVATAR_MAX_BYTES': 5 * 1024 * 1024,
                        'record_activity': self.audit, 'UserProfileRead': UserProfileRead, 'suppress': suppress}
        self.context['_profile_read'] = actual_function('app/api/v1/profile.py', '_profile_read', self.context)

    def invoke(self, read=None):
        context = dict(self.context)
        if read:
            context['_profile_read'] = read
        handler = actual_function('app/api/v1/profile.py', 'upload_avatar', context)
        return asyncio.run(handler(None, self.db, self.user, self.upload))

    def stored(self):
        with Session(self.engine) as check:
            return check.scalar(select(User.avatar_storage_key)), check.scalar(select(User.avatar_version)), check.scalars(select(ActivityLog)).all()

    def test_postcommit_refresh_failure_keeps_committed_new_avatar(self):
        self.db.failure = 'refresh'
        with self.assertRaisesRegex(InjectedError, 'postcommit refresh failed'):
            self.invoke()
        key, version, audit = self.stored()
        self.assertEqual((key, version, len(audit)), (NEW, 3, 1))
        self.assertIn(NEW, self.storage.objects, 'Committed avatar object must survive failed readback')
        self.assertNotIn(NEW, self.storage.deleted)
        self.assertEqual(len(self.storage.saved), 1)

    def test_success_keeps_contract_and_cleans_old_only_after_commit(self):
        value = self.invoke()
        self.assertIsInstance(value, UserProfileRead)
        self.assertEqual((value.id, value.has_avatar, value.avatar_version), ('synthetic-user', True, 3))
        self.assertEqual(self.stored()[:2], (NEW, 3))
        self.assertEqual(set(self.storage.objects), {NEW})
        self.assertEqual(self.db.events, ['storage-saved', 'commit-attempt', 'commit-acknowledged', 'delete:' + OLD])
        self.assertEqual((self.db.commits, self.db.rollbacks, len(self.storage.saved)), (1, 0, 1))
        audit = self.stored()[2]
        self.assertEqual(len(audit), 1)
        self.assertEqual((audit[0].action, audit[0].scope, audit[0].actor_user_id, audit[0].entity_id, audit[0].metadata_json),
                         ('user.avatar.updated', 'account', 'synthetic-user', 'synthetic-user', {'content_type': 'image/png'}))
        self.assertTrue(self.upload.closed)
        self.assertEqual(self.upload.read_sizes, [5 * 1024 * 1024 + 1])
        self.assertEqual(self.storage.saved[0]['user_id'], 'synthetic-user')
        self.assertEqual(self.storage.saved[0]['declared_content_type'], 'image/png')

    def test_audit_recording_failure_rolls_back_and_cleans_uncommitted_new(self):
        self.audit.side_effect = InjectedError('audit staging failed')
        with self.assertRaisesRegex(InjectedError, 'audit staging failed'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.assertEqual(len(self.stored()[2]), 0)
        self.assertEqual(set(self.storage.objects), {OLD})
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_flush_failure_after_sql_rolls_back_business_and_audit_rows(self):
        self.db.failure = 'flush'
        with self.assertRaisesRegex(InjectedError, 'precommit flush failed'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.assertEqual(len(self.stored()[2]), 0)
        self.assertEqual(set(self.storage.objects), {OLD})
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_commit_exception_before_commit_is_uncertain_and_retains_both_objects(self):
        self.db.failure = 'commit-before'
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.assertEqual(len(self.stored()[2]), 0)
        self.assertEqual(set(self.storage.objects), {OLD, NEW})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, len(self.storage.saved)), (1, 1, 1))

    def test_commit_acknowledgment_exception_after_commit_retains_both_objects(self):
        self.db.failure = 'commit-after'
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (NEW, 3))
        self.assertEqual(len(self.stored()[2]), 1)
        self.assertEqual(set(self.storage.objects), {OLD, NEW})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual((self.db.commits, self.db.rollbacks, len(self.storage.saved)), (1, 1, 1))

    def test_commit_error_survives_rollback_error_without_deleting_either(self):
        self.db.failure = 'commit-after'
        self.db.rollback_failure = True
        with self.assertRaisesRegex(InjectedError, 'commit outcome uncertain'):
            self.invoke()
        self.assertEqual(set(self.storage.objects), {OLD, NEW})
        self.assertEqual(self.storage.deleted, [])
        self.assertEqual(self.stored()[:2], (NEW, 3))

    def test_precommit_error_survives_rollback_failure_and_still_attempts_cleanup(self):
        self.audit.side_effect = InjectedError('audit staging failed')
        self.db.rollback_failure = True
        with self.assertRaisesRegex(InjectedError, 'audit staging failed'):
            self.invoke()
        self.assertEqual(set(self.storage.objects), {OLD})
        self.assertEqual(self.storage.deleted, [NEW])
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 1))

    def test_precommit_cleanup_failure_preserves_original_error(self):
        self.audit.side_effect = InjectedError('audit staging failed')
        self.storage.fail_delete = NEW
        with self.assertRaisesRegex(InjectedError, 'audit staging failed'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.assertEqual(len(self.stored()[2]), 0)
        self.assertEqual(self.storage.deleted, [NEW])
        self.assertEqual(self.db.commits, 0)

    def test_old_avatar_cleanup_failure_does_not_turn_commit_into_failed_upload(self):
        self.storage.fail_delete = OLD
        value = self.invoke()
        self.assertEqual(value.avatar_version, 3)
        self.assertEqual(self.stored()[:2], (NEW, 3))
        self.assertEqual(set(self.storage.objects), {OLD, NEW})
        self.assertEqual((len(self.storage.saved), self.db.commits), (1, 1))

    def test_serialization_error_after_commit_never_deletes_new_or_reuploads(self):
        read = Mock(side_effect=InjectedError('response serialization failed'))
        with self.assertRaisesRegex(InjectedError, 'response serialization failed'):
            self.invoke(read=read)
        self.assertEqual(self.stored()[:2], (NEW, 3))
        self.assertIn(NEW, self.storage.objects)
        self.assertNotIn(NEW, self.storage.deleted)
        self.assertEqual((len(self.storage.saved), self.db.commits), (1, 1))

    def test_real_audit_guard_still_rejects_omitted_activity(self):
        self.audit.side_effect = None  # Deliberately omit audit for a negative guard test.
        with self.assertRaisesRegex(RuntimeError, 'Audit guard blocked database commit'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.assertEqual(len(self.stored()[2]), 0)
        self.assertEqual(set(self.storage.objects), {OLD, NEW})
        self.assertEqual((self.db.commits, self.db.rollbacks), (1, 1))

    def test_storage_save_failure_never_mutates_or_commits_profile(self):
        self.storage.fail_save = True
        with self.assertRaisesRegex(InjectedError, 'storage save failed'):
            self.invoke()
        self.assertEqual(self.stored()[:2], (OLD, 2))
        self.audit.assert_not_called()
        self.assertEqual((self.db.commits, self.db.rollbacks), (0, 0))
        self.assertEqual(self.storage.deleted, [])
        self.assertTrue(self.upload.closed)

    def test_first_avatar_keeps_original_version_and_nullable_old_key_semantics(self):
        # Arrange only synthetic fixture state through Core, outside the tested request.
        self.db.close()
        with self.engine.begin() as connection:
            connection.execute(User.__table__.update().values(avatar_storage_key=None, avatar_content_type=None, avatar_version=0))
        self.user = self.db.get(User, 'synthetic-user')
        self.storage.objects.clear()
        value = self.invoke()
        self.assertEqual(value.avatar_version, 1)
        self.assertTrue(value.has_avatar)
        self.assertEqual(set(self.storage.objects), {NEW})
        self.assertEqual((self.db.commits, len(self.storage.saved)), (1, 1))


if __name__ == '__main__':
    unittest.main()
