"""Actual disable/validation handlers with recording fakes; no PostgreSQL or HTTP proof."""
import ast
import copy
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from app.models.client_invitations import ClientInvitation
from app.models.client_access import ClientMembership

ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 1, 1, tzinfo=timezone.utc)


def invitation(identity, status='pending', org='org', client='client'):
    return SimpleNamespace(id=identity, status=status, organization_id=org, client_id=client,
                           revoked_at=None, accepted_at=NOW if status=='accepted' else None,
                           expires_at=NOW+timedelta(days=1))


def access(identity='access', org='org', client='client'):
    return SimpleNamespace(id=identity, status='active', organization_id=org,
                           client_id=client, membership_id='member')


class RecordingDB:
    def __init__(self, invitations=(), accesses=(), failure=None):
        self.invitations=list(invitations); self.accesses=list(accesses)
        self.failure=failure; self.events=[]; self.queries=[]; self.commits=0
        self.before=[(r,copy.deepcopy(vars(r)))for r in self.invitations+self.accesses]
    def scalars(self, query):
        sql=str(query.compile(dialect=postgresql.dialect()))
        params=query.compile().params
        self.queries.append((sql,params)); self.events.append('invitations' if 'FROM client_invitations' in sql else 'accesses')
        rows=self.invitations if 'FROM client_invitations' in sql else self.accesses
        # Recording fake applies the actual query's bound tenant/client predicates.
        rows=[r for r in rows if r.organization_id==params['organization_id_1'] and r.client_id==params['client_id_1']]
        if 'status_1' in params:rows=[r for r in rows if r.status==params['status_1']]
        if 'ORDER BY' in sql:rows=sorted(rows,key=lambda r:r.id)
        return SimpleNamespace(all=lambda:rows)
    def scalar(self, query):return self.invitations[0] if self.invitations else None
    def flush(self):
        self.events.append('flush')
        if self.failure=='flush':raise RuntimeError('synthetic flush failure')
    def commit(self):
        self.events.append('commit')
        if self.failure=='commit':raise RuntimeError('synthetic commit failure')
        self.commits+=1
    def close_as_dependency(self):
        # Explicit fake cleanup characterization, not real SQL rollback.
        if not self.commits:
            for row,values in self.before:vars(row).clear();vars(row).update(values)


def load(db):
    audits=[]
    def audit(*args,**kwargs):
        if db.failure=='audit':raise RuntimeError('synthetic audit failure')
        audits.append(kwargs);db.events.append('audit')
    ns={'select':select,'ClientInvitation':ClientInvitation,'ClientMembership':ClientMembership,
        'HTTPException':HTTPException,'utc_now':lambda:NOW,'hash_invitation_token':lambda token:token,
        '_client':lambda *args:SimpleNamespace(id='client',display_name='Synthetic client'),
        '_deactivate_membership_if_orphaned':lambda *args:db.events.append('orphan-check'),
        'record_activity':audit}
    for file,name in [('client_access.py','disable_client_access'),('client_invitations.py','_valid_invitation')]:
        tree=ast.parse((ROOT/'app/api/v1'/file).read_text())
        node=copy.deepcopy(next(n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name==name));node.decorator_list=[]
        module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),node],type_ignores=[])
        exec(compile(ast.fix_missing_locations(module),file,'exec'),ns)
    return ns,audits


class Tests(unittest.TestCase):
    def disable(self,db):
        ns,audits=load(db)
        ns['disable_client_access']('client',None,db,SimpleNamespace(organization_id='org',user_id='actor'))
        return ns,audits
    def test_pending_only_revoked_and_audited(self):
        inv=invitation('i');db=RecordingDB([inv]);_,audits=self.disable(db)
        self.assertEqual((inv.status,inv.revoked_at,db.commits),('revoked',NOW,1))
        self.assertEqual(audits[0]['before']['pending_invitation_count'],1)
        self.assertEqual(audits[0]['after']['revoked_invitation_count'],1)
    def test_mixed_active_pending_preserves_accepted_and_revoked_history(self):
        rows=[invitation('pending'),invitation('accepted','accepted'),invitation('old','revoked')]
        link=access();db=RecordingDB(rows,[link]);self.disable(db)
        self.assertEqual([r.status for r in rows],['revoked','accepted','revoked'])
        self.assertEqual(rows[1].accepted_at,NOW);self.assertIsNone(rows[2].revoked_at)
        self.assertEqual(link.status,'revoked');self.assertEqual(db.commits,1)
    def test_empty_noop(self):
        db=RecordingDB();_,audits=self.disable(db)
        self.assertEqual(db.events,['invitations','accesses']);self.assertEqual(audits,[])
    def test_accepted_history_only_noop(self):
        inv=invitation('i','accepted');db=RecordingDB([inv]);self.disable(db)
        self.assertEqual(inv.status,'accepted');self.assertEqual(db.commits,0)
    def test_other_tenants_and_clients_untouched(self):
        rows=[invitation('target'),invitation('org',org='other'),invitation('client',client='other')]
        links=[access('target'),access('org',org='other'),access('client',client='other')]
        self.disable(RecordingDB(rows,links))
        self.assertEqual([r.status for r in rows],['revoked','pending','pending'])
        self.assertEqual([r.status for r in links],['revoked','active','active'])
    def test_revoked_token_rejected_by_actual_validator(self):
        db=RecordingDB([invitation('i')]);ns,_=self.disable(db)
        with self.assertRaises(HTTPException)as err:ns['_valid_invitation'](db,'synthetic',lock=True)
        self.assertEqual(err.exception.status_code,404)
    def test_invitation_lock_before_fresh_access_query_includes_accepted_rows(self):
        db=RecordingDB([invitation('z','accepted'),invitation('a')],[access()]);self.disable(db)
        sql,params=db.queries[0]
        self.assertIn('ORDER BY client_invitations.id ASC',sql);self.assertIn('FOR UPDATE',sql)
        self.assertNotIn('status_1',params);self.assertEqual(db.events[:2],['invitations','accesses'])
    def test_already_accepted_access_is_revoked(self):
        db=RecordingDB([invitation('i','accepted')],[access()]);self.disable(db)
        self.assertEqual(db.accesses[0].status,'revoked');self.assertEqual(db.invitations[0].status,'accepted')
    def test_repeated_disable_does_not_reaudit(self):
        db=RecordingDB([invitation('i')],[access()]);self.disable(db);_,audits=self.disable(db)
        self.assertEqual(db.commits,1);self.assertEqual(audits,[])

for stage in ['flush','audit','commit']:
    def test(self,stage=stage):
        inv=invitation('i');link=access();db=RecordingDB([inv],[link],failure=stage)
        with self.assertRaisesRegex(RuntimeError,'synthetic '+stage+' failure'):self.disable(db)
        self.assertEqual(db.commits,0)
        db.close_as_dependency()
        self.assertEqual((inv.status,link.status),('pending','active'))
    setattr(Tests,'test_'+stage+'_failure_propagates_without_successful_commit',test)
