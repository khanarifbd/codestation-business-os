"""CI-only actual PostgreSQL query/HTTP tests with transaction-local synthetic tables.

Never touches application/customer tables: TEMPORARY relations shadow each source
on one connection and disappear on rollback/close. No credentials embedded.
Run in existing disposable CI database: ENVIRONMENT=test CI=true python ...
"""
import os
import sys
import unittest
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tests'))
from test_dashboard_series_unit import QueryTests
from app.services.dashboard_series import dashboard_series


def isolated_test_url():
    raw = os.environ.get('DATABASE_URL', '')
    try:
        url = make_url(raw)
    except Exception:
        raise RuntimeError('A valid isolated CI test DATABASE_URL is required') from None
    if (os.environ.get('CI') != 'true' or os.environ.get('ENVIRONMENT') != 'test'
            or url.host not in {'localhost', '127.0.0.1', '::1'}
            or not url.drivername.startswith('postgresql')):
        raise RuntimeError('Dashboard series PostgreSQL tests require explicitly isolated loopback CI test runtime')
    return url


class PostgresSeriesTests(QueryTests):
    def setUp(self):
        self.engine = create_engine(isolated_test_url())
        self.prepare_database(temporary=True)
        self.connection.exec_driver_sql("SET LOCAL TIME ZONE 'UTC'")
        for name in ['clients', 'orders', 'projects', 'invoices', 'payments', 'expenses',
                     'accounting_money_entries', 'financial_transactions', 'payroll_periods', 'payroll_runs']:
            temporary = self.connection.exec_driver_sql(
                "SELECT relpersistence = 't' AND relnamespace = pg_my_temp_schema() "
                'FROM pg_class WHERE oid = to_regclass(%s)', (name,),
            ).scalar_one()
            self.assertTrue(temporary, 'Every source relation must resolve to a session-local fixture')

    def test_postgres_exact_numeric_sum_above_javascript_safe_integer(self):
        self.insert('accounting_money_entries', id='large', organization_id='org-a', kind='income', amount='9999999999999999.99', currency='GBP', entry_date='2024-03-31')
        result = dashboard_series(self.db, 'org-a', self.plan('2024-03-31', '2024-03-31'))
        self.assertEqual(result.money[0].points[0].income, '9999999999999999.99')


if __name__ == '__main__':
    isolated_test_url()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(PostgresSeriesTests)
    outcome = unittest.TextTestRunner(verbosity=2).run(suite)
    raise SystemExit(0 if outcome.wasSuccessful() else 1)
