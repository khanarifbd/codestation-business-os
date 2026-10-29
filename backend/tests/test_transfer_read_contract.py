"""Offline source/function contract tests. No DB, ASGI server or provider is exercised."""
import ast
import hashlib
from pathlib import Path
from types import SimpleNamespace
import unittest

SOURCE = Path(__file__).parents[1] / "app/api/v1/finance_transfers.py"
ORIGINAL_SOURCE_SHA256 = "2ce8c6a4a267c70a7fc8b1120b510efc6df37955fdb9dfb6238fb8bf093d59da"
class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, other): return (self.name, getattr(other, 'name', other))
class Query:
    def __init__(self): self.conditions = []; self.joins = []
    def join(self, *parts): self.joins.append(parts); return self
    def where(self, *conditions): self.conditions.extend(conditions); return self
class HttpError(Exception):
    def __init__(self, status_code, detail): self.status_code = status_code; self.detail = detail

def function(name):
    node = next(node for node in ast.parse(SOURCE.read_text()).body if isinstance(node, ast.FunctionDef) and node.name == name)
    node.decorator_list = []
    module = ast.Module(body=[ast.ImportFrom(module='__future__', names=[ast.alias(name='annotations')], level=0), node], type_ignores=[])
    ast.fix_missing_locations(module)
    return compile(module, str(SOURCE), 'exec')
class TransferReadTests(unittest.TestCase):
    def source_before_approved_period_safety(self):
        # Keep the original hash and all unchanged bytes protected. This is not
        # a claim that today's writer is unchanged: its exact approved lock/type
        # delta is exercised separately by actual-handler freshness tests.
        source=SOURCE.read_text()
        changes=[
            ('from app.services.financial_account_constraints import ensure_transfer_accounts_supported\n',''),
            ('        .with_for_update().execution_options(populate_existing=True)\n','        .with_for_update()\n'),
            ('    ensure_transfer_accounts_supported(source.account_type, destination.account_type)\n\n',''),
        ]
        for approved, original in changes:
            self.assertEqual(source.count(approved),1)
            source=source.replace(approved,original,1)
        return source
    def call(self, organization='company-A', transfer_id='transfer-A', row=True):
        query = Query(); calls = []
        columns = SimpleNamespace(id=Column('id'), organization_id=Column('organization_id'), from_account_id=Column('from_account_id'), to_account_id=Column('to_account_id'))
        account = SimpleNamespace(id=Column('account.id'), name=Column('account.name'))
        selected = ('saved transfer', 'Source', 'Destination') if row else None
        db = SimpleNamespace(execute=lambda q: (calls.append(q) or SimpleNamespace(first=lambda: selected)))
        ns = dict(select=lambda *args: query, AccountTransfer=columns, FinancialAccount=account, aliased=lambda _: account, HTTPException=HttpError, _transfer_read=lambda *args: {'builder_args': args})
        exec(function('get_transfer'), ns)
        try: result = ns['get_transfer'](transfer_id, db, SimpleNamespace(organization_id=organization))
        except HttpError as error: result = error
        return result, query, calls
    def test_tenant_and_id_predicates_are_both_required(self):
        _, q, _ = self.call()
        self.assertEqual(q.conditions, [('organization_id','company-A'),('id','transfer-A')])
    def test_other_company_uses_its_own_scope(self):
        _, q, _ = self.call(organization='company-B')
        self.assertIn(('organization_id','company-B'),q.conditions)
        self.assertNotIn(('organization_id','company-A'),q.conditions)
    def test_existing_response_builder_receives_saved_row_and_names(self):
        result, q, calls = self.call()
        self.assertEqual(result, {'builder_args': ('saved transfer','Source','Destination')})
        self.assertEqual(len(q.joins), 2); self.assertEqual(len(calls), 1)
    def test_missing_or_out_of_scope_record_is_404(self):
        result, _, _ = self.call(row=False)
        self.assertEqual(result.status_code,404); self.assertEqual(result.detail,'Transfer not found')
    def test_new_route_requires_exact_finance_viewer(self):
        tree=ast.parse(SOURCE.read_text()); fn=next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='get_transfer')
        self.assertEqual(ast.unparse(fn.args.args[2].annotation),'FinanceViewer')
        self.assertEqual(ast.unparse(fn.decorator_list[0]),"router.get('/transfers/{transfer_id}', response_model=AccountTransferRead)")
        self.assertIn('require_tenant_permission("finance.view")',SOURCE.read_text())
    def test_existing_write_and_list_bytes_remain_after_exact_approved_deltas(self):
        content=self.source_before_approved_period_safety()
        current=ast.parse(content)
        current.body=[n for n in current.body if not isinstance(n,ast.FunctionDef) or n.name!='get_transfer']
        start=content.index('@router.get("/transfers/{transfer_id}"')
        end=content.index('@router.post("/transfers"',start)
        restored=content[:start]+content[end:]
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),ORIGINAL_SOURCE_SHA256)
        # AST dumps vary across Python versions; both trees must use this interpreter.
        original=ast.parse(restored)
        self.assertEqual(ast.dump(current,include_attributes=False),ast.dump(original,include_attributes=False))
    def test_removing_read_and_exact_approved_lock_delta_restores_original_bytes(self):
        content=self.source_before_approved_period_safety()
        start=content.index('@router.get("/transfers/{transfer_id}"')
        end=content.index('@router.post("/transfers"',start)
        restored=content[:start]+content[end:]
        self.assertEqual(hashlib.sha256(restored.encode()).hexdigest(),ORIGINAL_SOURCE_SHA256)
    def test_reader_cannot_commit_mutate_or_call_provider(self):
        fn=next(n for n in ast.parse(SOURCE.read_text()).body if isinstance(n,ast.FunctionDef) and n.name=='get_transfer')
        calls=[ast.unparse(n.func) for n in ast.walk(fn) if isinstance(n,ast.Call)]
        self.assertFalse(any(c.endswith(('.commit','.flush','.add','.delete','.post','.patch')) for c in calls))
    def test_only_one_additive_get_and_no_schema_or_write_route_changes(self):
        tree=ast.parse(SOURCE.read_text()); routes=[ast.unparse(d) for n in tree.body if isinstance(n,ast.FunctionDef) for d in n.decorator_list]
        self.assertEqual(sum("'/transfers/{transfer_id}'" in d for d in routes),1)
        self.assertEqual(sum('router.post' in d for d in routes),1)
        self.assertFalse(any('router.patch' in d or 'router.delete' in d for d in routes))
if __name__=='__main__': unittest.main(verbosity=2)
