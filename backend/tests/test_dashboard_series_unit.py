"""Executable query/HTTP contract tests using isolated SQLite function emulation.

PostgreSQL date_trunc/timezone semantics are emulated for query tests; decimal
serialization is separately tested with exact Decimal rows (SQLite SUM is float).
No external database, customer data, or production credentials are used.
"""
import json
import sys
import unittest
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.pool import StaticPool

from app.api.dependencies import get_tenant_context
from app.api.v1.reports_fast import router
from app.db.session import get_db
from app.services.dashboard_series import dashboard_series, plan_series


class QueryDB:
    def __init__(self, connection):
        self.connection = connection
        self.statements = []

    def execute(self, query):
        self.statements.append(query)
        rows = self.connection.execute(query).all()
        return [(datetime.fromisoformat(row[0]) if isinstance(row[0], str) else row[0], *row[1:]) for row in rows]


class SeriesTests(unittest.TestCase):
    def plan(self, start='2024-03-01', end='2024-03-31', zone='Europe/London', now='2024-04-02T12:00:00+00:00'):
        return plan_series(date.fromisoformat(start), date.fromisoformat(end), zone, now=datetime.fromisoformat(now))

    def test_dst_bounds_use_local_midnight_not_fixed_24_hours(self):
        p = self.plan('2024-03-31', '2024-03-31')
        lo, hi = p.utc_bounds()
        self.assertEqual((hi - lo).total_seconds(), 23 * 3600)
        p = self.plan('2024-10-27', '2024-10-27', now='2024-11-01T00:00:00+00:00')
        lo, hi = p.utc_bounds()
        self.assertEqual((hi - lo).total_seconds(), 25 * 3600)

    def test_leap_month_partial_bounds_and_limit(self):
        p = self.plan('2024-01-17', '2024-04-03', now='2024-04-02T12:00:00+00:00')
        self.assertEqual(p.bucket, 'month')
        self.assertEqual(p.periods[0][1], date(2024, 1, 17))
        self.assertEqual(p.periods[1][2], date(2024, 2, 29))
        self.assertEqual(p.periods[-1][2], date(2024, 4, 2))
        for prior, current in zip(p.periods, p.periods[1:]):
            self.assertEqual((current[1] - prior[2]).days, 1)
        self.assertEqual(self.plan('2024-01-01', '2024-12-31').bucket, 'month')
        for start, end in [('2024-01-01', '2025-01-01'), ('2024-03-02', '2024-03-01')]:
            with self.assertRaises(HTTPException) as caught:
                self.plan(start, end)
            self.assertEqual(caught.exception.status_code, 400)

    def test_daily_threshold_future_null_and_tenant_today(self):
        self.assertEqual(self.plan('2024-01-01', '2024-03-02').bucket, 'day')
        self.assertEqual(self.plan('2024-01-01', '2024-03-03').bucket, 'month')
        p = self.plan('2024-04-03', '2024-04-10')
        result = dashboard_series(None, 'org-a', p)
        self.assertIsNone(result.effective_date_to)
        self.assertEqual(result.counts, [])
        self.assertEqual(result.money, [])
        p = self.plan('2024-04-01', '2024-04-10', 'Asia/Dhaka', '2024-04-01T20:00:00+00:00')
        self.assertEqual(p.effective_end, date(2024, 4, 2))
        with self.assertRaises(HTTPException):
            self.plan(zone='not/a/zone')


