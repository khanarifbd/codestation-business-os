"""Offline actual-function + DTO tests with a synthetic query recorder.

No application config import, database, HTTP, provider or real tenant is used.
Query predicates and response fields are checked; this is not PostgreSQL proof.
"""
import ast
import hashlib
from pathlib import Path
import runpy
from types import SimpleNamespace as NS
import unittest

ROOT = Path(__file__).parents[1]
SCHEMA = runpy.run_path(str(ROOT / "app/schemas/expenses.py"))


class Column:
    def __init__(self, name): self.name = name
    def __eq__(self, value): return (self.name, "eq", value)
    def in_(self, values): return (self.name, "in", list(values))


class Query:
    def __init__(self, model): self.model, self.conditions, self.joins, self.order = model, [], [], []
    def where(self, *conditions): self.conditions.extend(conditions); return self
    def join(self, *conditions): self.joins.append(conditions); return self
    def order_by(self, *order): self.order.extend(order); return self


def model(name):
    return NS(name=name, id=Column(name+".id"), organization_id=Column(name+".organization_id"),
              client_id=Column(name+".client_id"), display_name=Column(name+".display_name"))


def fixture(kind, ident, **overrides):
    row = dict(id=ident, organization_id="synthetic-A", client_id="client", currency="EUR", total="20.00", status="confirmed",
               invoice_number="SYN-I-"+ident, project_number="SYN-P-"+ident, order_number="SYN-O-"+ident,
               name="Synthetic project", client_name_snapshot="Synthetic client", order_id=None, project_id=None)
    row.update(overrides)
    return NS(**row)


class Recorder:
    def __init__(self, invoices=(), projects=(), orders=()):
        self.rows = {"Invoice": list(invoices), "Project": list(projects), "Order": list(orders)}
        self.calls = []
    def _read(self, query):
        self.calls.append(query)
        kind = query.model.name
        assert len(query.conditions) == 2
        org = next(value for column, op, value in query.conditions if column == kind+".organization_id" and op == "eq")
        ids = next(value for column, op, value in query.conditions if column == kind+".id" and op == "in")
        rows = sorted((row for row in self.rows[kind] if row.organization_id == org and row.id in ids), key=lambda r:r.id)
        if kind == "Project": rows = [(row, "Synthetic client") for row in rows]
        return NS(all=lambda: rows)
    def scalars(self, query): return self._read(query)
    def execute(self, query): return self._read(query)


def call(db, *, org="synthetic-A", invoices=(), project_rows=(), orders=(), payment_rows=()):
    tree = ast.parse((ROOT / "app/services/expense_relationship_context.py").read_text())
    fn = next(node for node in tree.body if isinstance(node, ast.FunctionDef))
    namespace = dict(SCHEMA, select=lambda *items: Query(items[0]), and_=lambda *items: items,
                     **{name:model(name) for name in ("Invoice", "Project", "Order", "Client")})
    exec(compile(ast.Module(body=[fn], type_ignores=[]), "expense_context", "exec"), namespace)
    return namespace[fn.name](db, org, invoices=invoices, project_rows=project_rows, orders=orders, payment_rows=payment_rows)


