"""Core company PATCH names: real schema and handler, intercepted flush only."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from pydantic import ValidationError
from app.schemas.company_settings import CoreCompanyUpdate


class AtFlush(Exception):
    pass


class ReadSnapshot:
    @classmethod
    def model_validate(cls, value): return cls()
    def model_dump(self, **kwargs): return {}


def handler_assignment(payload):
    path = Path(__file__).resolve().parents[1] / 'app/api/v1/company_settings.py'
    node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'update_core_company')
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    namespace = {'OrganizationRead': ReadSnapshot}
    exec(compile(ast.fix_missing_locations(module), str(path), 'exec'), namespace)
    row = SimpleNamespace(name='Existing company', business_type='Services', team_size='Small')
    class DB:
        def flush(self): raise AtFlush()
    try:
        namespace['update_core_company'](payload, None, DB(), SimpleNamespace(organization=row))
    except AtFlush:
        return row
    raise AssertionError('Expected intercepted flush')


class Tests(unittest.TestCase):
    def test_omitted_preserves_existing_name(self):
        payload = CoreCompanyUpdate()
        self.assertEqual(payload.model_dump(exclude_unset=True), {})
        self.assertEqual(handler_assignment(payload).name, 'Existing company')
    def test_optional_fields_explicit_clear(self):
        payload = CoreCompanyUpdate(business_type=None, team_size=None)
        self.assertEqual(payload.model_dump(exclude_unset=True), {'business_type': None, 'team_size': None})
        row = handler_assignment(payload)
        self.assertIsNone(row.business_type)
        self.assertIsNone(row.team_size)
        self.assertEqual(row.name, 'Existing company')
    def test_optional_whitespace_clear_unchanged(self):
        row = handler_assignment(CoreCompanyUpdate(business_type='   ', team_size=' \t '))
        self.assertIsNone(row.business_type)
        self.assertIsNone(row.team_size)
    def test_optional_lengths_unchanged(self):
        CoreCompanyUpdate(business_type='A' * 80, team_size='A' * 32)
        for field, value in [('business_type', 'A' * 81), ('team_size', 'A' * 33)]:
            with self.assertRaises(ValidationError): CoreCompanyUpdate(**{field: value})


for label, value in [('null', None), ('spaces', '   '), ('mixed', ' \t\n '), ('unicode_blank', '\u00a0\u2003'), ('empty', ''), ('short', 'A'), ('too_long', 'A' * 181)]:
    def rejected(self, value=value):
        with self.assertRaises(ValidationError) as error: CoreCompanyUpdate(name=value)
        self.assertEqual(error.exception.errors()[0]['loc'], ('name',))
    setattr(Tests, 'test_reject_' + label, rejected)
for label, value in [('normal', 'CodeStation'), ('padded', '  CodeStation \t'), ('unicode', '  আরিফ খান  '), ('internal_spaces', 'A  B'), ('padded_single', ' A '), ('maximum', 'A' * 180)]:
    def valid(self, value=value):
        payload = CoreCompanyUpdate(name=value)
        self.assertEqual(payload.name, value)
        self.assertEqual(handler_assignment(payload).name, value.strip())
    setattr(Tests, 'test_valid_' + label, valid)
