"""Exact FIN22/FIN38 gaps: authenticated API, real isolated PostgreSQL, rollback.

Only get_db is overridden. Domain fixtures use the real owner HTTP routes; no
lifespan, network providers, auth mocks or ledger overrides. FIN29 has a separate
real Chromium journey in qc-owner-ledger-statements.spec.mjs.
"""
from datetime import date, timedelta
from decimal import Decimal as D
from urllib.parse import urlencode
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import SessionLocal, engine, get_db
from app.main import app
from app.models.accounting import JournalEntry, JournalLine, LedgerAccount
from app.models.organization import Organization
from app.models.user import User
from app.services.activity_log import record_activity


def amounts(row, **expected):
    for key, value in expected.items():
        assert D(str(row[key])) == D(str(value)), (key, row, expected)


def assert_test_database(environment, url):
    assert environment == 'test', 'Explicit test environment required'
    assert url.get_backend_name() == 'postgresql', 'PostgreSQL required'
    assert url.host in {'localhost', '127.0.0.1'}, 'Loopback PostgreSQL only'
    name = url.database or ''
    assert name == 'codestation_business_os' or name.startswith('business_os_qc'), 'Use an isolated QC or CI database'


def main():
    assert_test_database(settings.environment, engine.url)
    assert not app.dependency_overrides
    conn = engine.connect()
    outer = conn.begin()
    db = SessionLocal(bind=conn, join_transaction_mode='create_savepoint')
    orgs, users = [], []
    marker = uuid4().hex[:10]
    today = date.today().isoformat()

    def local_db():
        with SessionLocal(bind=conn, join_transaction_mode='create_savepoint') as session:
            yield session

    app.dependency_overrides[get_db] = local_db
    http = TestClient(app)
    headers = {}

    def call(method, path, payload=None, expected=200):
        response = http.request(method, '/api/v1' + path, headers=headers, json=payload)
        assert response.status_code == expected, (method, path, response.status_code, response.text)
        return response.json()

    def post(path, payload=None, expected=201):
        return call('POST', path, payload, expected)

    def snapshot():
        db.expire_all()
        result = {}
        for table in Organization.metadata.sorted_tables:
            if 'organization_id' in table.c:
                rows = db.execute(select(table).where(table.c.organization_id.in_(orgs))).all()
                result[table.name] = sorted(repr(tuple(row)) for row in rows)
        db.rollback()
        return result

    def guard(path, payload, expected=409):
        before = snapshot()
        result = post(path, payload, expected)
        assert snapshot() == before, ('Rejected request changed stored state', path)
        return result

    def workspace(label):
        result = post('/organizations', {'name': f'QC statement chain {label} {marker}', 'currency': 'USD', 'country_code': 'US', 'timezone': 'UTC'})['organization']
        orgs.append(result['id'])
        headers['X-Organization-ID'] = result['id']
        return result

    def account(name, opening='0'):
        return post('/finance/accounts', {'name': name, 'account_type': 'bank', 'currency': 'USD', 'opening_balance': opening})

    def account_state(account_id):
        return next(row for row in call('GET', '/finance/accounts') if row['id'] == account_id)

    def ledger_rows(account_id, **filters):
        rows, cursors = [], set()
        query = {'limit': 3, **filters}
        while True:
            result = call('GET', f'/finance/accounts/{account_id}/ledger-page?' + urlencode(query))
            rows.extend(result['items'])
            cursor = result['next_cursor']
            if cursor is None:
                break
            assert cursor not in cursors
            cursors.add(cursor)
            query['cursor'] = cursor
        assert len({row['id'] for row in rows}) == len(rows), 'Pagination duplicated a movement'
        return rows

    def tb():
        return call('GET', '/accounting/trial-balance?as_of=' + today)

    def ledger_balance(key):
        value = db.scalar(select(func.coalesce(func.sum(JournalLine.debit - JournalLine.credit), 0)).join(LedgerAccount, LedgerAccount.id == JournalLine.ledger_account_id).where(JournalLine.organization_id == headers['X-Organization-ID'], LedgerAccount.system_key == key))
        db.rollback()
        return D(value)

    try:
        user = User(email=f'qc-statement-chain-{marker}@example.invalid', full_name='Synthetic owner statement QC', is_active=True, is_verified=True)
        db.add(user)
        db.flush()
        users.append(user.id)
        record_activity(db, action='qc.statement_chain.fixture', scope='system', actor_type='system')
        db.commit()
        headers['Authorization'] = 'Bearer ' + create_access_token(user.id, int(user.auth_token_version or 0))
        workspace('FIN22')
        income = post('/accounting/chart-of-accounts', {'code': 'QCINC', 'name': 'Synthetic statement income', 'category': 'income', 'normal_balance': 'credit'})
        expense = post('/accounting/chart-of-accounts', {'code': 'QCEXP', 'name': 'Synthetic statement expense', 'category': 'expense', 'normal_balance': 'debit'})

        def statement_fixture(label, opening, movements, expected_running):
            bank = account(label, str(opening))
            expected_rows = []
            for index, (kind, value) in enumerate(movements):
                day = (date(2026, 10, 1) + timedelta(days=index)).isoformat()
                reference = f'{label}-ROW-{index + 1:02}'
                entry = post('/accounting/money', {'kind': kind, 'entry_date': day, 'financial_account_id': bank['id'], 'category_ledger_account_id': (income if kind == 'income' else expense)['id'], 'amount': str(value), 'description': reference, 'reference': reference})
                expected_rows.append((entry['id'], day, 'credit' if kind == 'income' else 'debit', D(str(value)), reference))
                # Every intermediate book balance is independently read back, not
                # just computed after the final mutation.
                amounts(account_state(bank['id']), current_balance=expected_running[index])
            state = account_state(bank['id'])
            amounts(state, opening_balance=opening, current_balance=expected_running[-1])
            rows = ledger_rows(bank['id'])
            assert len(rows) == len(movements)
            chronological = list(reversed(rows))
            running = D(str(opening))
            actual_running = []
            for actual, expected in zip(chronological, expected_rows, strict=True):
                source_id, day, direction, value, reference = expected
                assert (actual['source_id'], actual['transaction_date'], actual['direction'], D(actual['amount']), actual['reference']) == expected
                running += value if direction == 'credit' else -value
                actual_running.append(running)
            assert actual_running == list(map(lambda n: D(str(n)), expected_running))
            incoming = sum((D(row['amount']) for row in rows if row['direction'] == 'credit'), D(0))
            outgoing = sum((D(row['amount']) for row in rows if row['direction'] == 'debit'), D(0))
            assert D(str(opening)) + incoming - outgoing == D(state['current_balance'])
            assert {row['id'] for row in rows} == {row['id'] for row in call('GET', f'/finance/accounts/{bank["id"]}/ledger?limit=500')}
            first_reference = expected_rows[0][-1]
            matches = ledger_rows(bank['id'], search=first_reference, direction='credit', date_from='2026-10-01', date_to='2026-10-01')
            assert len(matches) == 1 and matches[0]['source_id'] == expected_rows[0][0]
            assert ledger_rows(bank['id'], search=first_reference, direction='debit') == []
            assert ledger_rows(bank['id'], date_to='2026-09-30') == []
            assert ledger_rows(bank['id'], date_from='2026-10-20') == []
            assert ledger_rows(bank['id'], search='NEVER-PRESENT-' + marker) == []
            money_out = ledger_rows(bank['id'], direction='debit')
            assert sum((D(row['amount']) for row in money_out), D(0)) == outgoing
            assert all(row['direction'] == 'debit' for row in money_out)
            source_type = matches[0]['source_type']
            source_rows = ledger_rows(bank['id'], source_type=source_type)
            assert source_rows and all(row['source_type'] == source_type for row in source_rows)
            bounded = ledger_rows(bank['id'], date_from='2026-10-02', date_to='2026-10-03')
            assert {row['source_id'] for row in bounded} == {row[0] for row in expected_rows[1:3]}
            # Clear all filters restores exactly the original ordered statement.
            assert ledger_rows(bank['id']) == rows
            print(f'PASS FIN22 {label}: opening={opening}; {len(rows)} movements across cursor pages; incoming={incoming}; outgoing={outgoing}; running={actual_running}; closing={state["current_balance"]}; exact search/source/direction/inclusive dates/empty history/reset', flush=True)

        statement_fixture('Cash-A', 0, [('income', 80), ('income', 120), ('expense', 10), ('expense', 20), ('expense', 25)], [80, 200, 190, 170, 145])
        statement_fixture('Cash-B', 0, [('income', 100), ('income', 50), ('income', 40), ('income', 20), ('income', 10), ('income', '5.55'), ('income', 22), ('expense', 100), ('expense', 40), ('expense', 20), ('expense', 10), ('expense', 8), ('expense', 5), ('expense', 2)], [100, 150, 190, 210, 220, '225.55', '247.55', '147.55', '107.55', '87.55', '77.55', '69.55', '64.55', '62.55'])
        statement_fixture('Opening-25', 25, [('income', 30), ('expense', 10)], [55, 45])

        workspace('FIN38')
        bank = account('Synthetic replacement receipt bank')
        customer = post('/crm/clients', {'display_name': 'Synthetic replacement receipt client', 'currency': 'USD'})
        advance = post('/accounting/customer-advances', {'client_id': customer['id'], 'financial_account_id': bank['id'], 'advance_date': today, 'amount': '10', 'reference': 'EXISTING-ADVANCE-10'})
        invoice = post('/finance/invoices', {'client_id': customer['id'], 'issue_date': today, 'currency': 'USD', 'items': [{'item_name': 'Synthetic service', 'description': 'Original report invoice200 chain', 'quantity': '1', 'unit_price': '200'}]})
        path = '/finance/invoices/' + invoice['id']
        call('PATCH', path + '/status', {'action': 'send'})

        def checkpoint(label, paid, due, cash, advance_left, gross, status):
            detail = call('GET', path)
            amounts(detail, total=200, amount_paid=paid, balance_due=due)
            assert detail['status'] == status
            amounts(account_state(bank['id']), current_balance=cash)
            assert ledger_balance('accounts_receivable') == D(str(due))
            assert ledger_balance('customer_advances') == -D(str(advance_left))
            amounts(tb(), total_debit=gross, total_credit=gross)
            statements = call('GET', f'/accounting/reports/financial-statements?date_from={today}&date_to={today}')
            amounts(statements, total_income=200, total_expenses=0, net_profit=200, total_assets=D(str(cash)) + D(str(due)), total_liabilities=advance_left)
            print(f'PASS FIN38 {label}: invoice200 paid={paid}/due={due}; cash={cash}; AR={due}; advance={advance_left}; income/profit200; gross TB={gross} each', flush=True)

        def receipt(value, reference):
            return post('/finance/payments', {'invoice_id': invoice['id'], 'account_id': bank['id'], 'payment_date': today, 'invoice_amount': str(value), 'method': 'bank_transfer', 'reference': reference})

        checkpoint('issued plus existing advance10', 0, 200, 10, 10, 210, 'sent')
        prior = receipt(80, 'ORIGINAL-RECEIPT-80')
        checkpoint('prior receipt80 retained', 80, 120, 90, 10, 290, 'partially_paid')
        incorrect = receipt(120, 'ORIGINAL-RECEIPT-120')
        checkpoint('original fully collected', 200, 0, 210, 10, 410, 'paid')
        correction = {'source_type': 'payment', 'source_id': incorrect['id'], 'reason': 'Synthetic original receipt correction', 'reversal_date': today}
        reversed_result = post('/accounting/corrections/reverse', correction)
        assert reversed_result['ok'] and reversed_result['reversal_journal_id']
        checkpoint('reverse120 on same invoice', 80, 120, 90, 10, 530, 'partially_paid')
        guard('/accounting/corrections/reverse', correction)
        apply_path = '/accounting/customer-advances/' + advance['id'] + '/apply'
        guard(apply_path, {'invoice_id': invoice['id'], 'application_date': today, 'amount': '11'})
        before_credit = ledger_rows(bank['id'])
        applied = post(apply_path, {'invoice_id': invoice['id'], 'application_date': today, 'amount': '10'}, 200)
        amounts(applied, original_amount=10, remaining_amount=0)
        assert ledger_rows(bank['id']) == before_credit, 'Advance application must not create a second cash movement'
        checkpoint('apply existing credit10 without cash', 90, 110, 90, 0, 540, 'partially_paid')
        guard('/finance/payments', {'invoice_id': invoice['id'], 'account_id': bank['id'], 'payment_date': today, 'invoice_amount': '111', 'method': 'bank_transfer'}, 409)
        replacement = receipt(110, 'REPLACEMENT-RECEIPT-110')
        checkpoint('replacement110 completes exact original chain', 200, 0, 200, 0, 650, 'paid')
        history = call('GET', '/finance/payments?invoice_id=' + invoice['id'])
        assert len(history) == 3
        assert {row['id']: row['status'] for row in history} == {prior['id']: 'confirmed', incorrect['id']: 'reversed', replacement['id']: 'confirmed'}
        assert sum(D(row['invoice_amount']) for row in history if row['status'] == 'confirmed') == 190
        movements = ledger_rows(bank['id'])
        assert len(movements) == 5
        assert sum(D(row['amount']) for row in movements if row['direction'] == 'credit') == 320
        assert sum(D(row['amount']) for row in movements if row['direction'] == 'debit') == 120
        assert len([row for row in movements if row['source_type'] == 'payment_reversal' and row['source_id'] == incorrect['id']]) == 1
        journals = call('GET', '/accounting/journals?limit=200')
        assert len(journals) == 7
        assert len([row for row in journals if row['source_type'] == 'invoice_issue' and row['source_id'] == invoice['id']]) == 1
        original_journal = next(row for row in journals if row['source_type'] == 'invoice_payment' and row['source_id'] == incorrect['id'])
        reversal_journal = next(row for row in journals if row['id'] == reversed_result['reversal_journal_id'])
        assert reversal_journal['source_type'] == 'reversal' and reversal_journal['source_id'] == original_journal['id']
        assert db.scalar(select(JournalEntry.reversed_entry_id).where(JournalEntry.id == reversal_journal['id'])) == original_journal['id']
        db.rollback()
        assert all(D(row['total_debit']) == D(row['total_credit']) for row in journals)
        print('PASS FIN38 retained history: receipts80 and110 confirmed; receipt120 reversed; one linked reversal; seven balanced journals, gross650; confirmed cash190 + applied credit10 = invoice paid200; cash320 in -120 out =200; no duplicated income or cash application', flush=True)
        lines = db.execute(select(JournalLine.journal_entry_id, func.sum(JournalLine.debit), func.sum(JournalLine.credit)).where(JournalLine.organization_id.in_(orgs)).group_by(JournalLine.journal_entry_id)).all()
        assert lines and all(debit == credit for _, debit, credit in lines)
        db.rollback()
        print(f'PASS independent PostgreSQL: all {len(lines)} new journals balanced', flush=True)
    finally:
        http.close()
        app.dependency_overrides.pop(get_db, None)
        db.close()
        outer.rollback()
        conn.close()
        with SessionLocal() as check:
            assert check.scalar(select(func.count()).select_from(Organization).where(Organization.id.in_(orgs))) == 0
            assert check.scalar(select(func.count()).select_from(User).where(User.id.in_(users))) == 0
            for table in Organization.metadata.sorted_tables:
                if 'organization_id' in table.c:
                    assert check.scalar(select(func.count()).select_from(table).where(table.c.organization_id.in_(orgs))) == 0, table.name
        print('PASS independent rollback: synthetic users, organizations and every organization-owned business/audit/idempotency table absent', flush=True)


if __name__ == '__main__':
    main()
