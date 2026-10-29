"""Order/project invoice request rollback and sequential retry on SQLite memory.

Actual route/helper, sequence, payment instructions, audit and request cleanup.
Defaults/time/staged-billing lookup and response serialization are substituted;
no HTTP/auth/provider, PostgreSQL locks, FK or concurrent-race certification.
"""
from datetime import date, timedelta
from decimal import Decimal
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session

from app.models.activity_log import ActivityLog
from app.models.company_settings import OrganizationDocumentSequence
from app.models.finance import FinancialAccount, Invoice, InvoiceItem
from app.models.orders import Order, OrderItem
from app.models.projects import Project
from app.schemas.invoice_payment import InvoicePaymentInstructionsUpdate
from test_hr_document_upload_commit_safety_offline import (
    actual_function, actual_audit, audit_guards, FixtureCompiler,
)


class InjectedFailure(RuntimeError):
    pass


class FaultSession(Session):
    failure = None
    flushes = 0

    def flush(self, *args, **kwargs):
        super().flush(*args, **kwargs)
        self.flushes += 1
        if self.failure == f'flush-{self.flushes}':
            raise InjectedFailure('after real database flush')

    def commit(self):
        if self.failure == 'before-commit':
            self.flush()
            raise InjectedFailure('before commit')
        super().commit()
        if self.failure == 'after-commit':
            raise InjectedFailure('durable commit response lost')

    def refresh(self, *args, **kwargs):
        if self.failure == 'readback':
            raise InjectedFailure('postcommit response readback failed')
        return super().refresh(*args, **kwargs)


class SourceInvoiceTransactionTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.socket.connect_ex',
                       'socket.create_connection', 'socket.getaddrinfo'):
            self.enterContext(patch(target, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in (Order, OrderItem, Project, OrganizationDocumentSequence,
                      FinancialAccount, Invoice, InvoiceItem, ActivityLog):
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Order.__table__.insert(), dict(
                id='order', organization_id='org', order_number='ORD-SYN', client_id='client',
                created_by_user_id='actor', order_date=date(2096, 1, 1), currency='USD',
                seller_name_snapshot='Synthetic seller', client_name_snapshot='Synthetic client',
                tax_calculation_mode='inclusive', subtotal=110, tax_total=10, total=110))
            conn.execute(OrderItem.__table__.insert(), dict(
                id='line', organization_id='org', order_id='order', item_name_snapshot='Synthetic service',
                description='Synthetic line', quantity=1, unit_price=110, tax_rate=10,
                line_subtotal=110, discount_amount=0, taxable_amount=110, tax_amount=10, line_total=110))
            conn.execute(Project.__table__.insert(), dict(
                id='project', organization_id='org', project_number='PROJ-SYN', order_id='order',
                client_id='client', created_by_user_id='actor', name='Synthetic project', currency='USD'))
            conn.execute(OrganizationDocumentSequence.__table__.insert(), dict(
                id='sequence', organization_id='org', document_type='invoice', prefix='INV', next_number=1))
            conn.execute(FinancialAccount.__table__.insert(), dict(
                id='bank', organization_id='org', name='Synthetic bank', currency='USD',
                created_by_user_id='actor'))
        self.tenant = NS(organization_id='org', user_id='actor', organization=NS(timezone='UTC'))
        self.details = InvoicePaymentInstructionsUpdate(payment_method='bank_transfer', payment_account_id='bank')
        self.fail_audit = False
        self.staged = False
        context = dict(select=select, Decimal=Decimal, timedelta=timedelta,
                       HTTPException=HTTPException, Order=Order, OrderItem=OrderItem, Project=Project,
                       Invoice=Invoice, InvoiceItem=InvoiceItem, FinancialAccount=FinancialAccount,
                       OrganizationDocumentSequence=OrganizationDocumentSequence,
                       staged_billing_enabled=lambda *args: self.staged,
                       _financial_defaults=lambda *args: None,
                       _tenant_today=lambda *args: date(2096, 2, 1),
                       _invoice_detail=lambda db, invoice, tz: invoice.id)
        context['next_sequence_code'] = actual_function('app/services/crm.py', 'next_sequence_code', context)
        context['apply_invoice_payment_instructions'] = actual_function(
            'app/services/invoice_payment_instructions.py', 'apply_invoice_payment_instructions', context)
        real_audit = actual_audit()

        def audit(*args, **kwargs):
            result = real_audit(*args, **kwargs)
            if self.fail_audit:
                args[0].flush()
                raise InjectedFailure('invoice, lines, sequence, payment details and audit flushed')
            return result

        context['record_activity'] = audit
        for name in ('_existing_source_invoice', '_create_invoice_from_order',
                     'create_invoice_from_order', 'create_invoice_from_project'):
            context[name] = actual_function('app/api/v1/finance.py', name, context)
        self.handlers = context

    def request(self, route='order', *, failure=None, tenant=None):
        db = FaultSession(self.engine, autoflush=False, expire_on_commit=False)
        db.failure = failure
        guards = audit_guards()
        for event_name, callback in [('before_flush', '_remember_audit_coverage'),
                                     ('before_commit', '_require_audit_for_commit'),
                                     ('after_commit', '_clear_audit_state'),
                                     ('after_rollback', '_clear_audit_state')]:
            event.listen(db, event_name, guards[callback])
        dependency = actual_function('app/db/session.py', 'get_db', {'SessionLocal': lambda: db})()
        next(dependency)
        try:
            return self.handlers['create_invoice_from_' + route](
                **{route + '_id': route}, request=None, db=db, tenant=tenant or self.tenant,
                payload=NS(payment_details=self.details))
        finally:
            dependency.close()

    def snapshot(self):
        with Session(self.engine) as db:
            return (*(db.scalar(select(func.count()).select_from(model)) for model in
                      (Invoice, InvoiceItem, ActivityLog)),
                    db.get(OrganizationDocumentSequence, 'sequence').next_number)

    def change(self, model, **values):
        with self.engine.begin() as conn:
            conn.execute(model.__table__.update().values(**values))

    def assert_conflict(self, route):
        with self.assertRaises(HTTPException) as raised:
            self.request(route)
        self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), (1, 1, 1, 2))

    def test_order_then_project_retry_does_not_duplicate_or_consume_number(self):
        invoice_id = self.request()
        self.assertEqual(self.snapshot(), (1, 1, 1, 2))
        self.assert_conflict('order')
        self.assert_conflict('project')
        with Session(self.engine) as db:
            invoice = db.get(Invoice, invoice_id)
            self.assertEqual(invoice.invoice_number, 'INV-00001')
            self.assertEqual(invoice.payment_account_id, 'bank')
            self.assertEqual(invoice.payment_account_name_snapshot, 'Synthetic bank')

    def test_project_then_order_retry_does_not_duplicate(self):
        invoice_id = self.request('project')
        self.assert_conflict('project')
        self.assert_conflict('order')
        with Session(self.engine) as db:
            self.assertEqual(db.get(Invoice, invoice_id).project_id, 'project')

    def test_flushed_invoice_and_lines_rollback_then_retry(self):
        for route in ('order', 'project'):
            for failure in ('flush-1', 'flush-2', 'before-commit'):
                with self.subTest(route=route, failure=failure):
                    with self.assertRaises(InjectedFailure):
                        self.request(route, failure=failure)
                    self.assertEqual(self.snapshot(), (0, 0, 0, 1))
        self.request('project')
        self.assertEqual(self.snapshot(), (1, 1, 1, 2))

    def test_flushed_audit_and_payment_details_rollback_then_retry(self):
        self.fail_audit = True
        for route in ('order', 'project'):
            with self.assertRaises(InjectedFailure):
                self.request(route)
            self.assertEqual(self.snapshot(), (0, 0, 0, 1))
        self.fail_audit = False
        self.request()
        self.assertEqual(self.snapshot(), (1, 1, 1, 2))

    def test_invalid_payment_destination_rolls_back_already_flushed_invoice(self):
        self.details.payment_account_id = 'missing'
        for route in ('order', 'project'):
            with self.assertRaises(HTTPException) as raised:
                self.request(route)
            self.assertEqual(raised.exception.status_code, 404)
            self.assertEqual(self.snapshot(), (0, 0, 0, 1))
        self.details.payment_account_id = 'bank'
        self.request()
        self.assertEqual(self.snapshot(), (1, 1, 1, 2))

    def test_foreign_payment_destination_cannot_leave_partial_invoice(self):
        self.change(FinancialAccount, organization_id='foreign')
        with self.assertRaises(HTTPException) as raised:
            self.request('project')
        self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.snapshot(), (0, 0, 0, 1))

    def test_lost_order_commit_response_then_project_retry_is_safe(self):
        with self.assertRaises(InjectedFailure):
            self.request('order', failure='after-commit')
        self.assert_conflict('project')
        self.assert_conflict('order')

    def test_lost_project_commit_response_then_order_retry_is_safe(self):
        with self.assertRaises(InjectedFailure):
            self.request('project', failure='after-commit')
        self.assert_conflict('order')
        self.assert_conflict('project')

    def test_postcommit_readback_failure_keeps_invoice_and_number_durable(self):
        with self.assertRaises(InjectedFailure):
            self.request('project', failure='readback')
        self.assert_conflict('order')

    def test_foreign_source_tenant_cannot_consume_invoice_number(self):
        foreign = NS(organization_id='foreign', user_id='actor', organization=NS(timezone='UTC'))
        for route in ('order', 'project'):
            with self.assertRaises(HTTPException) as raised:
                self.request(route, tenant=foreign)
            self.assertEqual(raised.exception.status_code, 404)
        self.assertEqual(self.snapshot(), (0, 0, 0, 1))

    def test_staged_source_denial_leaves_sequence_and_invoice_untouched(self):
        self.staged = True
        for route in ('order', 'project'):
            with self.assertRaises(HTTPException) as raised:
                self.request(route)
            self.assertEqual(raised.exception.status_code, 409)
        self.assertEqual(self.snapshot(), (0, 0, 0, 1))


if __name__ == '__main__':
    unittest.main()
