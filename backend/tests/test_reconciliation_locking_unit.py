"""Actual handler/query contracts with fake sessions; no database concurrency proof."""
from datetime import date
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace as NS
from typing import get_args
import hashlib
import re
import socket
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Engine
from app.api.v1 import accounting_reconciliation as api
from app.models.reconciliation import BankReconciliation, BankReconciliationItem

ROOT = Path(__file__).resolve().parents[1]
ORIGINAL_HASH = '710b63a9cf3ec4b7c1f9394453bb1fea502ed8ce3999d6ddc83ec8057f6b550f'


def account():
    return NS(id='account-a', organization_id='org-a', opening_balance=Decimal('10.00'))


def session(**changes):
    values = dict(id='recon-a', organization_id='org-a', account_id='account-a',
        status='draft', statement_start_date=None, statement_end_date=date(2026, 1, 31),
        statement_ending_balance=Decimal('10.00'), difference=Decimal('0.00'),
        cleared_book_balance=Decimal('10.00'), finalized_at=None, finalized_by_user_id=None)
    values.update(changes)
    return NS(**values)


class FakeDB:
    def __init__(self, responses):
        self.responses = list(responses)
        self.queries = []
        self.events = []
        self.added = []
        self.deleted = []

    def scalar(self, query):
        compiled = query.compile(dialect=postgresql.dialect())
        self.queries.append((str(compiled), compiled.params, query.get_execution_options()))
        self.events.append(('query', str(compiled)))
        if not self.responses:
            raise AssertionError('Unexpected query: ' + str(compiled))
        return self.responses.pop(0)

    def add(self, item):
        item.id = 'created-id'
        self.added.append(item)
        self.events.append(('add', type(item).__name__))

    def delete(self, item):
        self.deleted.append(item)
        self.events.append(('delete', type(item).__name__))

    def flush(self):
        self.events.append(('flush',))

    def commit(self):
        self.events.append(('commit',))


class ReconciliationLockTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.object(Engine, 'connect', side_effect=AssertionError('Database prohibited')).start()
        patch.object(socket.socket, 'connect', side_effect=AssertionError('Network prohibited')).start()
        self.tenant = NS(organization_id='org-a', user_id='actor-a')
        self.activity = patch.object(api, 'record_activity').start()
        self.refresh = patch.object(api, 'refresh_totals').start()
        self.read = patch.object(api, 'row_json', side_effect=lambda db, row: {
            'id': row.id, 'status': row.status, 'matched_transactions': 3,
            'account_name': 'Synthetic account', 'statement_end_date': str(row.statement_end_date),
        }).start()

    def existing(self, row=None, extra=()):
        return FakeDB(['account-a', account(), row or session(), *extra])

    def expect(self, status, fn):
        with self.assertRaises(HTTPException) as caught:
            fn()
        self.assertEqual(caught.exception.status_code, status)
        return caught.exception

    def assert_locks(self, db):
        self.assertGreaterEqual(len(db.queries), 3)
        discovery, account_lock, row_lock = db.queries[:3]
        self.assertIn('SELECT bank_reconciliations.account_id', discovery[0])
        self.assertNotIn('FOR UPDATE', discovery[0])
        for query in (account_lock, row_lock):
            self.assertIn('FOR UPDATE', query[0])
            self.assertTrue(query[2]['populate_existing'])
            self.assertIn('org-a', query[1].values())
        self.assertIn('financial_accounts', account_lock[0])
        self.assertIn('bank_reconciliations', row_lock[0])
        self.assertIn('recon-a', row_lock[1].values())
        self.assertIn('account-a', row_lock[1].values())

    def test_account_lock_is_tenant_scoped_and_refreshes_identity(self):
        for org in ('org-a', 'org-b'):
            with self.subTest(org=org):
                a = account(); db = FakeDB([a])
                self.assertIs(api._locked_account_or_404(db, org, 'account-a'), a)
                sql, params, options = db.queries[0]
                self.assertIn('FOR UPDATE', sql)
                self.assertIn(org, params.values())
                self.assertIn('account-a', params.values())
                self.assertTrue(options['populate_existing'])

    def test_missing_account_does_not_continue(self):
        db = FakeDB([None])
        self.expect(404, lambda: api._locked_account_or_404(db, 'org-a', 'unknown'))
        self.assertEqual(len(db.queries), 1)

    def test_existing_lock_order_and_returned_identity(self):
        fresh = session(status='finalized'); db = self.existing(fresh)
        self.assertIs(api._locked_reconciliation_or_404(db, 'org-a', 'recon-a'), fresh)
        self.assert_locks(db)

    def test_discovery_is_tenant_scoped_before_account_lookup(self):
        db = FakeDB([None])
        self.expect(404, lambda: api._locked_reconciliation_or_404(db, 'org-b', 'recon-a'))
        self.assertIn('org-b', db.queries[0][1].values())
        self.assertEqual(len(db.queries), 1)

    def test_account_missing_after_discovery_stops_before_row_lock(self):
        db = FakeDB(['account-a', None])
        self.expect(404, lambda: api._locked_reconciliation_or_404(db, 'org-a', 'recon-a'))
        self.assertEqual(len(db.queries), 2)

    def test_discarded_while_waiting_returns404_after_requery(self):
        db = FakeDB(['account-a', account(), None])
        self.expect(404, lambda: api._locked_reconciliation_or_404(db, 'org-a', 'recon-a'))
        self.assert_locks(db)

    def test_all_existing_writers_recheck_fresh_finalized_identity(self):
        for name in ('select_transaction', 'unselect_transaction', 'finalize', 'discard_reconciliation'):
            with self.subTest(name=name):
                db = self.existing(session(status='finalized'))
                args = ('recon-a', 'tx-a', None, db, self.tenant) if 'transaction' in name else ('recon-a', None, db, self.tenant)
                if name == 'finalize':
                    self.assertEqual(getattr(api, name)(*args)['status'], 'finalized')
                else:
                    self.expect(409, lambda: getattr(api, name)(*args))
                self.assert_locks(db)
                self.assertEqual(db.added, [])
                self.assertEqual(db.deleted, [])
                self.assertNotIn(('commit',), db.events)
        self.activity.assert_not_called()

    def test_create_locks_account_before_draft_check(self):
        db = FakeDB([account(), 'other-draft'])
        self.expect(409, lambda: api.create_reconciliation(self.payload(), None, db, self.tenant))
        self.assertIn('FOR UPDATE', db.queries[0][0])
        self.assertTrue(db.queries[0][2]['populate_existing'])
        self.assertIn('draft', db.queries[1][1].values())
        self.assertFalse(db.added)

    def payload(self, **changes):
        values = dict(account_id='account-a', statement_end_date='2026-01-31', statement_ending_balance='-1.005', notes='Synthetic')
        values.update(changes)
        return api.ReconciliationCreate(**values)

    def test_create_preserves_signed_half_up_and_first_period_start(self):
        db = FakeDB([account(), None, None])
        result = api.create_reconciliation(self.payload(), None, db, self.tenant)
        self.assertEqual(result['id'], 'created-id')
        row = db.added[0]
        self.assertIsInstance(row, BankReconciliation)
        self.assertEqual(row.statement_ending_balance, Decimal('-1.01'))
        self.assertIsNone(row.statement_start_date)
        self.assertEqual(row.notes, 'Synthetic')
        self.assertEqual(row.created_by_user_id, 'actor-a')
        self.assertEqual(row.organization_id, 'org-a')
        self.assertEqual(self.activity.call_args.kwargs['action'], 'accounting.reconciliation.create')
        self.assertEqual(db.events[-1], ('commit',))

    def test_create_derives_start_after_last_finalized(self):
        db = FakeDB([account(), None, session(statement_end_date=date(2025, 12, 31))])
        api.create_reconciliation(self.payload(statement_ending_balance='0'), None, db, self.tenant)
        self.assertEqual(db.added[0].statement_start_date, date(2026, 1, 1))
        self.assertEqual(db.added[0].statement_ending_balance, Decimal('0.00'))

    def test_create_preserves_explicit_supported_start(self):
        db = FakeDB([account(), None, None])
        api.create_reconciliation(self.payload(statement_start_date='2026-01-03'), None, db, self.tenant)
        self.assertEqual(db.added[0].statement_start_date, date(2026, 1, 3))

    def test_create_rechecks_last_finalized_period_after_lock(self):
        for end in ('2026-01-31', '2026-01-30'):
            with self.subTest(end=end):
                db = FakeDB([account(), None, session()])
                self.expect(409, lambda: api.create_reconciliation(self.payload(statement_end_date=end), None, db, self.tenant))
                self.assertIn('FOR UPDATE', db.queries[0][0])
                self.assertFalse(db.added)

    def test_create_start_after_end_still400(self):
        db = FakeDB([account(), None, None])
        self.expect(400, lambda: api.create_reconciliation(self.payload(statement_start_date='2026-02-01'), None, db, self.tenant))
        self.assertFalse(db.added)

    def test_match_eligible_lookup_after_locks(self):
        db = self.existing(extra=(None,))
        self.expect(404, lambda: api.select_transaction('recon-a', 'tx-a', None, db, self.tenant))
        self.assert_locks(db)
        sql, params, _ = db.queries[3]
        self.assertIn('financial_transactions.account_id', sql)
        self.assertIn('financial_transactions.transaction_date <=', sql)
        self.assertIn('org-a', params.values())
        self.assertIn('tx-a', params.values())

    def test_same_match_is_noop_without_duplicate_activity_or_commit(self):
        db = self.existing(extra=(NS(id='tx-a'), NS(reconciliation_id='recon-a')))
        self.assertEqual(api.select_transaction('recon-a', 'tx-a', None, db, self.tenant)['id'], 'recon-a')
        self.assert_locks(db)
        self.assertFalse(db.added)
        self.activity.assert_not_called()
        self.assertNotIn(('commit',), db.events)

    def test_other_session_match_conflict_remains409(self):
        db = self.existing(extra=(NS(id='tx-a'), NS(reconciliation_id='other')))
        self.expect(409, lambda: api.select_transaction('recon-a', 'tx-a', None, db, self.tenant))
        self.assertFalse(db.added)

    def test_match_records_only_selection_once(self):
        db = self.existing(extra=(NS(id='tx-a'), None))
        api.select_transaction('recon-a', 'tx-a', None, db, self.tenant)
        self.assert_locks(db)
        self.assertEqual(len(db.added), 1)
        self.assertIsInstance(db.added[0], BankReconciliationItem)
        self.assertEqual(db.added[0].financial_transaction_id, 'tx-a')
        self.assertEqual(db.added[0].organization_id, 'org-a')
        self.assertEqual(self.activity.call_args.kwargs['action'], 'accounting.reconciliation.match')
        self.assertEqual(db.events[-1], ('commit',))

    def test_unmatch_absent_is_noop(self):
        db = self.existing(extra=(None,))
        self.assertIsNone(api.unselect_transaction('recon-a', 'tx-a', None, db, self.tenant))
        self.assert_locks(db)
        self.assertFalse(db.deleted)
        self.activity.assert_not_called()

    def test_unmatch_deletes_only_item_and_commits(self):
        item = NS(id='item-a'); db = self.existing(extra=(item,))
        api.unselect_transaction('recon-a', 'tx-a', None, db, self.tenant)
        self.assertEqual(db.deleted, [item])
        self.assertEqual(self.activity.call_args.kwargs['action'], 'accounting.reconciliation.unmatch')
        self.assertEqual(db.events[-1], ('commit',))

    def test_finalize_recalculates_before_zero_check(self):
        row = session(); db = self.existing(row)
        self.refresh.side_effect = lambda db, r: setattr(r, 'difference', Decimal('0.01'))
        self.expect(409, lambda: api.finalize('recon-a', None, db, self.tenant))
        self.assert_locks(db)
        self.assertEqual(len(db.queries), 3)
        self.assertEqual(row.status, 'draft')

    def test_finalize_later_period_still409(self):
        db = self.existing(extra=('later-id',))
        self.expect(409, lambda: api.finalize('recon-a', None, db, self.tenant))
        self.assert_locks(db)
        self.assertIn('statement_end_date >=', db.queries[3][0])
        self.activity.assert_not_called()

    def test_finalize_preserves_actor_time_activity_and_commit(self):
        row = session(); db = self.existing(row, extra=(None,))
        self.assertEqual(api.finalize('recon-a', None, db, self.tenant)['status'], 'finalized')
        self.assertEqual(row.finalized_by_user_id, 'actor-a')
        self.assertIsNotNone(row.finalized_at.tzinfo)
        self.assertEqual(self.activity.call_args.kwargs['action'], 'accounting.reconciliation.finalize')
        self.assertEqual(db.events[-1], ('commit',))

    def test_discard_uses_same_order_and_only_deletes_parent(self):
        row = session(); db = self.existing(row)
        self.assertIsNone(api.discard_reconciliation('recon-a', None, db, self.tenant))
        self.assert_locks(db)
        self.assertEqual(db.deleted, [row])
        self.assertFalse(db.added)
        self.assertEqual(self.activity.call_args.kwargs['after']['matched_transactions_removed'], 3)
        self.assertEqual(db.events[-1], ('commit',))