class ExpenseContextTests(unittest.TestCase):
    def test_empty_sources_perform_no_queries(self):
        db=Recorder(); result=call(db)
        self.assertEqual(result.model_dump(), {"invoices":[], "projects":[], "orders":[]}); self.assertEqual(db.calls, [])

    def test_recent_payment_closes_older_invoice_project_and_order(self):
        invoice=fixture("invoice","old-invoice",project_id="old-project",order_id="old-order")
        project=fixture("project","old-project",order_id="old-order")
        order=fixture("order","old-order")
        db=Recorder([invoice],[project],[order]); result=call(db,payment_rows=[(NS(invoice_id=invoice.id),"SYN-I","client","Synthetic")])
        self.assertEqual([row.id for row in result.invoices],[invoice.id]); self.assertEqual([row.id for row in result.projects],[project.id]); self.assertEqual([row.id for row in result.orders],[order.id]); self.assertEqual(len(db.calls),3)

    def test_already_loaded_ancestors_are_not_duplicated_or_mutated(self):
        invoice=fixture("invoice","invoice",project_id="project",order_id="order"); project=fixture("project","project",order_id="order"); order=fixture("order","order")
        invoices=[invoice]; projects=[(project,"Synthetic")]; orders=[order]
        db=Recorder(); result=call(db,invoices=invoices,project_rows=projects,orders=orders,payment_rows=[(NS(invoice_id=invoice.id),)])
        self.assertEqual(result.model_dump(), {"invoices":[], "projects":[], "orders":[]}); self.assertEqual(db.calls,[])
        self.assertEqual(invoices,[invoice]); self.assertEqual(projects,[(project,"Synthetic")]); self.assertEqual(orders,[order])

    def test_project_ancestor_order_is_fetched_without_invoice(self):
        db=Recorder(orders=[fixture("order","old-order")]); result=call(db,project_rows=[(fixture("project","project",order_id="old-order"),"Synthetic")])
        self.assertEqual(len(db.calls),1); self.assertEqual(result.orders[0].id,"old-order")

    def test_cross_tenant_references_cannot_be_returned(self):
        foreign=fixture("invoice","foreign",organization_id="synthetic-B",project_id="secret-project")
        db=Recorder([foreign]); result=call(db,payment_rows=[(NS(invoice_id="foreign"),)])
        self.assertEqual(result.invoices,[]); self.assertEqual(result.projects,[]); self.assertEqual(len(db.calls),1)
        self.assertIn(("Invoice.organization_id","eq","synthetic-A"),db.calls[0].conditions)

    def test_project_join_has_independent_client_tenant_scope(self):
        db=Recorder(projects=[fixture("project","project",order_id="order")]); call(db,invoices=[fixture("invoice","invoice",project_id="project")])
        project_query=db.calls[0]
        self.assertEqual(project_query.model.name,"Project")
        self.assertIn(("Client.organization_id","eq","synthetic-A"),project_query.joins[0][1])
        self.assertIn(("Project.organization_id","eq","synthetic-A"),project_query.conditions)

    def test_second_tenant_changes_every_query_scope(self):
        db=Recorder([fixture("invoice","invoice",organization_id="synthetic-B",project_id="project")],[fixture("project","project",organization_id="synthetic-B",order_id="order")],[fixture("order","order",organization_id="synthetic-B")])
        result=call(db,org="synthetic-B",payment_rows=[(NS(invoice_id="invoice"),)])
        self.assertEqual(result.orders[0].id,"order")
        for query in db.calls: self.assertIn((query.model.name+".organization_id","eq","synthetic-B"),query.conditions)

    def test_deduplicated_missing_ids_are_sorted_and_batched(self):
        db=Recorder(); call(db,payment_rows=[(NS(invoice_id="z"),),(NS(invoice_id="a"),),(NS(invoice_id="z"),)])
        self.assertEqual(db.calls[0].conditions[1],("Invoice.id","in",["a","z"]))
        self.assertEqual(len(db.calls),1)

    def test_suggestion_maximum_does_not_cause_per_row_queries(self):
        invoices=[fixture("invoice",str(i),project_id="p"+str(i),order_id="o"+str(i)) for i in range(500)]
        projects=[fixture("project","p"+str(i),order_id="o"+str(i)) for i in range(500)]
        orders=[fixture("order","o"+str(i)) for i in range(500)]
        db=Recorder(invoices,projects,orders)
        result=call(db,payment_rows=[(NS(invoice_id=str(i)),) for i in range(500)])
        self.assertEqual(len(db.calls),3); self.assertEqual([len(result.invoices),len(result.projects),len(result.orders)],[500,500,500])

    def test_only_existing_meta_fields_are_serialized(self):
        invoice=fixture("invoice","invoice",internal_notes="DO NOT EXPOSE",secret="DO NOT EXPOSE")
        db=Recorder([invoice]); result=call(db,payment_rows=[(NS(invoice_id="invoice"),)])
        self.assertEqual(set(result.invoices[0].model_dump()),set(SCHEMA['ExpenseMetaInvoice'].model_fields))
        self.assertNotIn("DO NOT EXPOSE",result.model_dump_json())

    def test_old_meta_payload_remains_valid_with_independent_empty_context(self):
        payload={key:[] for key in ("vendors","categories","accounts","clients","projects","orders","invoices","payments")}
        first=SCHEMA['ExpenseMeta'](**payload); second=SCHEMA['ExpenseMeta'](**payload)
        self.assertEqual(first.model_dump(exclude={"relationship_context"}),payload)
        self.assertIsNot(first.relationship_context,second.relationship_context)
        self.assertEqual(first.relationship_context.model_dump(),{"invoices":[],"projects":[],"orders":[]})

    def test_existing_api_permission_route_and_suggestion_queries_are_exact(self):
        source=(ROOT/'app/api/v1/finance_expenses.py').read_text()
        self.assertIn('FinanceViewer = Annotated[TenantContext, Depends(require_tenant_permission("finance.view"))]',source)
        self.assertIn('@router.get("/expense-meta", response_model=ExpenseMeta)\ndef expense_meta(db: DbSession, tenant: FinanceViewer)',source)
        # Explicit later transaction-safety layer; preserve the historical hash
        # after reversing exactly these audited changes, not a broad hash waiver.
        approved_period_changes=[
            ('from app.services.financial_account_constraints import ensure_expense_posting_account_supported\n',''),
            ('from app.services.accounting_period_gate import acquire_accounting_period_gate, ensure_accounting_period_open\n',''),
            ('    ensure_expense_posting_account_supported(account.account_type)\n',''),
            ('    acquire_accounting_period_gate(db, tenant.organization_id)\n',''),
            ('    ensure_accounting_period_open(db, tenant.organization_id, item.expense_date)\n',''),
            ('    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update().execution_options(populate_existing=True))','    account = db.scalar(select(FinancialAccount).where(FinancialAccount.id == payload.account_id, FinancialAccount.organization_id == tenant.organization_id).with_for_update())'),
            ('    item = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.organization_id == tenant.organization_id).with_for_update().execution_options(populate_existing=True))','    item = db.scalar(select(Expense).where(Expense.id == expense_id, Expense.organization_id == tenant.organization_id).with_for_update())'),
        ]
        for approved,original in approved_period_changes:
            self.assertEqual(source.count(approved),1)
            source=source.replace(approved,original,1)
        source=source.replace('from app.services.expense_relationship_context import expense_relationship_context\n','')
        source=source.replace('        relationship_context=expense_relationship_context(\n            db, tenant.organization_id, invoices=invoices, project_rows=project_rows,\n            orders=orders, payment_rows=payment_rows,\n        ),\n','')
        # Separately tested FX storage guards are the other approved layer.
        # Keep the prior hash: all permission/route/suggestion and other handler bytes remain protected.
        for approved_fx_guard in ['# Existing Numeric(18, 2) and Numeric(18, 8) storage bounds, not input-policy limits.\nMAX_STORED_MONEY = Decimal("9999999999999999.99")\nMAX_STORED_RATE = Decimal("9999999999.99999999")\n', '\n\ndef _require_positive_stored(value: Decimal, maximum: Decimal, label: str) -> None:\n    """Reject rounded underflow/overflow rather than clamp a financial conversion."""\n    if not value.is_finite() or value <= 0 or value > maximum:\n        raise HTTPException(\n            status_code=400,\n            detail=f"{label} must remain positive and fit the supported stored precision after rounding",\n        )\n', '    _require_positive_stored(expense_amount, MAX_STORED_MONEY, "Expense amount")\n', '\n    _require_positive_stored(account_amount, MAX_STORED_MONEY, "Account amount")\n    _require_positive_stored(exchange_rate, MAX_STORED_RATE, "Account exchange rate")\n', '\n    _require_positive_stored(profitability_amount, MAX_STORED_MONEY, "Profitability amount")\n    _require_positive_stored(profitability_exchange_rate, MAX_STORED_RATE, "Profitability exchange rate")\n']:
            self.assertEqual(source.count(approved_fx_guard), 1)
            source=source.replace(approved_fx_guard, '')
        self.assertEqual(hashlib.sha256(source.encode()).hexdigest(),'6098ca1cbbb397ef53c49aa585f2bde058a7b38744d6a627b04218bcb9b9fc4d')

    def test_no_mutation_network_config_or_per_record_query_loop(self):
        tree=ast.parse((ROOT/'app/services/expense_relationship_context.py').read_text())
        calls=[ast.unparse(node.func) for node in ast.walk(tree) if isinstance(node,ast.Call)]
        self.assertEqual(calls.count('db.scalars'),2); self.assertEqual(calls.count('db.execute'),1)
        self.assertFalse(any(name.endswith(('.add','.commit','.flush','.delete','.post','.getenv')) for name in calls))
        self.assertFalse(any(isinstance(node,(ast.For,ast.While)) for node in ast.walk(tree)))
        self.assertNotIn('settings',ast.unparse(tree))


