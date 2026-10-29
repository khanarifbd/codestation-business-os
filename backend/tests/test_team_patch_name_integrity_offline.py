"""Required team PATCH names: real schemas/handler assignments, no database."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from app.schemas.team import RoleUpdate, DepartmentUpdate, DesignationUpdate


class AtFlush(Exception):
    pass


class Expression:
    def __eq__(self, other): return self
    def where(self, *args): return self


class ReadSnapshot:
    @classmethod
    def model_validate(cls, value): return cls()
    def model_dump(self, **kwargs): return {}


def handler_name(schema, payload):
    names = {RoleUpdate: ('update_role', 'OrganizationRole'), DepartmentUpdate: ('update_department', 'Department'), DesignationUpdate: ('update_designation', 'Designation')}
    function, model = names[schema]
    path = Path(__file__).resolve().parents[1] / 'app/api/v1/team.py'
    node = next(n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef) and n.name == function)
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    expr = Expression()
    namespace = {'select': lambda *a: expr, model: SimpleNamespace(id=expr, organization_id=expr), 'IntegrityError': IntegrityError}
    namespace.update({name: ReadSnapshot for name in ('RoleRead', 'DepartmentRead', 'DesignationRead')})
    exec(compile(ast.fix_missing_locations(module), str(path), 'exec'), namespace)
    row = SimpleNamespace(id='synthetic', name='Existing name', is_system=False)
    class DB:
        def scalar(self, query): return row
        def flush(self): raise AtFlush()
    try:
        namespace[function]('synthetic', payload, None, DB(), SimpleNamespace(organization_id='synthetic-org'))
    except AtFlush:
        return row.name
    raise AssertionError('Expected intercepted flush')


class Tests(unittest.TestCase):
    def test_nullable_fields_and_role_permissions_unchanged(self):
        for schema in (RoleUpdate, DepartmentUpdate, DesignationUpdate):
            self.assertEqual(schema(description=None).model_dump(exclude_unset=True), {'description': None})
        for schema in (DepartmentUpdate, DesignationUpdate):
            self.assertEqual(schema(code=None).model_dump(exclude_unset=True), {'code': None})
        self.assertEqual(RoleUpdate(permissions=None).model_dump(exclude_unset=True), {'permissions': None})
        self.assertEqual(RoleUpdate(permissions=[]).model_dump(exclude_unset=True), {'permissions': []})


for schema in (RoleUpdate, DepartmentUpdate, DesignationUpdate):
    def omitted(self, schema=schema):
        self.assertEqual(schema().model_dump(exclude_unset=True), {})
        self.assertEqual(handler_name(schema, schema()), 'Existing name')
    setattr(Tests, 'test_' + schema.__name__ + '_omitted', omitted)
    for label, value in [('null', None), ('spaces', '   '), ('mixed', ' \t\n '), ('unicode_blank', '\u00a0\u2003'), ('empty', ''), ('short', 'A'), ('too_long', 'A' * (81 if schema is RoleUpdate else 121))]:
        def rejected(self, schema=schema, value=value):
            with self.assertRaises(ValidationError) as error:
                schema(name=value)
            self.assertEqual(error.exception.errors()[0]['loc'], ('name',))
        setattr(Tests, 'test_' + schema.__name__ + '_reject_' + label, rejected)
    for label, value in [('normal', 'Engineering'), ('padded', '  Engineering \t'), ('unicode', '  আরিফ খান  '), ('internal_space', 'A  B'), ('padded_single', ' A '), ('maximum', 'A' * (80 if schema is RoleUpdate else 120))]:
        def valid(self, schema=schema, value=value):
            payload = schema(name=value)
            self.assertEqual(payload.name, value)
            self.assertEqual(handler_name(schema, payload), value.strip())
        setattr(Tests, 'test_' + schema.__name__ + '_valid_' + label, valid)