class ReconciliationCompatibilityTests(unittest.TestCase):
    def test_exact_original_source_reconstruction_outside_lock_seams(self):
        source = (ROOT/'app/api/v1/accounting_reconciliation.py').read_text()
        source, count = re.subn(r'# BEGIN RECONCILIATION WRITE LOCKS\n.*?# END RECONCILIATION WRITE LOCKS\n\n\n', '', source, flags=re.S)
        self.assertEqual(count, 1)
        source = source.replace('account = _locked_account_or_404(db, tenant.organization_id, payload.account_id)', 'account = account_or_404(db, tenant.organization_id, payload.account_id)')
        start = source.index('def discard_reconciliation(')
        prefix, discard = source[:start], source[start:]
        prefix = prefix.replace('row = _locked_reconciliation_or_404(db, tenant.organization_id, reconciliation_id)', 'row = reconciliation_or_404(db, tenant.organization_id, reconciliation_id)')
        old = '''    row = db.scalar(
        select(BankReconciliation)
        .where(
            BankReconciliation.id == reconciliation_id,
            BankReconciliation.organization_id == tenant.organization_id,
        )
        .with_for_update()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Reconciliation not found")
'''
        discard = discard.replace('    row = _locked_reconciliation_or_404(db, tenant.organization_id, reconciliation_id)\n', old)
        self.assertEqual(hashlib.sha256((prefix+discard).encode()).hexdigest(), ORIGINAL_HASH)

    def test_exact_permission_dependencies_remain_independent(self):
        for alias, required in ((api.Viewer, 'finance.view'), (api.Manager, 'finance.manage')):
            checker = get_args(alias)[1].dependency
            for permissions, permitted in (([], False), ([required], True), (['*'], True), (['finance.manage' if required=='finance.view' else 'finance.view'], False)):
                with self.subTest(required=required, permissions=permissions):
                    tenant = NS(organization_role=NS(is_active=True, permissions=permissions))
                    if permitted:
                        self.assertIs(checker(None, tenant), tenant)
                    else:
                        with self.assertRaises(HTTPException) as caught: checker(None, tenant)
                        self.assertEqual(caught.exception.status_code, 403)

    def test_signed_half_up_unchanged(self):
        for value, expected in (('-1.005','-1.01'),('0','0.00'),('0.005','0.01'),('9999999999999999.99','9999999999999999.99')):
            with self.subTest(value=value): self.assertEqual(api.money(value), Decimal(expected))
        self.assertEqual(api.tx_effect('credit', Decimal('12.20')), Decimal('12.20'))
        self.assertEqual(api.tx_effect('debit', Decimal('12.20')), Decimal('-12.20'))

    def test_actual_public_route_owners_and_status_codes(self):
        from app.api.v1.router import api_router
        expected = {
            ('GET', '/accounting/reconciliations/meta'): ('reconciliation_meta_fast', 200),
            ('GET', '/accounting/reconciliations'): ('list_reconciliations_fast', 200),
            ('GET', '/accounting/reconciliations/{reconciliation_id}'): ('detail', 200),
            ('POST', '/accounting/reconciliations'): ('create_reconciliation', 201),
            ('POST', '/accounting/reconciliations/{reconciliation_id}/transactions/{transaction_id}'): ('select_transaction', 201),
            ('DELETE', '/accounting/reconciliations/{reconciliation_id}/transactions/{transaction_id}'): ('unselect_transaction', 204),
            ('POST', '/accounting/reconciliations/{reconciliation_id}/finalize'): ('finalize', 200),
            ('DELETE', '/accounting/reconciliations/{reconciliation_id}'): ('discard_reconciliation', 204),
        }
        def effective_routes(routes):
            for route in routes:
                if hasattr(route, 'effective_candidates'):
                    yield from effective_routes(route.effective_candidates())
                else:
                    yield route
        mounted = list(effective_routes(api_router.routes))
        for (verb, path), (name, code) in expected.items():
            with self.subTest(method=verb, path=path):
                routes = [r for r in mounted if getattr(r, 'path', None) == path and verb in (getattr(r, 'methods', None) or set())]
                self.assertEqual(len(routes), 1)
                self.assertEqual(routes[0].endpoint.__name__, name)
                original = getattr(routes[0], 'original_route', routes[0])
                self.assertEqual(original.status_code or 200, code)

    def test_historical_total_drift_is_preserved_not_claimed_fixed(self):
        from unittest.mock import MagicMock
        db = MagicMock(); db.scalar.return_value = NS(opening_balance=Decimal('0'))
        january = session(statement_ending_balance=Decimal('100'), status='finalized')
        db.execute.return_value.all.return_value = [('credit', Decimal('100'))]
        self.assertEqual(api.cleared_balance(db, january), Decimal('100.00'))
        # A later finalized session can select an older January transaction.
        # This fake result demonstrates the existing formula, not a DB race.
        db.execute.return_value.all.return_value = [('credit', Decimal('100')), ('credit', Decimal('10'))]
        self.assertEqual(api.cleared_balance(db, january), Decimal('110.00'))
        api.refresh_totals(db, january)
        self.assertEqual(january.difference, Decimal('-10.00'))
        query = db.execute.call_args.args[0]
        sql = str(query.compile(dialect=postgresql.dialect()))
        self.assertIn('financial_transactions.transaction_date <=', sql)
        self.assertNotIn('bank_reconciliations.statement_end_date <=', sql)

    def test_read_caps_and_historical_formula_remain_byte_pinned(self):
        expected = {
            'app/api/v1/accounting_read_fast.py':'5f6218432a7a2188ce08c25f89317c0c3498c88f031bdf2c7b615d5be0092867',
            'app/models/reconciliation.py':'2319d2bc221ffbeb2ba10a2d693d9598eefae0c7fd0a1a8cd50317dcca1c2827',
            'app/schemas/accounting_reconciliation.py':'248cf0484c0bd8bbe4f5aeea606b78ed3b99c6e00bd2b035e931ea2a64886bb2',
        }
        for name, digest in expected.items():
            with self.subTest(path=name): self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(), digest)


if __name__ == '__main__': unittest.main()