class ExpenseContextSqlCompilationTests(unittest.TestCase):
    """Compile the actual function's statements using SQLAlchemy/PostgreSQL.

    Stand-in ORM tables have no connection/session/engine; this checks SQL
    structure and bound tenant parameters, not PostgreSQL behavior or HTTP RBAC.
    """
    def compile_context(self, organization):
        from sqlalchemy import String, and_, select
        from sqlalchemy.dialects import postgresql
        from sqlalchemy.orm import DeclarativeBase, mapped_column

        class Base(DeclarativeBase): pass
        class InvoiceSql(Base):
            __tablename__ = "synthetic_invoices"
            id = mapped_column(String, primary_key=True)
            organization_id = mapped_column(String)
        class ProjectSql(Base):
            __tablename__ = "synthetic_projects"
            id = mapped_column(String, primary_key=True)
            organization_id = mapped_column(String)
            client_id = mapped_column(String)
        class OrderSql(Base):
            __tablename__ = "synthetic_orders"
            id = mapped_column(String, primary_key=True)
            organization_id = mapped_column(String)
        class ClientSql(Base):
            __tablename__ = "synthetic_clients"
            id = mapped_column(String, primary_key=True)
            organization_id = mapped_column(String)
            display_name = mapped_column(String)

        invoice=fixture("invoice","old-invoice",organization_id=organization,project_id="old-project",order_id="old-order")
        project=fixture("project","old-project",organization_id=organization,order_id="old-order")
        order=fixture("order","old-order",organization_id=organization)
        compiled=[]
        class SqlRecorder:
            def scalars(self, statement):
                compiled.append(statement.compile(dialect=postgresql.dialect(),compile_kwargs={"render_postcompile":True}))
                return NS(all=lambda: [invoice] if len(compiled)==1 else [order])
            def execute(self, statement):
                compiled.append(statement.compile(dialect=postgresql.dialect(),compile_kwargs={"render_postcompile":True}))
                return NS(all=lambda: [(project,"Synthetic client")])
        tree=ast.parse((ROOT / "app/services/expense_relationship_context.py").read_text())
        fn=next(node for node in tree.body if isinstance(node,ast.FunctionDef))
        namespace=dict(SCHEMA,select=select,and_=and_,Invoice=InvoiceSql,Project=ProjectSql,Order=OrderSql,Client=ClientSql)
        exec(compile(ast.Module(body=[fn],type_ignores=[]),"expense_context_sql", "exec"),namespace)
        result=namespace[fn.name](SqlRecorder(),organization,invoices=[],project_rows=[],orders=[],payment_rows=[(NS(invoice_id=invoice.id),)])
        return result,compiled

    def test_real_postgresql_compiler_retains_each_tenant_predicate_and_batched_ids(self):
        result,queries=self.compile_context("synthetic-company-A")
        self.assertEqual(len(queries),3)
        self.assertEqual(result.orders[0].id,"old-order")
        for table,ident,query in zip(("invoices","projects","orders"),("old-invoice","old-project","old-order"),queries):
            sql=str(query)
            self.assertIn("WHERE synthetic_"+table+".organization_id = ",sql)
            self.assertIn("synthetic_"+table+".id IN (",sql)
            self.assertIn(ident,query.params.values())
            self.assertTrue(all(v=="synthetic-company-A" for k,v in query.params.items() if "organization_id" in k))
            self.assertNotIn("synthetic-company-A",sql)  # parameterized, not interpolated SQL
        self.assertIn("JOIN synthetic_clients ON synthetic_clients.id = synthetic_projects.client_id AND synthetic_clients.organization_id = ",str(queries[1]))
        self.assertEqual(sum("organization_id" in k for k in queries[1].params),2)

    def test_second_scope_uses_new_parameters_in_all_real_compiled_reads(self):
        _,queries=self.compile_context("synthetic-company-B")
        for query in queries:
            self.assertNotIn("synthetic-company-A",query.params.values())
            self.assertTrue(all(v=="synthetic-company-B" for k,v in query.params.items() if "organization_id" in k))


if __name__ == '__main__': unittest.main(verbosity=2)
