"""Source-specific read-only contracts for the remaining 35 accounting routes.
No service calls, mutation or speculative record substitution. IDs and labels must
come from the disposable normal-service seed, never from production discovery.
"""
from datetime import date
from urllib.parse import quote


def accounting_route_contracts(shared_ids, fixture_labels, fixture_date):
    if type(fixture_date) is not date:
        raise RuntimeError('Explicit fixture date required')
    def identity(key):
        value = shared_ids.get(key)
        if not isinstance(value, str) or not value.strip() or any(c in value for c in '/?#[]'):
            raise RuntimeError('Missing or invalid accounting fixture identity: '+key)
        return quote(value, safe='')
    def label(key):
        value = fixture_labels.get(key)
        if not isinstance(value, str) or not value.strip():
            raise RuntimeError('Missing accounting fixture label: '+key)
        return value
    ids = {key: identity(key) for key in ('account_id','invoice_id','payment_id','expense_id','payable_bill_id','asset_id','journal_id','transfer_id')}
    labels = {key: label(key) for key in ('account','invoice','payment_number','expense_number','expense','bill_number','asset','asset_code','journal','transfer','destination','client')}
    contracts, overrides = {}, {}
    root = '/dashboard/accounting'
    def add(suffix, heading, source, gets=(), texts=(), actual=None, fields=(), button=None):
        pattern = root+suffix
        contracts[pattern] = {'heading':heading, 'heading_level':1, 'ready_text':list(texts), 'expected_get_paths':list(gets),
                             'source':'frontend/src/components/'+source+'.tsx', 'expected_mode':'ready'}
        if fields: contracts[pattern]['ready_fields'] = [{'label':k,'value':v} for k,v in fields]
        if button: contracts[pattern]['ready_button'] = button
        if actual: overrides[pattern] = root+actual
    account = ids['account_id']; invoice = ids['invoice_id']; payment = ids['payment_id']; bill = ids['payable_bill_id']
    add('', 'Finance & Accounting','accounting-accounts/accounting-overview',
        ('/api/finance/accounts','/api/finance/summary','/api/accounting/loans','/api/accounting/payables'),(labels['account'],))
    add('/accounts','Where your money lives','accounting-accounts/account-workspace',('/api/finance/accounts',),(labels['account'],))
    add('/accounts/[accountId]',labels['account'],'accounting-accounts/account-workspace',
        ('/api/finance/accounts',f'/api/finance/accounts/{account}/ledger-page'),('Current balance','Account statement'),actual=f'/accounts/{account}')
    add('/accounts/[accountId]/edit','Edit '+labels['account'],'accounting-accounts/account-editor',('/api/finance/accounts',),
        ('Internal account settings',),actual=f'/accounts/{account}/edit',fields=(('Account name',labels['account']),))
    add('/accounts/new','Add a financial account','accounting-accounts/account-editor',(),('Opening position',),fields=(('Account name',''),))
    add('/advanced','From balances to their source.','accounting-advanced/advanced-register',
        ('/api/accounting/journals',),(labels['journal'],),actual='/advanced?tab=journals')
    add('/advanced/adjustment','One reason. Two balanced sides.','accounting-advanced/advanced-editors',
        ('/api/accounting/chart-of-accounts','/api/accounting/trial-balance'),('Adjustment details',),button='Review adjustment')
    add('/advanced/corrections','Correct the event. Keep its history.','accounting-advanced/advanced-corrections',
        ('/api/accounting/corrections/candidates',),(labels['payment_number'],),actual='/advanced/corrections?type=payment')
    add('/advanced/corrections/[sourceType]/[sourceId]',labels['payment_number'],'accounting-advanced/advanced-editors',
        ('/api/accounting/corrections/candidates',),(payment,'Correction instructions'),actual=f'/advanced/corrections/payment/{payment}',button='Review business reversal')
    for suffix in ('','/reverse'):
        add('/advanced/journals/[journalId]'+suffix,labels['journal'],'accounting-advanced/advanced-document',
            (f"/api/accounting/journals/{ids['journal_id']}",),(ids['journal_id'],'Journal lines'),
            actual=f"/advanced/journals/{ids['journal_id']}"+suffix,button='Review journal reversal' if suffix else None)
    add('/advanced/ledgers/new','Give the ledger a clear place.','accounting-advanced/advanced-editors',
        ('/api/accounting/chart-of-accounts',),('Ledger account details',),fields=(('Account name',''),))
    add('/assets','Keep the asset. Track its value.','accounting-assets/asset-register',
        ('/api/accounting/assets','/api/accounting/assets/summary'),(labels['asset'],))
    add('/assets/[assetId]',labels['asset'],'accounting-assets/asset-document',
        (f"/api/accounting/assets/{ids['asset_id']}/depreciation",),(ids['asset_id'],labels['asset_code']),actual=f"/assets/{ids['asset_id']}")
    add('/assets/new','Bring an asset onto the books.','accounting-assets/asset-editors',
        ('/api/accounting/assets/meta',),('Asset and accounting basis',),fields=(('Asset name',''),))
    add('/assets/depreciation','One month. The whole company.','accounting-assets/asset-editors',(),('Posting date and monthly scope',),button='Review depreciation')
    add('/invoices','Invoices','invoices-workspace-v2',('/api/finance/invoice-page',),(labels['invoice'],))
    add('/invoices/[invoiceId]',labels['invoice'],'invoice-detail-workspace',(f'/api/finance/invoices/{invoice}',),
        ('Invoice details',labels['client']),actual=f'/invoices/{invoice}')
    add('/money-in','Every receipt has a reason','accounting-money-in/money-in-workspace',('/api/finance/payment-page',),(labels['payment_number'],))
    add('/money-in/new','Record invoice payment','accounting-money-in/money-in-editor',('/api/finance/meta',),('01 / Identify the business event','02 / Record the receipt'))
    # The normal-service seed already owns the exact payment-kind receipt override.
    add('/money-in/receipts/[kind]/[receiptId]',labels['payment_number'],'accounting-money-in/money-in-workspace',
        (f'/api/finance/payments/{payment}',),(labels['invoice'],'Receipt details'))
    add('/money-out','Know what every payment paid for','accounting-money-out/money-out-workspace',('/api/finance/expenses',),(labels['expense_number'],))
    add('/money-out/[expenseId]',labels['expense_number'],'accounting-money-out/money-out-workspace',
        (f"/api/finance/expenses/{ids['expense_id']}",),(labels['expense'],'Payment details'),actual=f"/money-out/{ids['expense_id']}")
    add('/money-out/new','Record company expense','accounting-money-out/money-out-editor',
        ('/api/finance/expense-meta','/api/finance/accounts'),('01 / Explain the cost','02 / Record what was paid'))
    add('/payables','Know what is owed. Settle it once.','accounting-payables/payables-workspace',('/api/accounting/payables/workspace',),(labels['bill_number'],))
    add('/payables/[billId]',labels['bill_number'],'accounting-payables/payables-editor',
        (f'/api/accounting/payables/{bill}',f'/api/accounting/payables/{bill}/payments'),('Tax & payable breakdown',),actual=f'/payables/{bill}')
    add('/payables/[billId]/pay','Settle '+labels['bill_number'],'accounting-payables/payables-editor',
        (f'/api/accounting/payables/{bill}','/api/finance/accounts'),('Payment details',),actual=f'/payables/{bill}/pay')
    add('/payables/new','Recognize the obligation—not the payment','accounting-payables/payables-editor',
        ('/api/accounting/chart-of-accounts','/api/accounting/tax/codes','/api/finance/expense-meta-lite'),('Supplier & bill','Accounting & tax'))
    add('/receivables','Turn outstanding balances into clear next steps','accounting-receivables/receivables-workspace',('/api/finance/receivable-page',),(labels['invoice'],))
    add('/receivables/[invoiceId]/apply-credit','Use credit already received','accounting-receivables/receivables-editor',
        (f'/api/finance/invoices/{invoice}','/api/finance/receivable-advances'),(labels['invoice'],'Choose the customer credit'),actual=f'/receivables/{invoice}/apply-credit')
    add('/reports','Financial statements','accounting-statements/financial-report',('/api/accounting/reports/financial-statements',),('Applied statement','Net profit / loss'))
    add('/reports/account-statement','Follow the account, not a combined total.','accounting-statements/account-statement',
        ('/api/finance/accounts',f'/api/finance/accounts/{account}/ledger-page'),(labels['account'],'Applied movement scope'),actual='/reports/account-statement?account='+account)
    add('/transfers','Money in motion','accounting-transfers/transfer-workspace',('/api/finance/transfer-page',),(labels['transfer'],))
    add('/transfers/[transferId]',labels['transfer'],'accounting-transfers/transfer-workspace',
        (f"/api/finance/transfers/{ids['transfer_id']}",),('Movement breakdown',labels['destination']),actual=f"/transfers/{ids['transfer_id']}")
    add('/transfers/new','Move money between accounts','accounting-transfers/transfer-editor',('/api/finance/accounts',),('01 / Choose the accounts','02 / Amounts & reference'))
    return {'route_contracts':contracts,'route_overrides':overrides}
