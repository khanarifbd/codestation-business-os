"""Static contract for the refactored expense-profitability composition.

Pure source inspection only; database reconciliation and UI rendering remain
separate checks. These checks follow the route to the actual profitability view
instead of requiring its labels to be duplicated in the route wrapper.
"""
import re


def verify_expense_profitability_contract(frontend):
    route = (frontend / 'app/dashboard/expenses/page.tsx').read_text()
    workspace = (frontend / 'components/expenses/expense-workspace.tsx').read_text()
    register = (frontend / 'components/expenses/expense-register.tsx').read_text()

    def wired(parent, child, name, module):
        assert re.search(r'import\s*\{[^}]*\b' + re.escape(name) + r'\b[^}]*\}\s*from\s*["\']' + re.escape(module) + r'["\']', parent), f'Missing import {name}'
        assert re.search(r'<' + re.escape(name) + r'(?:\s|/|>)', parent), f'Missing rendered {name}'
        assert re.search(r'export\s+function\s+' + re.escape(name) + r'\s*\(', child), f'Missing export {name}'

    wired(route, workspace, 'ExpenseWorkspace', '@/components/expenses/expense-workspace')
    wired(workspace, register, 'ExpenseRegister', './expense-register')
    assert '<ExpenseContent ' in workspace and 'function ExpenseContent()' in workspace
    assert '<ExpenseProfitability vm={vm}/>' in register, 'Register must render profitability with its state'
    assert '{ value: "profitability", label: "Profitability" }' in register, 'Profitability tab must remain reachable'
    assert 'function ExpenseProfitability(' in register
    body = register.split('function ExpenseProfitability(', 1)[1].split('function ', 1)[0]
    for meaning in ('title="Operational margin by currency"', 'not accrual net profit',
                    'All-time issued invoice totals include tax', 'draft and cancelled invoices are excluded',
                    'posted expenses, transfer fees and Stripe processing fees',
                    'supplier bills, inventory cost of sales, payroll, direct income and other journal-only adjustments are excluded',
                    'No period filter is available; currencies are never combined.',
                    '<Link href="/dashboard/accounting/reports">', 'Profit &amp; Loss report',
                    'data.profit_loss_by_currency.map(', 'key={row.currency}',
                    'expenseMoney(row.net_profit, row.currency)',
                    'expenseMoney(row.stripe_processing_fees, row.currency)'):
        assert meaning in body, f'Profitability contract lost: {meaning}'
    assert not re.search(r'(?:title|label)\s*=\s*["\']Net profit["\']|>\s*Net profit\s*<', body), 'Operational figures must not be labeled net profit'
