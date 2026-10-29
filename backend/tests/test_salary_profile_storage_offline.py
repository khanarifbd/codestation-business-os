"""Salary profile Numeric(18,2) fit without changing existing cent rounding."""
import ast
from pathlib import Path
from datetime import date
from decimal import Decimal, ROUND_HALF_UP
import unittest
from pydantic import ValidationError
from app.schemas.payroll import SalaryProfileCreate, SalaryProfileUpdate


def create(value):
    return SalaryProfileCreate(employee_id='synthetic', currency='USD', effective_from=date(2026, 1, 1), base_salary=value)


def money(value):
    path = Path(__file__).resolve().parents[1] / 'app/api/v1/payroll.py'
    node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == '_money')
    namespace = {'Decimal': Decimal, 'ROUND_HALF_UP': ROUND_HALF_UP, 'MONEY': Decimal('.01')}
    exec(compile(ast.fix_missing_locations(ast.Module(body=[node], type_ignores=[])), str(path), 'exec'), namespace)
    return namespace['_money'](value)


class Tests(unittest.TestCase):
    def test_update_omission_unchanged(self):
        self.assertEqual(SalaryProfileUpdate().model_dump(exclude_unset=True), {})
    def test_update_explicit_null_still_rejected(self):
        with self.assertRaises(ValidationError): SalaryProfileUpdate(base_salary=None)
    def test_optional_clear_unchanged(self):
        self.assertEqual(SalaryProfileUpdate(notes=None, effective_to=None).model_dump(exclude_unset=True), {'notes': None, 'effective_to': None})


for kind, factory in [('create', create), ('update', lambda value: SalaryProfileUpdate(base_salary=value))]:
    for label, value in [('overflow', '10000000000000000'), ('rounding_carry', '9999999999999999.995'), ('huge', '1e100'), ('very_huge', '1e100000'), ('nan', 'NaN'), ('inf', 'Infinity'), ('zero', '0'), ('negative', '-1')]:
        def reject(self, value=value, factory=factory):
            with self.assertRaises(ValidationError): factory(value)
        setattr(Tests, 'test_' + kind + '_reject_' + label, reject)
    for label, value, rounded in [('maximum', '9999999999999999.99', '9999999999999999.99'), ('under_carry', '9999999999999999.994', '9999999999999999.99'), ('normal_round', '123.455', '123.46'), ('round_down', '123.454', '123.45'), ('tiny_existing', '0.001', '0.00'), ('ordinary', '123.45', '123.45')]:
        def accept(self, value=value, rounded=rounded, factory=factory):
            payload = factory(value)
            self.assertEqual(payload.base_salary, Decimal(value))
            self.assertEqual(money(payload.base_salary), Decimal(rounded))
        setattr(Tests, 'test_' + kind + '_preserve_' + label, accept)
