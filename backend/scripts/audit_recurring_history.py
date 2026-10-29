"""Read-only recurring-expense historical audit. Never imports application settings.

An explicit AUDIT_DATABASE_URL is required; no .env or production defaults load.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from decimal import Decimal, ROUND_HALF_UP
import json
import os

from sqlalchemy import create_engine, text


TABLES = ('organizations', 'recurring_expenses', 'activity_logs', 'expenses',
          'financial_transactions', 'ledger_accounts', 'journal_entries', 'journal_lines')
LIMITS = [
    'Attribution is incomplete: expenses have no recurring schedule foreign key; retained activity logs, last-posted pointers and legacy cash descriptions are the evidence.',
    'Cash checks compare recorded expense outflows and original-currency GL cash legs, not bank statements or proof of payment.',
    'Voids/reversals, functional currency conversions, category changes, historical overdrafts and whole-account opening balances require separate reconciliation; no repair is proposed.',
    'Source-linked duplicates are detectable; unrelated/manual journals without a matching expense source ID cannot be attributed reliably.',
]


def load_snapshot(connection, organization_id):
    """Only SELECTs. Caller must start a PostgreSQL read-only snapshot first."""
    data = {}
    for table in TABLES:
        key = 'id' if table == 'organizations' else 'organization_id'
        data[table] = [dict(row) for row in connection.execute(
            text(f'SELECT * FROM {table} WHERE {key} = :org'), {'org': organization_id}
        ).mappings()]
    if not data['organizations']:
        raise ValueError('Organization not found')
    return data


def analyze(data):
    issues = []
    evidence = defaultdict(set)
    def issue(code, expense_id, **details):
        issues.append(dict(code=code, expense_id=expense_id, **details))
    for row in data['recurring_expenses']:
        if row['last_posted_expense_id']:
            evidence[row['last_posted_expense_id']].add('schedule_last_posted_pointer')
    for row in data['activity_logs']:
        if row['action'] in {'finance.recurring_expense.posted', 'finance.recurring_expense.auto_posted'} and row.get('outcome', 'success') == 'success':
            eid = (row['after_data'] or {}).get('expense_id')
            if eid:
                evidence[eid].add('activity_log')
    for row in data['financial_transactions']:
        if row['source_type'] == 'expense' and (row.get('description') or '').startswith(('Recurring expense ', 'Auto-posted recurring expense ')):
            evidence[row['source_id']].add('cash_description_heuristic')
    expenses = {row['id']: row for row in data['expenses']}
    ledgers = {row['id']: row for row in data['ledger_accounts']}
    journals = defaultdict(list)
    lines = defaultdict(list)
    cash = defaultdict(list)
    for row in data['journal_entries']:
        if row['source_type'] == 'expense_post':
            journals[row['source_id']].append(row)
    for row in data['journal_lines']:
        lines[row['journal_entry_id']].append(row)
    for row in data['financial_transactions']:
        if row['source_type'] == 'expense':
            cash[row['source_id']].append(row)
    checked = skipped = 0
    for eid in sorted(evidence):
        expense = expenses.get(eid)
        if expense is None:
            issue('attributed_expense_missing', eid)
            continue
        if expense['status'] != 'posted':
            skipped += 1
            issue('nonposted_requires_reversal_review', eid, status=expense['status'])
            continue
        checked += 1
        if expense['tax_amount'] < 0 or expense['tax_amount'] > expense['expense_amount']:
            issue('invalid_included_tax', eid)
        entries = journals[eid]
        if len(entries) > 1:
            issue('duplicate_source_journals', eid, journal_ids=[r['id'] for r in entries])
        posted = [r for r in entries if r['status'] == 'posted']
        if not posted:
            issue('missing_posted_journal', eid)
        transactions = cash[eid]
        if len(transactions) != 1:
            issue('cash_transaction_count', eid, count=len(transactions))
        for tx in transactions:
            if (tx['direction'], tx['account_id'], tx['currency'], tx['amount'], tx['transaction_date']) != (
                'debit', expense['account_id'], expense['account_currency'], expense['account_amount'], expense['expense_date']):
                issue('cash_transaction_mismatch', eid, transaction_id=tx['id'])
        for entry in posted:
            entry_lines = lines[entry['id']]
            debit = sum((r['debit'] for r in entry_lines), Decimal(0))
            credit = sum((r['credit'] for r in entry_lines), Decimal(0))
            if len(entry_lines) < 2 or debit <= 0 or debit != credit:
                issue('journal_unbalanced', eid, journal_id=entry['id'])
            for line in entry_lines:
                amount = line['debit'] if line['debit'] > 0 else line['credit']
                expected = (line['original_amount'] * line['exchange_rate_to_base']).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
                if (line['exchange_rate_to_base'] <= 0 or expected != amount
                    or (line['currency'] == entry['functional_currency'] and line['exchange_rate_to_base'] != 1)):
                    issue('journal_conversion_mismatch', eid, journal_id=entry['id'], line_id=line['id'])
            if entry['entry_date'] != expense['expense_date']:
                issue('journal_date_mismatch', eid, journal_id=entry['id'])
            cash_lines = [r for r in entry_lines if (ledgers.get(r['ledger_account_id'], {}).get('system_key') or '').startswith('financial_account:')]
            expected_key = 'financial_account:' + expense['account_id']
            if len(cash_lines) != 1 or any(
                ledgers[r['ledger_account_id']]['system_key'] != expected_key
                or r['currency'] != expense['account_currency']
                or r['original_amount'] != expense['account_amount']
                or r['credit'] <= 0 or r['debit'] != 0 for r in cash_lines
            ):
                issue('journal_cash_mismatch', eid, journal_id=entry['id'])
            noncash = [r for r in entry_lines if r not in cash_lines]
            if len(noncash) != 1 or any(
                r['currency'] != expense['expense_currency']
                or r['original_amount'] != expense['expense_amount']
                or r['debit'] <= 0 or r['credit'] != 0
                or ledgers.get(r['ledger_account_id'], {}).get('category') != 'expense'
                for r in noncash
            ):
                issue('journal_expense_mismatch', eid, journal_id=entry['id'])
    return dict(ok=not issues, stats=dict(attributed_expenses=len(evidence), checked_posted=checked, skipped_nonposted=skipped),
                attribution={key: sorted(value) for key, value in sorted(evidence.items())}, issues=issues, limits=LIMITS)


def audit_url(url, organization_id):
    engine = create_engine(url)
    if engine.dialect.name != 'postgresql':
        raise ValueError('PostgreSQL is required for enforced read-only transactions')
    try:
        with engine.connect() as connection:
            with connection.begin():
                connection.execute(text('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY'))
                connection.execute(text("SET LOCAL statement_timeout = '60s'"))
                report = analyze(load_snapshot(connection, organization_id))
                report['transaction_read_only'] = connection.scalar(text('SHOW transaction_read_only'))
                report['organization_id'] = organization_id
                return report
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--organization-id', required=True)
    args = parser.parse_args()
    url = os.environ.get('AUDIT_DATABASE_URL')
    if not url:
        parser.error('AUDIT_DATABASE_URL must explicitly select an authorized database; no defaults are used')
    report = audit_url(url, args.organization_id)
    print(json.dumps(report, indent=2, sort_keys=True, default=str))
    raise SystemExit(0 if report['ok'] else 1)


if __name__ == '__main__':
    main()
