"""CRM contact-name contract with a source-relative real handler and fake flush."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from pydantic import ValidationError
from app.schemas.crm import LeadUpdate, LeadStatusUpdate, LeadSourceUpdate

class AtFlush(Exception): pass
class Expression:
    def __eq__(self, other): return self
    def where(self, *args): return self


def handler_assignment(payload):
    path = Path(__file__).resolve().parents[1] / 'app/api/v1/crm.py'
    node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == 'update_lead')
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    expr = Expression()
    ns = {'select': lambda *a: expr, 'Lead': SimpleNamespace(id=expr, organization_id=expr)}
    exec(compile(ast.fix_missing_locations(module), str(path), 'exec'), ns)
    row = SimpleNamespace(id='lead', contact_name='Original', company_name=None, status_id='status', source_id=None, assigned_employee_id=None, estimated_value=None, probability_percent=0, next_follow_up_at=None)
    class DB:
        def scalar(self, query): return row
        def flush(self): raise AtFlush()
    try: ns['update_lead']('lead', payload, None, DB(), SimpleNamespace(organization_id='org'))
    except AtFlush: return row.contact_name
    raise AssertionError('Expected intercepted flush')

class Tests(unittest.TestCase):
    def test_omitted_preserves_existing_contact(self):
        self.assertEqual(LeadUpdate().model_dump(exclude_unset=True), {})
        self.assertEqual(handler_assignment(LeadUpdate()), 'Original')
    def test_explicit_null_still_rejected(self):
        with self.assertRaises(ValidationError): LeadUpdate(contact_name=None)
    def test_empty_still_rejected(self):
        with self.assertRaises(ValidationError): LeadUpdate(contact_name='')
    def test_optional_status_source_whitespace_unchanged(self):
        for cls in [LeadStatusUpdate, LeadSourceUpdate]: self.assertEqual(cls(name='   ').name, '   ')
    def test_nullable_other_field_clear_unchanged(self):
        self.assertEqual(LeadUpdate(company_name=None).model_dump(exclude_unset=True), {'company_name': None})

for name, value in [('spaces','   '),('tabs','\t\t'),('newlines','\r\n'),('mixed',' \t\n '),('unicode_spaces','\u00a0\u2003\u3000')]:
    def test(self, value=value):
        with self.assertRaises(ValidationError) as err: LeadUpdate(contact_name=value)
        self.assertEqual(err.exception.errors()[0]['loc'], ('contact_name',))
    setattr(Tests, 'test_reject_' + name, test)
for name,value in [('ordinary','Jane Doe'),('trim','  Jane Doe \t'),('unicode','  আরিফ খান  '),('internal_spaces',' Jane  Doe '),('internal_tab',' Jane\tDoe '),('single_character','李')]:
    def test(self, value=value):
        payload = LeadUpdate(contact_name=value)
        self.assertEqual(payload.contact_name, value)
        self.assertEqual(handler_assignment(payload), value.strip())
    setattr(Tests, 'test_preserve_' + name, test)
