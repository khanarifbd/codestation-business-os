"""Actual quotation conversion/milestone invoice, SQLite memory transactions.

Tests sequential failure/retry and request-close rollback. Not PostgreSQL row
locking, concurrency, HTTP authorization, or external invoice delivery proof.
"""
from datetime import date, datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import Session
from app.models.sales import Quotation, QuotationItem, QuotationPaymentMilestone
from app.models.orders import Order, OrderItem
from app.models.order_commercial import OrderBillingMilestone, OrderBillingMilestoneItem
from app.models.order_billing_invoice import OrderBillingInvoiceLink
from app.models.finance import Invoice, InvoiceItem
from app.models.activity_log import ActivityLog
from app.services.quotation_order_conversion import seed_order_billing_from_quotation
from test_hr_document_upload_commit_safety_offline import actual_function, actual_audit, audit_guards, FixtureCompiler

DAY = date(2096, 1, 10)
MODELS = (Quotation, QuotationItem, QuotationPaymentMilestone, Order, OrderItem,
          OrderBillingMilestone, OrderBillingMilestoneItem, Invoice, InvoiceItem,
          OrderBillingInvoiceLink, ActivityLog)


class InjectedFailure(RuntimeError):
    pass


class FaultSession(Session):
    failure = None
    def commit(self):
        if self.failure == 'before-commit':
            self.flush()
            raise InjectedFailure('before-commit')
        super().commit()
        if self.failure == 'after-commit':
            raise InjectedFailure('after-commit')
    def refresh(self, *args, **kwargs):
        if self.failure == 'readback':
            raise InjectedFailure('readback')
        return super().refresh(*args, **kwargs)


class QuotationOrderFailureTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.socket.connect_ex', 'socket.create_connection', 'socket.getaddrinfo'):
            self.enterContext(patch(target, side_effect=AssertionError('network forbidden')))
        self.engine = create_engine('sqlite+pysqlite:///:memory:')
        self.addCleanup(self.engine.dispose)
        self.engine.dialect.type_compiler_instance = FixtureCompiler(self.engine.dialect)
        for model in MODELS:
            model.__table__.create(self.engine)
        with self.engine.begin() as conn:
            conn.execute(Quotation.__table__.insert(), dict(id='quotation', organization_id='org',
                quotation_number='Q-SYN', client_id='client', created_by_user_id='actor', status='accepted',
                issue_date=DAY, currency='USD', seller_name_snapshot='Synthetic Seller',
                client_name_snapshot='Synthetic Client', subtotal=100, total=100))
            conn.execute(QuotationItem.__table__.insert(), dict(id='line', organization_id='org',
                quotation_id='quotation', item_name_snapshot='Synthetic service', description='Synthetic',
                quantity=1, unit_price=100, line_subtotal=100, discount_amount=0, taxable_amount=100,
                tax_amount=0, line_total=100))
            conn.execute(QuotationPaymentMilestone.__table__.insert(), dict(id='payment', organization_id='org',
                quotation_id='quotation', title='Synthetic balance', payment_type='fixed', amount=100))
        self.tenant = NS(organization_id='org', user_id='actor', organization=NS(timezone='UTC'))
        self.failure = None
        real_audit = actual_audit()

        def audit(*args, **kwargs):
            result = real_audit(*args, **kwargs)
            if self.failure == 'audit':
                args[0].flush()
                raise InjectedFailure('audit')
            return result

        def seed(db, **kwargs):
            result = seed_order_billing_from_quotation(db, **kwargs)
            if self.failure == 'schedule':
                db.flush()
                raise InjectedFailure('schedule')
            return result

        def detail(db, org, identifier):
            if self.failure == 'readback':
                raise InjectedFailure('readback')
            return identifier

        context = {model.__name__: model for model in MODELS}
        context.update(select=select, func=func, Decimal=Decimal, datetime=datetime, timezone=timezone,
            HTTPException=HTTPException, seed_order_billing_from_quotation=seed,
            next_sequence_code=lambda *args: 'SYN-' + uuid4().hex[:12],
            _tenant_today=lambda *args: DAY, record_activity=audit, _detail=detail,
            money=lambda value: Decimal(value or 0).quantize(Decimal('.01'), rounding=ROUND_HALF_UP))
        context['_assert_mutable'] = actual_function('app/services/order_commercial.py', '_assert_mutable', context)
        self.conversion = actual_function('app/api/v1/orders.py', 'create_order_from_quotation', context)
        self.invoicing = actual_function('app/services/order_commercial.py', 'create_milestone_invoice', context)
        self.guards = audit_guards()

    def request(self, operation='convert', *, failure=None, tenant=None):
        self.failure = failure
        db = FaultSession(self.engine)
        db.failure = failure
        for event_name, function in [('before_flush', '_remember_audit_coverage'),
                                     ('before_commit', '_require_audit_for_commit'),
                                     ('after_commit', '_clear_audit_state'),
                                     ('after_rollback', '_clear_audit_state')]:
            event.listen(db, event_name, self.guards[function])
        dependency = actual_function('app/db/session.py', 'get_db', {'SessionLocal': lambda: db})()
        next(dependency)
        try:
            if operation == 'convert':
                return self.conversion('quotation', None, db, tenant or self.tenant)
            order = db.scalar(select(Order))
            milestone = db.scalar(select(OrderBillingMilestone))
            invoice = self.invoicing(db, order, milestone.id, 'actor', None)
            return invoice.id
        finally:
            dependency.close()

    def snapshot(self):
        with Session(self.engine) as db:
            return tuple(db.scalar(select(func.count()).select_from(model)) for model in MODELS)

    def change(self, model, **values):
        with self.engine.begin() as conn:
            conn.execute(model.__table__.update().values(**values))

    def billable_order(self):
        self.request()
        self.change(OrderBillingMilestone, status='billable')
        return self.snapshot()

    def test_successful_conversion_and_repeat_keeps_one_order_and_schedule(self):
        self.request()
        expected = self.snapshot()
        self.assertEqual(expected[3:7], (1, 1, 1, 1))
        with self.assertRaises(HTTPException) as error:
            self.request()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), expected)

    def test_precommit_conversion_failures_rollback_all_and_retry_once(self):
        original = self.snapshot()
        for failure in ('schedule', 'audit', 'before-commit'):
            with self.subTest(failure=failure):
                with self.assertRaises(InjectedFailure):
                    self.request(failure=failure)
                self.assertEqual(self.snapshot(), original)
        self.request()
        self.assertEqual(self.snapshot()[3:7], (1, 1, 1, 1))

    def test_lost_conversion_commit_response_preserves_order_and_blocks_duplicate(self):
        with self.assertRaises(InjectedFailure):
            self.request(failure='after-commit')
        expected = self.snapshot()
        self.assertEqual(expected[3:7], (1, 1, 1, 1))
        with self.assertRaises(HTTPException):
            self.request()
        self.assertEqual(self.snapshot(), expected)

    def test_conversion_readback_failure_preserves_committed_order(self):
        with self.assertRaises(InjectedFailure):
            self.request(failure='readback')
        self.assertEqual(self.snapshot()[3:7], (1, 1, 1, 1))
        with self.assertRaises(HTTPException):
            self.request()

    def test_schedule_mismatch_rolls_back_order_and_lines(self):
        self.change(QuotationPaymentMilestone, amount=99)
        original = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            self.request()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), original)

    def test_unaccepted_quotation_does_not_create_order(self):
        self.change(Quotation, status='sent')
        original = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            self.request()
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), original)

    def test_cross_tenant_quotation_is_not_found(self):
        original = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            self.request(tenant=NS(organization_id='other', user_id='other'))
        self.assertEqual(error.exception.status_code, 404)
        self.assertEqual(self.snapshot(), original)

    def test_invoice_success_then_retry_keeps_one_invoice_and_link(self):
        self.billable_order()
        self.request('invoice')
        original = self.snapshot()
        self.assertEqual(original[7:10], (1, 1, 1))
        with self.assertRaises(HTTPException) as error:
            self.request('invoice')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), original)

    def test_invoice_precommit_failures_restore_billable_state_and_retry_once(self):
        original = self.billable_order()
        for failure in ('audit', 'before-commit'):
            with self.subTest(failure=failure):
                with self.assertRaises(InjectedFailure):
                    self.request('invoice', failure=failure)
                self.assertEqual(self.snapshot(), original)
                with Session(self.engine) as db:
                    self.assertEqual(db.scalar(select(OrderBillingMilestone)).status, 'billable')
        self.request('invoice')
        self.assertEqual(self.snapshot()[7:10], (1, 1, 1))

    def test_invoice_lost_commit_response_preserves_invoice_and_blocks_duplicate(self):
        self.billable_order()
        with self.assertRaises(InjectedFailure):
            self.request('invoice', failure='after-commit')
        original = self.snapshot()
        self.assertEqual(original[7:10], (1, 1, 1))
        with self.assertRaises(HTTPException):
            self.request('invoice')
        self.assertEqual(self.snapshot(), original)

    def test_invoice_refresh_failure_preserves_invoice_and_blocks_duplicate(self):
        self.billable_order()
        with self.assertRaises(InjectedFailure):
            self.request('invoice', failure='readback')
        original = self.snapshot()
        self.assertEqual(original[7:10], (1, 1, 1))
        with self.assertRaises(HTTPException):
            self.request('invoice')
        self.assertEqual(self.snapshot(), original)

    def test_cancelled_invoice_allows_one_replacement(self):
        self.billable_order(); self.request('invoice')
        self.change(Invoice, status='cancelled')
        self.request('invoice')
        self.assertEqual(self.snapshot()[7:10], (2, 2, 2))
        with self.assertRaises(HTTPException):
            self.request('invoice')
        self.assertEqual(self.snapshot()[7:10], (2, 2, 2))

    def test_planned_milestone_cannot_be_invoiced(self):
        self.request()
        original = self.snapshot()
        with self.assertRaises(HTTPException) as error:
            self.request('invoice')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), original)

    def test_cancelled_order_cannot_generate_milestone_invoice(self):
        original = self.billable_order()
        self.change(Order, status='cancelled')
        with self.assertRaises(HTTPException) as error:
            self.request('invoice')
        self.assertEqual(error.exception.status_code, 409)
        self.assertEqual(self.snapshot(), original)


if __name__ == '__main__':
    unittest.main()
