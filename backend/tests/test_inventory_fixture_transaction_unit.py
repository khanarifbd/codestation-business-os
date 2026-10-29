"""Inventory QA direct-call boundaries: real unbound Session, no DB/network.

Execute actual fixture constructors and request prefixes, not app replacements.
This checks mapping/root ownership only; real PostgreSQL CI proves business flows.
"""
import ast
from dataclasses import dataclass
from pathlib import Path
from types import SimpleNamespace as NS
import unittest
from unittest.mock import patch
from sqlalchemy import inspect
from sqlalchemy.orm import Session, make_transient_to_detached
from sqlalchemy.orm.exc import UnmappedInstanceError
from app.models.organization import Organization

ROOT = Path(__file__).resolve().parents[1]
FILES = {'verify_inventory.py': 2, 'verify_inventory_workflows.py': 1, 'verify_inventory_sales.py': 9}
HANDLERS = {'receive_purchase', 'fulfill_order', 'reverse_fulfillment'}

def tree_for(filename):
    return ast.parse((ROOT / 'scripts' / filename).read_text())

def execute(nodes, ns):
    exec(compile(ast.Module(body=nodes, type_ignores=[]), '<actual inventory fixture>', 'exec'), ns)

class InventoryFixtureTransactionTests(unittest.TestCase):
    def test_same_session_exact_organization_and_missing_row_rejection(self):
        fixture = dict(organization_id='synthetic-org', user_id='synthetic-user', membership_id='synthetic-member', currency='USD', timezone='UTC')
        for filename in FILES:
            with self.subTest(script=filename):
                tree = tree_for(filename)
                classes = [node for node in tree.body if isinstance(node, ast.ClassDef)]
                constructor = next(node for node in ast.walk(tree) if isinstance(node, ast.Assign)
                                   and any(isinstance(t, ast.Name) and t.id == 'tenant' for t in node.targets))
                bindings = []
                for parent in ast.walk(tree):
                    for _,body in ast.iter_fields(parent):
                        if isinstance(body, list) and constructor in body:
                            idx = body.index(constructor)
                            bindings = body[max(0,idx-2):idx]
                mapped = [node for node in bindings if isinstance(node,(ast.Assign,ast.If))
                          and ('organization = db.get(Organization' in ast.unparse(node)
                               or ast.unparse(node).startswith('if organization is None:'))]
                ns = dict(dataclass=dataclass, Organization=Organization, row=fixture, fixture=fixture, base_currency='USD')
                execute(classes, ns)
                with Session() as db:
                    org = Organization(id='synthetic-org', name='Synthetic fixture', currency='USD', timezone='UTC')
                    make_transient_to_detached(org); db.add(org)
                    ns['db'] = db
                    execute(mapped + [constructor], ns)
                    tenant = ns['tenant']
                    self.assertIs(tenant.organization, org)
                    self.assertIs(inspect(tenant.organization).session, db)
                    self.assertTrue(inspect(tenant.organization).persistent)
                    self.assertEqual((tenant.organization_id, tenant.user_id, tenant.membership_id, tenant.role),
                                     ('synthetic-org','synthetic-user','synthetic-member','admin'))
                    with patch.object(db, 'get', return_value=None):
                        with self.assertRaisesRegex(AssertionError, 'Fixture organization is missing'):
                            execute(mapped + [constructor], ns)

    def check_roots(self, filename):
        tree = tree_for(filename)
        helper = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'ensure_request_transaction'), None)
        guard_tree = ast.parse((ROOT / 'app/services/accounting_period_gate.py').read_text())
        nodes = [n for n in guard_tree.body if isinstance(n,(ast.ClassDef,ast.FunctionDef)) and n.name in {'AccountingPeriodGateError','_active_root'}]
        ns = {}; execute(nodes + ([helper] if helper else []), ns)
        found = 0
        for parent in ast.walk(tree):
            for _,body in ast.iter_fields(parent):
                if not isinstance(body,list): continue
                for index,node in enumerate(body):
                    if not isinstance(node,(ast.Assign,ast.Expr)): continue
                    calls = [n for n in ast.walk(node) if isinstance(n,ast.Call) and isinstance(n.func,ast.Name) and n.func.id in HANDLERS]
                    if not calls: continue
                    self.assertEqual(len(calls),1)
                    found += 1
                    previous = body[index-1] if index else None
                    owned = previous is not None and ast.unparse(previous) == 'ensure_request_transaction(db)'
                    for state in ('new','active','committed','rolled_back'):
                        with self.subTest(script=filename,line=node.lineno,state=state):
                            with Session() as db:
                                original = db.begin() if state != 'new' else None
                                if state == 'committed': db.commit()
                                if state == 'rolled_back': db.rollback()
                                with patch.object(db,'commit',side_effect=AssertionError('must not commit')), patch.object(db,'rollback',side_effect=AssertionError('must not rollback')):
                                    if owned: execute([previous], dict(ns,db=db))
                                    root = ns['_active_root'](db)
                                    if state == 'active': self.assertIs(root,original)
                                    else: self.assertIsNot(root,original)
                    self.assertTrue(owned, 'Missing direct-request prefix, including negative lambda')
        self.assertEqual(found,FILES[filename])

    def test_inventory_request_roots(self): self.check_roots('verify_inventory.py')
    def test_workflow_request_roots(self): self.check_roots('verify_inventory_workflows.py')
    def test_sales_request_roots_including_negative_lambda(self): self.check_roots('verify_inventory_sales.py')

    def test_actual_purchase_refresh_still_rejects_unmapped_organization(self):
        tree = ast.parse((ROOT / 'app/api/v1/inventory.py').read_text())
        handler = next(n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name == 'receive_purchase')
        refresh = handler.body[1]
        self.assertEqual(ast.unparse(refresh), "db.refresh(tenant.organization, attribute_names=['currency'])")
        with Session() as db:
            with self.assertRaises(UnmappedInstanceError):
                execute([refresh], dict(db=db,tenant=NS(organization=NS(currency='USD'))))
