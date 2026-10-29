"""Real authenticated payment/cancel/expense-void races on opt-in local test PG.

Run with QC_PAYMENT_VOID_CONCURRENCY=1 and ENVIRONMENT=test against the isolated
CI database codestation_business_os. Independent requests use normal dependencies;
no provider, lifespan, scheduler, engine substitution or HTTP dependency override.
Committed, uniquely marked synthetic rows are preserved for diagnostics; cleanup
revokes their user and suspends their organization, never deletes financial history.
"""
import os
import time
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from datetime import date
from decimal import Decimal
from threading import Lock
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy import case, event, func, select, text
from sqlalchemy.orm import Session

from app.core.security import create_access_token
from app.db.session import SessionLocal, engine
from app.main import app
from app.models.accounting import JournalEntry, JournalLine
from app.models.activity_log import ActivityLog
from app.models.expenses import Expense
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, InvoiceItem, Payment
from app.models.organization import Organization
from app.models.posting_idempotency import PostingIdempotency
from app.models.user import User
from app.services.activity_log import record_activity

REQUEST_LABEL = ContextVar('qc_payment_void_request', default=None)


def require(condition, evidence):
    if not condition:
        raise AssertionError(evidence)


def main():
    # Explicit errors, not assert statements that disappear with python -O.
    require(os.environ.get('QC_PAYMENT_VOID_CONCURRENCY') == '1', 'Explicit synthetic-fixture opt-in required')
    require(os.environ.get('ENVIRONMENT') == 'test', 'ENVIRONMENT must be test')
    require(engine.url.get_backend_name() == 'postgresql', 'PostgreSQL required')
    require(engine.url.host in {'localhost', '127.0.0.1'}, 'Only local test PostgreSQL allowed')
    require(engine.url.database == 'codestation_business_os', 'Unexpected test database')
    require(not app.dependency_overrides, 'Dependency overrides forbidden')
    marker = uuid4().hex[:12]
    prefix = 'qc-payvoid-' + marker
    identities, identity_lock = {}, Lock()
    user_id = organization_id = None
    organization_name = 'QC PRESERVED payment void race ' + marker
    headers = {}
    today = date.today().isoformat()
    http = TestClient(app, raise_server_exceptions=False)  # No lifespan context manager.

    def instrument(session, transaction, connection):
        # Transaction-local settings cannot leak to pooled sessions after rollback.
        connection.execute(text("SET LOCAL statement_timeout = '30s'"))
        connection.execute(text("SET LOCAL lock_timeout = '25s'"))
        connection.execute(text("SET LOCAL idle_in_transaction_session_timeout = '60s'"))
        label = REQUEST_LABEL.get()
        if label:
            connection.execute(text("SELECT set_config('application_name', :label, true)"), {'label': label})
            pid = connection.scalar(text('SELECT pg_backend_pid()'))
            with identity_lock:
                identities.setdefault(label, set()).add(pid)

    event.listen(Session, 'after_begin', instrument)

    def request(method, path, payload=None, expected=200):
        response = http.request(method, '/api/v1' + path, headers=headers, json=payload)
        require(response.status_code == expected, (method, path, response.status_code, response.text))
        return response.json()

    def worker(label, spec):
        token = REQUEST_LABEL.set(label)
        client = TestClient(app, raise_server_exceptions=False)
        try:
            method, path, payload, key = spec
            own_headers = dict(headers)
            if key:
                own_headers['Idempotency-Key'] = key
            response = client.request(method, '/api/v1' + path, headers=own_headers, json=payload)
            return response.status_code, response.json()
        finally:
            client.close()
            REQUEST_LABEL.reset(token)

    def waiting(label, allowed_blockers):
        """Require THIS request's real PID, lock wait, and expected blocker chain."""
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            with identity_lock:
                known = set(identities.get(label, ()))
            if known:
                with SessionLocal() as observation:
                    rows = observation.execute(text(
                        'SELECT pid, wait_event_type, pg_blocking_pids(pid) AS blockers '
                        'FROM pg_stat_activity WHERE datname=current_database() AND application_name=:label'
                    ), {'label': label}).all()
                for pid, wait_type, blockers in rows:
                    if pid in known and wait_type == 'Lock' and set(blockers) & allowed_blockers:
                        return pid, list(blockers)
            time.sleep(.025)
        raise AssertionError(('Participating request never reached expected lock wait', label, sorted(known)))

    def cancel_owned_requests(labels):
        # Never cancel unrelated database sessions, even on a failed test.
        with SessionLocal() as cleanup:
            for label in labels:
                cleanup.execute(text(
                    'SELECT pg_cancel_backend(pid) FROM pg_stat_activity '
                    'WHERE datname=current_database() AND application_name=:label AND pid<>pg_backend_pid()'
                ), {'label': label})

    def effect_counts():
        # Count the entire synthetic tenant, not only the winning resource: a leaked
        # loser payment/cash/journal/audit/reservation must not escape verification.
        with SessionLocal() as db:
            return {model.__tablename__: db.scalar(select(func.count()).select_from(model).where(
                    model.organization_id == organization_id)) for model in
                    (Payment, Expense, Invoice, InvoiceItem, FinancialTransaction, JournalEntry,
                     JournalLine, ActivityLog, PostingIdempotency)}

    def race(case_name, model, row_id, first, second, *, effects):
        labels = [prefix + '-' + case_name + '-1', prefix + '-' + case_name + '-2']
        blocker = SessionLocal()
        pool = ThreadPoolExecutor(max_workers=2)
        futures = []
        evidence = {}
        before_effects = effect_counts()
        try:
            blocker_pid = blocker.scalar(text('SELECT pg_backend_pid()'))
            row = blocker.scalar(select(model).where(model.id == row_id, model.organization_id == organization_id).with_for_update())
            require(row is not None, ('Missing synthetic lock target', case_name))
            futures.append(pool.submit(worker, labels[0], first))
            first_pid, first_blockers = waiting(labels[0], {blocker_pid})
            futures.append(pool.submit(worker, labels[1], second))
            second_pid, second_blockers = waiting(labels[1], {blocker_pid, first_pid})
            require(first_pid != second_pid, 'Requests must use independent PostgreSQL sessions')
            with SessionLocal() as observation:
                shared_holders = set(observation.scalars(text(
                    "SELECT DISTINCT pid FROM pg_locks WHERE pid IN (:first, :second) "
                    "AND locktype='advisory' AND mode='ShareLock' AND granted"
                ), {'first': first_pid, 'second': second_pid}).all())
            require(shared_holders == {first_pid, second_pid}, 'Both contenders must hold shared accounting gates')
            evidence = dict(case=case_name, blocker_pid=blocker_pid, request_pids=[first_pid, second_pid],
                            waiting_on=[first_blockers, second_blockers])
            # First waiter has already queued for the exact same source-row lock.
            blocker.rollback()
            results = [future.result(timeout=35) for future in futures]
            print('LOCK EVIDENCE', evidence | {'statuses': [code for code, _ in results]}, flush=True)
            after_effects = effect_counts()
            delta = {table: after_effects[table] - value for table, value in before_effects.items()}
            require(delta == {table: effects.get(table, 0) for table in delta},
                    ('Unexpected winner/rejected-request effects', case_name, delta, effects))
            return results
        finally:
            blocker.rollback()
            blocker.close()
            if any(not future.done() for future in futures):
                cancel_owned_requests(labels)
            pool.shutdown(wait=True, cancel_futures=True)

    def cash(account_id):
        with SessionLocal() as db:
            account = db.get(FinancialAccount, account_id)
            movement = db.scalar(select(func.coalesce(func.sum(case(
                (FinancialTransaction.direction == 'credit', FinancialTransaction.amount),
                else_=-FinancialTransaction.amount)), 0)).where(
                FinancialTransaction.organization_id == organization_id, FinancialTransaction.account_id == account_id))
            return Decimal(account.opening_balance) + Decimal(movement)

    def invoice_fixture(client_id, label):
        invoice = request('POST', '/finance/invoices', dict(client_id=client_id, subject=label, issue_date=today,
                          currency='USD', items=[dict(item_name='Synthetic service', description='Concurrency fixture',
                                                     quantity='1', unit_price='10')]), 201)
        request('PATCH', '/finance/invoices/' + invoice['id'] + '/status', {'action': 'send'})
        return invoice['id']

    def payment_spec(invoice_id, account_id, key):
        return ('POST', '/finance/payments', dict(invoice_id=invoice_id, account_id=account_id,
                invoice_amount='10', payment_date=today, method='cash'), key)

    def payment_evidence(invoice_id, keys, paid, cancelled=False):
        with SessionLocal() as db:
            invoice = db.get(Invoice, invoice_id)
            require((invoice.status, invoice.amount_paid, invoice.balance_due) ==
                    (('paid', Decimal(10), Decimal(0)) if paid else ('cancelled', Decimal(0), Decimal(10))),
                    ('Invoice state', invoice.status, str(invoice.amount_paid), str(invoice.balance_due)))
            payments = db.scalars(select(Payment).where(Payment.organization_id == organization_id, Payment.invoice_id == invoice_id)).all()
            require(len(payments) == int(paid), ('Payment count', len(payments)))
            guards = db.scalars(select(PostingIdempotency).where(PostingIdempotency.organization_id == organization_id,
                               PostingIdempotency.action == 'finance.payment.record', PostingIdempotency.idempotency_key.in_(keys))).all()
            require(len(guards) == int(paid), ('Committed payment idempotency count', len(guards)))
            if paid:
                payment = payments[0]
                require(payment.invoice_amount == payment.account_amount == 10 and payment.status == 'confirmed', 'Wrong payment amounts/status')
                require(guards[0].completed_at is not None and guards[0].resource_type == 'payment'
                        and guards[0].resource_id == payment.id, 'Incomplete or wrong idempotency result')
                for model, clauses in [
                    (FinancialTransaction, [FinancialTransaction.source_type == 'payment', FinancialTransaction.source_id == payment.id]),
                    (JournalEntry, [JournalEntry.source_type == 'invoice_payment', JournalEntry.source_id == payment.id]),
                    (ActivityLog, [ActivityLog.action == 'finance.payment.recorded', ActivityLog.entity_id == payment.id]),
                ]:
                    require(db.scalar(select(func.count()).select_from(model).where(model.organization_id == organization_id, *clauses)) == 1,
                            ('Expected one payment effect', model.__name__))
            original = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id,
                                 JournalEntry.source_type == 'invoice_issue', JournalEntry.source_id == invoice_id))
            require(original is not None, 'Missing invoice issue journal')
            reversal_count = db.scalar(select(func.count()).select_from(JournalEntry).where(
                JournalEntry.organization_id == organization_id, JournalEntry.reversed_entry_id == original.id))
            require(reversal_count == int(cancelled), ('Invoice reversal count', reversal_count))
            return payments[0].id if payments else None

    def balanced_journals():
        with SessionLocal() as db:
            journals = db.scalars(select(JournalEntry).where(JournalEntry.organization_id == organization_id)).all()
            for journal in journals:
                lines = db.scalars(select(JournalLine).where(JournalLine.organization_id == organization_id,
                                  JournalLine.journal_entry_id == journal.id)).all()
                debit, credit = sum((x.debit for x in lines), Decimal(0)), sum((x.credit for x in lines), Decimal(0))
                require(len(lines) >= 2 and debit == credit and debit > 0,
                        ('Unbalanced/empty journal', journal.id, str(debit), str(credit)))
                if journal.reversed_entry_id:
                    original_lines = db.scalars(select(JournalLine).where(
                        JournalLine.organization_id == organization_id,
                        JournalLine.journal_entry_id == journal.reversed_entry_id)).all()
                    expected = sorted((x.ledger_account_id, x.currency, x.exchange_rate_to_base,
                                       x.original_amount, x.credit, x.debit) for x in original_lines)
                    actual = sorted((x.ledger_account_id, x.currency, x.exchange_rate_to_base,
                                     x.original_amount, x.debit, x.credit) for x in lines)
                    require(original_lines and actual == expected,
                            ('Reversal does not mirror original ledger/currency/amounts', journal.id))
            require(not db.scalar(select(func.count()).select_from(PostingIdempotency).where(
                PostingIdempotency.organization_id == organization_id, PostingIdempotency.completed_at.is_(None))),
                'Rejected request left incomplete idempotency reservation')

    try:
        with SessionLocal() as db:
            user = User(email=f'{prefix}@example.invalid', full_name='Synthetic payment void race owner',
                        is_active=True, is_verified=True)
            db.add(user)
            db.flush()
            user_id, version = user.id, int(user.auth_token_version or 0)
            record_activity(db, action='qc.payment_void.fixture', scope='system', actor_type='system')
            db.commit()
        headers['Authorization'] = 'Bearer ' + create_access_token(user_id, version)
        organization = request('POST', '/organizations', dict(name=organization_name, currency='USD', country_code='US', timezone='UTC'), 201)['organization']
        organization_id = organization['id']
        headers['X-Organization-ID'] = organization_id
        print('SYNTHETIC FIXTURE', {'organization_id': organization_id, 'user_id': user_id, 'marker': marker}, flush=True)
        account = request('POST', '/finance/accounts', dict(name='Synthetic race cash', account_type='cash', currency='USD', opening_balance='100'), 201)
        client = request('POST', '/crm/clients', dict(display_name='Synthetic race client', currency='USD'), 201)

        payment_effects = dict(payments=1, financial_transactions=1, journal_entries=1,
                               journal_lines=2, activity_logs=1, posting_idempotency=1)
        cancellation_effects = dict(journal_entries=1, journal_lines=2, activity_logs=1)
        void_effects = dict(financial_transactions=1, journal_entries=1, journal_lines=2, activity_logs=1)
        invoice_id = invoice_fixture(client['id'], 'Same-key payment')
        key = prefix + '-same'
        spec = payment_spec(invoice_id, account['id'], key)
        before = cash(account['id'])
        results = race('samekey', Invoice, invoice_id, spec, spec, effects=payment_effects)
        require([code for code, _ in results] == [201, 201], results)
        payment_id = payment_evidence(invoice_id, [key], True)
        require(results[0][1]['id'] == results[1][1]['id'] == payment_id, 'Replay returned different payment')
        require(cash(account['id']) == before + 10, 'Same-key replay duplicated cash')

        invoice_id = invoice_fixture(client['id'], 'Distinct-key full payments')
        keys = [prefix + '-distinct-1', prefix + '-distinct-2']
        before = cash(account['id'])
        results = race('differentkeys', Invoice, invoice_id, *(payment_spec(invoice_id, account['id'], key) for key in keys), effects=payment_effects)
        require([code for code, _ in results] == [201, 409], results)
        payment_evidence(invoice_id, keys, True)
        require(cash(account['id']) == before + 10, 'Distinct keys overpaid invoice')

        for payment_first in (True, False):
            invoice_id = invoice_fixture(client['id'], 'Payment cancel ordered race')
            key = prefix + '-cancel-' + str(payment_first)
            payment = payment_spec(invoice_id, account['id'], key)
            cancel = ('PATCH', '/finance/invoices/' + invoice_id + '/status',
                      {'action': 'cancel', 'reason': 'Synthetic race cancellation'}, None)
            before = cash(account['id'])
            results = race('payfirst' if payment_first else 'cancelfirst', Invoice, invoice_id,
                           *((payment, cancel) if payment_first else (cancel, payment)),
                           effects=payment_effects if payment_first else cancellation_effects)
            require([code for code, _ in results] == ([201, 409] if payment_first else [200, 409]), results)
            payment_evidence(invoice_id, [key], payment_first, cancelled=not payment_first)
            require(cash(account['id']) == before + (10 if payment_first else 0), 'Rejected payment/cancel changed cash')

        category = request('POST', '/finance/expense-categories', {'name': 'Synthetic void category'}, 201)
        expense = request('POST', '/finance/expenses', dict(description='Synthetic void contender', category_id=category['id'],
                          account_id=account['id'], expense_date=today, expense_currency='USD', expense_amount='7'), 201)
        before = cash(account['id'])
        void = ('POST', '/finance/expenses/' + expense['id'] + '/void', None, None)
        results = race('void', Expense, expense['id'], void, void, effects=void_effects)
        require([code for code, _ in results] == [200, 409], results)
        require(cash(account['id']) == before + 7, 'Expense refunded more than once')
        with SessionLocal() as db:
            require(db.get(Expense, expense['id']).status == 'voided', 'Expense not voided')
            refunds = db.scalars(select(FinancialTransaction).where(FinancialTransaction.organization_id == organization_id,
                                 FinancialTransaction.source_type == 'expense_void', FinancialTransaction.source_id == expense['id'])).all()
            require(len(refunds) == 1 and refunds[0].direction == 'credit' and refunds[0].amount == 7, 'Wrong void refund')
            debits = db.scalars(select(FinancialTransaction).where(FinancialTransaction.organization_id == organization_id,
                                FinancialTransaction.source_type == 'expense', FinancialTransaction.source_id == expense['id'])).all()
            require(len(debits) == 1 and debits[0].direction == 'debit' and debits[0].amount == 7,
                    'Missing or incorrect original expense debit')
            require(debits[0].account_id == refunds[0].account_id == account['id']
                    and debits[0].currency == refunds[0].currency == 'USD'
                    and refunds[0].amount - debits[0].amount == 0, 'Expense/refund do not net to zero')
            original = db.scalar(select(JournalEntry).where(JournalEntry.organization_id == organization_id,
                                 JournalEntry.source_type == 'expense_post', JournalEntry.source_id == expense['id']))
            require(original is not None, 'Missing expense journal')
            require(db.scalar(select(func.count()).select_from(JournalEntry).where(JournalEntry.organization_id == organization_id,
                              JournalEntry.reversed_entry_id == original.id)) == 1, 'Wrong void reversal count')
            require(db.scalar(select(func.count()).select_from(ActivityLog).where(ActivityLog.organization_id == organization_id,
                              ActivityLog.action == 'finance.expense.voided', ActivityLog.entity_id == expense['id'])) == 1, 'Wrong void audit count')
        balanced_journals()
        print('PASS real-PG payment/void concurrency: five ordered races; replay, overpayment, cancel, refund invariants', flush=True)
    finally:
        http.close()
        try:
            # Preserve inspectable financial/audit evidence; revoke only our UUID-marked fixtures.
            if user_id:
                with SessionLocal() as db:
                    user = db.get(User, user_id)
                    require(user is not None and user.email == f'{prefix}@example.invalid', 'Synthetic user cleanup identity mismatch')
                    user.is_active = False
                    user.auth_token_version = int(user.auth_token_version or 0) + 1
                    if organization_id:
                        org = db.get(Organization, organization_id)
                        require(org is not None and org.name == organization_name, 'Synthetic organization cleanup identity mismatch')
                        org.status = 'suspended'
                        org.suspension_reason = 'Preserved synthetic concurrency fixture; not a customer organization'
                    record_activity(db, action='qc.payment_void.fixture_closed', scope='system', actor_type='system',
                                    organization_id=organization_id)
                    db.commit()
                    print('CLEANUP verified: synthetic user disabled, organization suspended; evidence retained', flush=True)
        finally:
            event.remove(Session, 'after_begin', instrument)


if __name__ == '__main__':
    main()
