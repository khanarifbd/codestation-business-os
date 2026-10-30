"""Disposable CI-only normal-service records for read-only route coverage.
No real customer, provider, invitation, login credential or permission mutation.
The project vault value is NONFUNCTIONAL synthetic QA text, never returned,
logged, revealed or included in the browser registry. Partial failure is fatal;
normal service commits mean callers must never blindly rerun this seed.
"""
from datetime import date
from decimal import Decimal
from io import BytesIO
from typing import TypedDict
from uuid import uuid4
from starlette.datastructures import Headers, UploadFile
from scripts.seed_admin_readonly_financial import assert_financial_fixture_target
from app.api.v1.crm import create_client
from app.api.v1.sales import create_quotation, change_quotation_status
from app.api.v1.orders import create_order_from_quotation, change_order_status
from app.api.v1.manual_orders import create_manual_order
from app.api.v1.projects import create_project_from_order
from app.api.v1.project_execution import create_milestone, create_task, create_credential, upload_project_document
from app.api.v1.inventory import create_category, create_warehouse, create_product, receive_purchase
from app.api.v1.inventory_management import create_supplier
from app.api.v1.finance_expenses import create_expense_category, create_expense
from app.schemas.crm import ClientCreate
from app.schemas.sales import QuotationCreate, QuotationStatusChange, QuotationItemInput
from app.schemas.orders import ManualOrderCreate, OrderItemInput, OrderStatusChange
from app.schemas.projects import ProjectCreateFromOrder
from app.schemas.project_execution import MilestoneCreate, TaskCreate, CredentialCreate
from app.schemas.inventory import CategoryCreate, WarehouseCreate, ProductCreate, PurchaseReceiptCreate, PurchaseLineInput
from app.schemas.inventory_management import SupplierCreate
from app.schemas.expenses import ExpenseCategoryCreate, ExpenseCreate
from app.models.finance import FinancialAccount
from app.services.accounting_integrity_audit import audit_organization_accounting


class CommercialRegistry(TypedDict):
    typed_ids: dict[str, str]
    route_overrides: dict[str, str]
    route_contracts: dict[str, dict]
    accounting_integrity: bool


def value(row, key):
    return row[key] if isinstance(row, dict) else getattr(row, key)


def required(condition, message):
    if not condition:
        raise RuntimeError(message)