class QueryTests(unittest.TestCase):
    plan = SeriesTests.plan
    def setUp(self):
        self.engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
        @event.listens_for(self.engine, 'connect')
        def functions(conn, _):
            def tz(name, stamp):
                value = datetime.fromisoformat(stamp)
                value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
                return value.astimezone(ZoneInfo(name)).replace(tzinfo=None).isoformat()
            def trunc(bucket, stamp):
                value = datetime.fromisoformat(stamp)
                value = value.replace(hour=0, minute=0, second=0, microsecond=0)
                if bucket == 'month':
                    value = value.replace(day=1)
                return value.isoformat()
            conn.create_function('timezone', 2, tz)
            conn.create_function('date_trunc', 2, trunc)
        self.prepare_database()

    def prepare_database(self, *, temporary=False):
        self.connection = self.engine.connect()
        if temporary:
            # No fallback to public/application relations if a fixture is missing.
            self.connection.exec_driver_sql('SET LOCAL search_path TO pg_temp, pg_catalog')
        tables = {
            'clients': 'id text, organization_id text, created_at timestamp',
            'orders': 'id text, organization_id text, created_at timestamp',
            'projects': 'id text, organization_id text, created_at timestamp',
            'invoices': 'id text, organization_id text',
            'payments': 'id text, organization_id text, invoice_id text, invoice_currency text, invoice_amount numeric, payment_date date, status text',
            'expenses': 'id text, organization_id text, expense_currency text, expense_amount numeric, expense_date date, status text',
            'accounting_money_entries': 'id text, organization_id text, currency text, amount numeric, entry_date date, kind text',
            'financial_transactions': 'id text, organization_id text, source_id text, source_type text',
            'payroll_periods': 'id text, organization_id text, period_end date',
            'payroll_runs': 'id text, organization_id text, period_id text, currency text, gross_total numeric, status text',
        }
        for table, columns in tables.items():
            if temporary:
                columns = columns.replace('created_at timestamp', 'created_at timestamp with time zone')
            qualifier = 'TEMPORARY ' if temporary else ''
            suffix = ' ON COMMIT DROP' if temporary else ''
            self.connection.exec_driver_sql(f'CREATE {qualifier}TABLE {table} ({columns}){suffix}')
        self.db = QueryDB(self.connection)

    def tearDown(self):
        self.connection.close()
        self.engine.dispose()

    def insert(self, table, **fields):
        if 'created_at' in fields:
            fields['created_at'] = datetime.fromisoformat(fields['created_at']).strftime('%Y-%m-%d %H:%M:%S.%f')
        keys = ','.join(fields)
        params = ','.join(':'+key for key in fields)
        self.connection.execute(text(f'INSERT INTO {table} ({keys}) VALUES ({params})'), fields)

    def seed(self):
        for table in ['clients', 'orders', 'projects']:
            for name, org, stamp in [('before', 'org-a', '2024-03-30 23:59:59'), ('begin', 'org-a', '2024-03-31 00:00:00'), ('last', 'org-a', '2024-03-31 22:59:59'), ('after', 'org-a', '2024-03-31 23:00:00'), ('foreign', 'org-b', '2024-03-31 12:00:00')]:
                self.insert(table, id=name, organization_id=org, created_at=stamp)
        for org in ['org-a', 'org-b']:
            self.insert('invoices', id=org, organization_id=org)
        for name, org, status, amount, invoice in [('paid', 'org-a', 'confirmed', 10.25, 'org-a'), ('pending', 'org-a', 'pending', 1000, 'org-a'), ('foreign', 'org-b', 'confirmed', 1000, 'org-b'), ('bad-link', 'org-a', 'confirmed', 1000, 'org-b')]:
            self.insert('payments', id=name, organization_id=org, invoice_id=invoice, invoice_currency='GBP', invoice_amount=amount, payment_date='2024-03-31', status=status)
        for name, org, status, amount in [('posted', 'org-a', 'posted', 2.25), ('void', 'org-a', 'void', 1000), ('foreign', 'org-b', 'posted', 1000)]:
            self.insert('expenses', id=name, organization_id=org, expense_currency='GBP', expense_amount=amount, expense_date='2024-03-31', status=status)
        for name, org, kind, amount, currency in [('direct-income', 'org-a', 'income', 3.25, 'GBP'), ('direct-expense', 'org-a', 'expense', 4.25, 'GBP'), ('reversed', 'org-a', 'expense', 1000, 'GBP'), ('foreign', 'org-b', 'income', 1000, 'GBP'), ('usd', 'org-a', 'income', 7.5, 'USD')]:
            self.insert('accounting_money_entries', id=name, organization_id=org, kind=kind, amount=amount, currency=currency, entry_date='2024-03-31')
        self.insert('financial_transactions', id='reverse', organization_id='org-a', source_id='reversed', source_type='accounting_money_entry_reversal')
        # Other-tenant reversal must not hide current tenant entry; mirrors never count twice.
        self.insert('financial_transactions', id='foreign-reverse', organization_id='org-b', source_id='direct-income', source_type='accounting_money_entry_reversal')
        self.insert('financial_transactions', id='mirror', organization_id='org-a', source_id='direct-income', source_type='accounting_money_entry')
        for org in ['org-a', 'org-b']:
            self.insert('payroll_periods', id=org, organization_id=org, period_end='2024-03-31')
        for name, org, period, status, amount in [('approved', 'org-a', 'org-a', 'approved', 5.25), ('paid', 'org-a', 'org-a', 'paid', 6.25), ('draft', 'org-a', 'org-a', 'draft', 1000), ('foreign', 'org-b', 'org-b', 'paid', 1000), ('bad-period', 'org-a', 'org-b', 'paid', 1000)]:
            self.insert('payroll_runs', id=name, organization_id=org, period_id=period, currency='GBP', gross_total=amount, status=status)

    def test_actual_queries_tenant_dst_status_reversal_mirrors_and_currency(self):
        self.seed()
        result = dashboard_series(self.db, 'org-a', self.plan('2024-03-31', '2024-04-01'))
        self.assertEqual([(r.projects, r.orders, r.clients) for r in result.counts], [(2,2,2),(1,1,1)])
        gbp, usd = result.money
        self.assertEqual(gbp.currency, 'GBP')
        self.assertEqual(gbp.points[0].income, '13.50')
        self.assertEqual(gbp.points[0].expenses, '18.00')
        self.assertEqual(usd.currency, 'USD')
        self.assertEqual(usd.points[0].income, '7.50')
        self.assertEqual(usd.points[0].expenses, '0.00')
        for series in result.money:
            self.assertEqual(series.points[1].income, '0.00')
            self.assertEqual(series.points[1].expenses, '0.00')
            self.assertEqual([(p.period_start,p.period_end) for p in series.points], [(p.period_start,p.period_end) for p in result.counts])

    def test_monthly_aggregation_clips_partial_bounds_and_excludes_future(self):
        self.seed()
        self.insert('clients', id='april', organization_id='org-a', created_at='2024-04-01 01:00:00')
        self.insert('clients', id='future', organization_id='org-a', created_at='2024-04-03 01:00:00')
        self.insert('payments', id='future', organization_id='org-a', invoice_id='org-a', invoice_currency='GBP', invoice_amount=900, payment_date='2024-04-03', status='confirmed')
        result = dashboard_series(self.db, 'org-a', self.plan('2024-01-17', '2024-04-10'))
        self.assertEqual(result.bucket, 'month')
        self.assertEqual(result.counts[0].period_start, date(2024,1,17))
        self.assertEqual(result.counts[-1].period_end, date(2024,4,2))
        self.assertEqual([r.clients for r in result.counts], [0,0,3,2])
        self.assertEqual([p.income for p in result.money[0].points], ['0.00','0.00','13.50','0.00'])

    def test_empty_rows_zero_counts_no_invented_currency(self):
        result = dashboard_series(self.db, 'org-a', self.plan('2024-03-31', '2024-04-01'))
        self.assertEqual(result.money, [])
        self.assertEqual(len(result.counts), 2)
        self.assertEqual(sum(p.clients for p in result.counts), 0)

    def test_exact_decimal_response_not_float_and_http_permission_boundary(self):
        app = FastAPI()
        app.include_router(router)
        app.dependency_overrides[get_db] = lambda: self.db
        client = TestClient(app)
        # Actual bearer dependency, no tenant override: missing authentication remains 401.
        self.assertEqual(client.get('/reports/dashboard-series').status_code, 401)
        tenant = SimpleNamespace(organization_id='org-a', organization=SimpleNamespace(timezone='Europe/London'), organization_role=SimpleNamespace(is_active=True,permissions=[]))
        app.dependency_overrides[get_tenant_context] = lambda: tenant
        self.assertEqual(client.get('/reports/dashboard-series').status_code, 403)
        tenant.organization_role.permissions = ['dashboard.view']
        self.assertEqual(client.get('/reports/dashboard-series').status_code, 403)
        tenant.organization_role.permissions = ['reports.view']
        tenant.organization_role.is_active = False
        self.assertEqual(client.get('/reports/dashboard-series').status_code, 403)
        tenant.organization_role.is_active = True
        result = client.get('/reports/dashboard-series?date_from=2024-03-31&date_to=2024-04-01')
        self.assertEqual(result.status_code, 200, result.text)
        self.assertEqual(result.json()['organization_id'], 'org-a')
        self.assertEqual(client.get('/reports/dashboard-series?date_from=2024-01-01&date_to=2025-01-01').status_code, 400)
        class ExactDB:
            calls = 0
            def execute(self, query):
                self.calls += 1
                return [(datetime(2024,3,31), 'GBP', Decimal('9999999999999999.99'))] if self.calls == 4 else []
        result = dashboard_series(ExactDB(), 'org-a', self.plan('2024-03-31', '2024-03-31'))
        self.assertEqual(json.loads(result.model_dump_json())['money'][0]['points'][0]['income'], '9999999999999999.99')


if __name__ == '__main__':
    unittest.main()
