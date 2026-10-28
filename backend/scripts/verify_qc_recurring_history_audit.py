"""Synthetic-only PostgreSQL audit demonstration; preserves a labeled fixture.

No app startup, provider, scheduler, repair, or production default is used.
"""
import copy
from datetime import date
from decimal import Decimal as D
import json
import os
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError

from scripts.audit_recurring_history import analyze, audit_url, load_snapshot
from app.models import (ActivityLog, Expense, ExpenseCategory, FinancialAccount,
                        FinancialTransaction, JournalEntry, JournalLine, LedgerAccount,
                        Organization, RecurringExpense, User)


def main():
    assert os.environ.get('ENVIRONMENT') == 'test'
    engine = create_engine(os.environ['DATABASE_URL'])
    assert engine.url.host in {'localhost', '127.0.0.1'} and engine.url.port == 55433
    assert (engine.url.database or '').startswith('business_os_qc_expanded20261022')
    marker = uuid4().hex[:10]
    today = date(2026, 10, 22)
    with Session(engine) as db:
        user = User(email=f'audit-{marker}@example.invalid', full_name='Synthetic audit fixture', is_active=True)
        db.add(user); db.flush()
        org = Organization(name=f'QC PRESERVED recurring history audit {marker}', slug=f'qc-recurring-audit-{marker}', currency='USD', created_by_user_id=user.id)
        db.add(org); db.flush(); oid = org.id
        account = FinancialAccount(organization_id=oid, name='Synthetic audit cash', currency='USD', opening_balance=D(1000), created_by_user_id=user.id)
        category = ExpenseCategory(organization_id=oid, name='Synthetic audit costs', slug='synthetic-audit')
        db.add_all([account, category]); db.flush()
        cash_gl = LedgerAccount(organization_id=oid, code='QC100', name='Synthetic cash GL', category='asset', normal_balance='debit', system_key='financial_account:'+account.id)
        expense_gl = LedgerAccount(organization_id=oid, code='QC600', name='Synthetic expense GL', category='expense', normal_balance='debit', system_key='operating_expenses')
        db.add_all([cash_gl, expense_gl]); db.flush()
        cases = {}
        for name in ['valid', 'missing_gl', 'wrong_cash', 'wrong_journal', 'invalid_tax']:
            expense = Expense(organization_id=oid, expense_number='QC-'+name, category_id=category.id, account_id=account.id,
                description='Synthetic '+name, expense_date=today, expense_currency='USD', expense_amount=D(10), account_currency='USD',
                account_amount=D(10), exchange_rate=D(1), profitability_currency='USD', profitability_amount=D(10),
                profitability_exchange_rate=D(1), tax_amount=D(11) if name == 'invalid_tax' else D(1), created_by_user_id=user.id)
            db.add(expense); db.flush(); cases[name] = expense.id
            db.add(ActivityLog(organization_id=oid, action='finance.recurring_expense.auto_posted', after_data={'expense_id':expense.id}))
            db.add(FinancialTransaction(organization_id=oid, account_id=account.id, transaction_date=today, direction='debit',
                amount=D(9) if name == 'wrong_cash' else D(10), currency='USD', source_type='expense', source_id=expense.id,
                description='Auto-posted recurring expense '+expense.expense_number, created_by_user_id=user.id))
            if name != 'missing_gl':
                entry = JournalEntry(organization_id=oid, entry_number='QC-'+name, entry_date=today, functional_currency='USD',
                    source_type='expense_post', source_id=expense.id, created_by_user_id=user.id, posted_by_user_id=user.id)
                db.add(entry); db.flush()
                db.add_all([
                    JournalLine(organization_id=oid, journal_entry_id=entry.id, ledger_account_id=cash_gl.id, currency='USD', credit=D(10), original_amount=D(9) if name == 'wrong_journal' else D(10)),
                    JournalLine(organization_id=oid, journal_entry_id=entry.id, ledger_account_id=expense_gl.id, currency='USD', debit=D(10), original_amount=D(10)),
                ])
        # Valid expense also linked by a pointer, testing deduplication of three attribution sources.
        db.add(RecurringExpense(organization_id=oid, name='Synthetic latest pointer', description='Synthetic audit', category_id=category.id,
            account_id=account.id, expense_currency='USD', expense_amount=D(10), frequency='monthly', next_due_date=today,
            last_posted_expense_id=cases['valid'], created_by_user_id=user.id))
        db.commit()
    report = audit_url(os.environ['DATABASE_URL'], oid)
    expected = {'missing_gl': 'missing_posted_journal', 'wrong_cash': 'cash_transaction_mismatch',
                'wrong_journal': 'journal_cash_mismatch', 'invalid_tax': 'invalid_included_tax'}
    assert report['transaction_read_only'] == 'on'
    assert report['stats']['checked_posted'] == 5
    assert {(i['expense_id'], i['code']) for i in report['issues']} == ({(cases[k],v) for k,v in expected.items()} | {(cases['wrong_journal'], 'journal_conversion_mismatch')}), report
    assert len(report['attribution'][cases['valid']]) == 3
    with engine.connect() as conn:
        with conn.begin():
            conn.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
            snapshot = load_snapshot(conn, oid)
    # Mutation-based unit scenarios operate on copies, not database constraints/data.
    clean = copy.deepcopy(snapshot)
    eid = cases['valid']
    clean['activity_logs'] = [r for r in clean['activity_logs'] if r['after_data']['expense_id'] == eid]
    clean['financial_transactions'] = [r for r in clean['financial_transactions'] if r['source_id'] == eid]
    assert analyze(clean)['ok']
    duplicate = copy.deepcopy(clean)
    entry = next(r for r in duplicate['journal_entries'] if r['source_id'] == eid)
    entry = dict(entry, id='synthetic-duplicate'); duplicate['journal_entries'].append(entry)
    assert 'duplicate_source_journals' in {i['code'] for i in analyze(duplicate)['issues']}
    # Current unique source index prevents physical duplicate source journals; do not weaken it.
    for mutation, code in [('cash_missing','cash_transaction_count'), ('unbalanced','journal_unbalanced'), ('void','nonposted_requires_reversal_review')]:
        data = copy.deepcopy(clean)
        if mutation == 'cash_missing': data['financial_transactions'] = []
        if mutation == 'unbalanced':
            target = next(r for r in data['journal_entries'] if r['source_id'] == eid)
            line = next(r for r in data['journal_lines'] if r['journal_entry_id'] == target['id'] and r['debit'] > 0)
            line['debit'] = D(8)
        if mutation == 'void': next(r for r in data['expenses'] if r['id'] == eid)['status'] = 'void'
        assert code in {i['code'] for i in analyze(data)['issues']}, mutation
    # The database itself rejects writes, even an UPDATE matching no rows.
    try:
        with engine.connect() as conn:
            with conn.begin():
                conn.execute(text('SET TRANSACTION READ ONLY'))
                conn.execute(text('UPDATE expenses SET description=description WHERE false'))
        raise AssertionError('PostgreSQL failed to enforce read-only')
    except DBAPIError as exc:
        assert getattr(exc.orig, 'sqlstate', None) == '25006'
    print(json.dumps({'result':'PASS', 'organization_id':oid, 'fixture':'preserved synthetic only',
        'database_cases':expected, 'valid_case':'zero findings', 'in_memory_cases':['duplicate journal','missing cash','unbalanced journal','void review'],
        'database_read_only_enforced':True, 'report':report}, default=str, indent=2))
    engine.dispose()


if __name__ == '__main__':
    main()