def seed_commercial(db, tenant, request_factory, fixture_date, shared_ids=None) -> CommercialRegistry:
    # Same strict actual-bind, CI opt-in, mail-disabled, existing owner/org gate.
    assert_financial_fixture_target(db, tenant)
    required(type(fixture_date) is date, 'Explicit calendar fixture date required')
    account_id = (shared_ids or {}).get('account_id')
    required(isinstance(account_id, str) and bool(account_id), 'Existing funded fixture account required')
    account = db.get(FinancialAccount, account_id)
    required(account is not None and account.organization_id == tenant.organization_id
             and account.currency == 'USD' and account.is_active, 'Matching active USD fixture account required')
    marker = uuid4().hex[:8]
    labels = {key: f'Read-only synthetic {key} {marker}' for key in
              ['client', 'quotation', 'order', 'project', 'milestone', 'task', 'document', 'credential',
               'category', 'warehouse', 'item', 'supplier', 'expense category', 'expense']}
    def req(method, path):
        return request_factory(method, '/api/v1'+path)
    client = create_client(ClientCreate(display_name=labels['client'], country_code='US', currency='USD'),
                           req('POST', '/crm/clients'), db, tenant)
    client_id = value(client, 'id')
    item = dict(description='Synthetic read-only route fixture service', quantity=Decimal('1'), unit_price=Decimal('2.00'),
                item_name='Synthetic QA service', item_type='service', unit='unit')
    def quote():
        return create_quotation(QuotationCreate(client_id=client_id, subject=labels['quotation'], issue_date=fixture_date,
                                currency='USD', items=[QuotationItemInput(**item)]), req('POST', '/sales/quotations'), db, tenant)
    draft = quote()
    accepted = quote()
    for status in ['sent', 'accepted']:
        accepted = change_quotation_status(value(accepted, 'id'), QuotationStatusChange(status=status),
                                           req('PATCH', '/sales/quotations/status'), db, tenant)
    project_order = create_order_from_quotation(value(accepted, 'id'), req('POST', '/sales/orders/from-quotation'), db, tenant)
    manual = create_manual_order(ManualOrderCreate(client_id=client_id, subject=labels['order'], order_date=fixture_date,
                                 currency='USD', items=[OrderItemInput(**item)]), req('POST', '/sales/orders'), db, tenant)
    settlement_order = create_manual_order(ManualOrderCreate(client_id=client_id, subject='Synthetic settlement read-only form',
                                            order_date=fixture_date, currency='USD', items=[OrderItemInput(**item)]),
                                            req('POST', '/sales/orders'), db, tenant)
    for status in ['in_progress', 'completed']:
        settlement_order = change_order_status(value(settlement_order, 'id'), OrderStatusChange(status=status),
                                               req('PATCH', '/sales/orders/status'), db, tenant)
    # Converted order supports project; independent manual order remains editable and unbilled.
    project = create_project_from_order(value(project_order, 'id'), ProjectCreateFromOrder(name=labels['project'],
                                        planned_start_date=fixture_date), req('POST', '/projects/from-order'), db, tenant)
    project_id = value(project, 'id')
    milestone = create_milestone(project_id, MilestoneCreate(title=labels['milestone']), req('POST', '/projects/milestones'), db, tenant)
    task = create_task(project_id, TaskCreate(title=labels['task'], milestone_id=value(milestone, 'id')),
                       req('POST', '/projects/tasks'), db, tenant)
    file = UploadFile(filename='synthetic-readonly-note.txt', file=BytesIO(b'Synthetic QA fixture. No client data.\n'),
                      headers=Headers({'content-type': 'text/plain'}))
    try:
        document = upload_project_document(project_id, req('POST', '/projects/documents'), db, tenant, file,
                                           labels['document'], 'other', 'Synthetic read-only QA fixture')
    finally:
        file.file.close()
    credential = create_credential(project_id, CredentialCreate(name=labels['credential'], environment='test',
                                   secret='NONFUNCTIONAL SYNTHETIC QA TEXT — grants no access',
                                   notes='Synthetic QA fixture, never reveal', access_level='manager_only'),
                                   req('POST', '/projects/credentials'), db, tenant)
    category = create_category(CategoryCreate(name=labels['category']), req('POST', '/inventory/categories'), db, tenant)
    warehouse = create_warehouse(WarehouseCreate(code=f'QA-{marker}', name=labels['warehouse'], is_default=True),
                                 req('POST', '/inventory/warehouses'), db, tenant)
    product = create_product(ProductCreate(sku=f'QA-{marker}', name=labels['item'], currency='USD',
                             category_id=value(category, 'id'), item_type='stock_item', selling_price=Decimal('2.00')),
                             req('POST', '/inventory/products'), db, tenant)
    supplier = create_supplier(SupplierCreate(name=labels['supplier'], currency='USD'), req('POST', '/inventory/suppliers'), db, tenant)
    # Genuine receipt/payable/stock journal through the existing normal service, not ORM status shortcuts.
    purchase = receive_purchase(PurchaseReceiptCreate(supplier_name=labels['supplier'], vendor_id=value(supplier, 'id'),
                                warehouse_id=value(warehouse, 'id'), receipt_date=fixture_date, currency='USD',
                                reference=f'QA-READ-{marker}', items=[PurchaseLineInput(product_id=value(product, 'id'),
                                quantity=Decimal('1'), unit_cost=Decimal('1.01'))]), req('POST', '/inventory/purchases'), db, tenant)
    expense_category = create_expense_category(ExpenseCategoryCreate(name=labels['expense category']),
                                               req('POST', '/finance/expense-categories'), db, tenant)
    expense = create_expense(ExpenseCreate(description=labels['expense'], category_id=value(expense_category, 'id'),
                             vendor_id=value(supplier, 'id'), account_id=account_id, client_id=client_id,
                             expense_date=fixture_date, expense_currency='USD', expense_amount=Decimal('1.01'),
                             account_amount=Decimal('1.01'), reference=f'QA-EXP-{marker}'), req('POST', '/finance/expenses'), db, tenant)
    required(audit_organization_accounting(db, tenant.organization_id).ok, 'Commercial fixture accounting integrity failed')
    rows = dict(client=client, quotation=draft, accepted_quotation=accepted, order=manual, project_order=project_order,
                settlement_order=settlement_order, project=project, milestone=milestone, task=task, document=document, credential=credential,
                category=category, warehouse=warehouse, product=product, supplier=supplier, purchase=purchase,
                expense_category=expense_category, expense=expense)
    ids = {key+'_id': str(value(row, 'id')) for key, row in rows.items()}
    ids['vendor_id'] = ids['supplier_id']
    required(all(ids.values()), 'Every fixture must return an actual record ID')
    overrides, contracts = commercial_routes(ids, rows, labels)
    return {'typed_ids': ids, 'route_overrides': overrides, 'route_contracts': contracts, 'accounting_integrity': True}


def commercial_routes(ids, rows, labels):
    """Explicit real route contracts, no placeholder substitutions across record kinds."""
    overrides, contracts = {}, {}
    def add(pattern, actual, heading, paths, source, texts=(), button=None):
        required('[' not in actual and ']' not in actual, 'Unresolved browser route')
        overrides[pattern] = actual
        contracts[pattern] = {'heading': heading, 'ready_text': list(texts), 'expected_get_paths': paths,
                              'source': source, 'expected_mode': 'ready'}
        if button:
            contracts[pattern]['ready_button'] = button
    q, o, p = '/dashboard/quotations', '/dashboard/orders', '/dashboard/projects'
    qid, oid, pid = ids['quotation_id'], ids['order_id'], ids['project_id']
    qsrc = 'frontend/src/app/dashboard/quotations/quotation-v2-workspace.tsx'
    add(q, q, 'Quotations', ['/api/sales/quotations'], 'frontend/src/app/dashboard/quotations/page.tsx')
    add(q+'/new', q+'/new', 'Create quotation', ['/api/sales/meta'], qsrc, button='Create draft')
    for suffix in ['', '/edit']:
        add(q+'/[quotationId]'+suffix, q+'/'+qid+suffix, value(rows['quotation'], 'quotation_number'),
            [f'/api/sales/quotations/{qid}', f'/api/sales/quotations/{qid}/commercial'], qsrc,
            button='Save draft' if suffix else None)
    add(o, o, 'Orders', ['/api/sales/orders'], 'frontend/src/app/dashboard/orders/page.tsx')
    add(o+'/new', o+'/new', 'Create manual order', ['/api/sales/meta'], 'frontend/src/app/dashboard/orders/new/page.tsx')
    for suffix, heading in [('', value(rows['order'], 'order_number')), ('/edit', 'Edit '+value(rows['order'], 'order_number')),
                            ('/commercial', 'Contract, billing & collection'), ('/settlement', 'Create invoice & settle')]:
        target_id = ids['settlement_order_id'] if suffix == '/settlement' else oid
        get = f'/api/sales/orders/{target_id}' + ('/commercial' if suffix == '/commercial' else '')
        paths = [get]
        if suffix == '/settlement':
            paths += [f'/api/finance/orders/{target_id}/settlement', f'/api/finance/orders/{target_id}/settlement-meta']
        add(o+'/[orderId]'+suffix, o+'/'+target_id+suffix, heading, paths, 'frontend/src/app/dashboard/orders/[orderId]'+suffix+'/page.tsx')
    psrc = 'frontend/src/components/projects/project-workspace.tsx'
    pgets = [f'/api/projects/{pid}', f'/api/projects/{pid}/workspace']
    add(p, p, 'Projects', ['/api/projects'], 'frontend/src/components/projects/project-register-workspace.tsx')
    add(p+'/new', p+'/new?order_id='+oid, 'Create from order', [f'/api/sales/orders/{oid}', '/api/projects/meta'],
        'frontend/src/components/projects/project-register-workspace.tsx', button='Create project')
    add(p+'/[projectId]', p+'/'+pid, labels['project'], pgets, psrc)
    editors = [
        ('team/edit', 'Manage project team & access'), ('milestones/new', 'Add milestone'),
        ('milestones/[recordId]/edit', 'Edit milestone'), ('tasks/new', 'Add task'),
        ('tasks/[recordId]/edit', 'Edit task · '+value(rows['task'], 'task_code')),
        ('tasks/[recordId]/progress', 'Update work · '+value(rows['task'], 'task_code')),
        ('documents/new', 'Upload project document'), ('documents/[recordId]/edit', 'Edit project document'),
        ('credentials/new', 'Add credential'), ('credentials/[recordId]/edit', 'Edit credential'),
        ('edit', 'Edit project details'), ('tasks/[recordId]', labels['task']), ('milestones/[recordId]', labels['milestone']),
    ]
    kind_ids = {'tasks': ids['task_id'], 'milestones': ids['milestone_id'], 'documents': ids['document_id'], 'credentials': ids['credential_id']}
    for suffix, ready in editors:
        actual_suffix = suffix.replace('[recordId]', kind_ids.get(suffix.split('/')[0], ''))
        texts = [labels['project']]
        if suffix == 'credentials/[recordId]/edit':
            texts.append('The current secret is not loaded into this editor. Leave the new secret blank to keep it unchanged.')
        add(p+'/[projectId]/'+suffix, p+'/'+pid+'/'+actual_suffix, ready, pgets, psrc, texts=texts)
    # Credential edit GET loads masked metadata only. No reveal/download/save click is in this registry.
    inv = '/dashboard/inventory'
    isrc = 'frontend/src/components/inventory/inventory-workspace.tsx'
    igets = ['/api/inventory/dashboard-summary', '/api/inventory/products', '/api/inventory/warehouses', '/api/inventory/categories', '/api/inventory/suppliers', '/api/accounting/tax/codes']
    add(inv, inv, 'Inventory', igets, isrc)
    for section in ['items', 'suppliers', 'warehouses', 'categories', 'purchases']:
        extra = ['/api/inventory/purchases'] if section == 'purchases' else []
        add(inv+'/'+section, inv+'/'+section, 'Inventory', igets+extra, isrc)
    for section, heading in [('items', 'Add product / service'), ('suppliers', 'Add supplier'), ('warehouses', 'Add warehouse'),
                             ('categories', 'Manage categories'), ('purchases', 'Receive purchase'),
                             ('adjustments', 'Adjust stock'), ('transfers', 'Transfer stock')]:
        add(inv+'/'+section+'/new', inv+'/'+section+'/new', heading, igets, isrc)
    for section, kind, heading in [('items', 'product', 'Edit product / service'), ('suppliers', 'supplier', 'Edit supplier'),
                                   ('warehouses', 'warehouse', 'Edit warehouse'), ('categories', 'category', 'Manage categories')]:
        add(inv+'/'+section+'/[recordId]/edit', inv+'/'+section+'/'+ids[kind+'_id']+'/edit', heading, igets, isrc)
    for section, kind, label in [('items', 'product', labels['item']), ('suppliers', 'supplier', labels['supplier']),
                                 ('warehouses', 'warehouse', labels['warehouse']), ('purchases', 'purchase', value(rows['purchase'], 'receipt_number'))]:
        extra = ['/api/inventory/purchases'] if section == 'purchases' else []
        add(inv+'/'+section+'/[recordId]', inv+'/'+section+'/'+ids[kind+'_id'], label, igets+extra,
            'frontend/src/components/inventory/inventory-detail.tsx')
    exp, eid = '/dashboard/expenses', ids['expense_id']
    esrc = 'frontend/src/components/expenses/expense-workspace.tsx'
    add(exp, exp, 'Understand the cost. Keep its context.', ['/api/finance/expenses'], esrc)
    add(exp+'/new', exp+'/new', 'Post the cost with a clear audit trail.', ['/api/finance/expense-meta', '/api/finance/accounts'], esrc)
    add(exp+'/vendors/new', exp+'/vendors/new', 'A vendor record, not a financial posting.', [], esrc)
    add(exp+'/categories/new', exp+'/categories/new', 'A clear category for future costs.', [], esrc)
    add(exp+'/[expenseId]', exp+'/'+eid, value(rows['expense'], 'expense_number'), [f'/api/finance/expenses/{eid}'], esrc)
    add(exp+'/[expenseId]/receipts/new', exp+'/'+eid+'/receipts/new', 'Keep the evidence with the expense.',
        [f'/api/finance/expenses/{eid}'], esrc)
    for pattern, contract in contracts.items():
        if pattern.startswith(inv+'/items'):
            contract['expected_get_paths'] = contract['expected_get_paths'] + ['/api/services/catalog']
        elif pattern.startswith(inv+'/adjustments') or pattern.startswith(inv+'/transfers'):
            contract['expected_get_paths'] = contract['expected_get_paths'] + ['/api/inventory/stock']
    return overrides, contracts
