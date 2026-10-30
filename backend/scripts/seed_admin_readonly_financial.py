"""CI-only service-created financial fixtures. Partial failure is fatal; never blindly retry.
The caller creates the isolated organization; this helper never creates credentials or roles.
"""
from datetime import date
from decimal import Decimal
import os
from typing import Callable, TypedDict
from uuid import uuid4
from starlette.requests import Request
from app.core.config import settings
from app.models.organization import Organization
from app.models.membership import Membership
from app.models.user import User
from app.api.v1.finance import create_account
from app.schemas.finance import FinancialAccountCreate
from app.api.v1.accounting_loans import (AccountingLoanCreate, LoanDisbursementCreate,
    LoanAccountingRepaymentCreate, create_accounting_loan, approve_loan, disburse_loan, repay_loan)
from app.api.v1.tax import TaxCodeCreate, TaxSettlementCreate, create_code, create_settlement
from app.api.v1.payables import create_payable_bill
from app.schemas.payables import PayableBillCreate
from app.api.v1.accounting_reconciliation import ReconciliationCreate, create_reconciliation
from app.services.accounting_posting import system_account
from app.services.accounting_integrity_audit import audit_organization_accounting


class FinancialRegistry(TypedDict):
    account_id: str
    loan_draft_id: str
    loan_active_id: str
    loan_paid_id: str
    tax_code_id: str
    tax_settlement_id: str
    reconciliation_id: str
    fixture_date: str
    currency: str
    accounting_integrity: bool
    route_overrides: dict[str, str]


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def assert_financial_fixture_target(db, tenant) -> None:
    """Fail closed under python -O too, before the first mutation."""
    url = db.get_bind().url
    _require(settings.environment == 'test', 'Explicit test environment required')
    _require(os.environ.get('CI') == 'true' and os.environ.get('GITHUB_ACTIONS') == 'true'
             and os.environ.get('QC_BROWSER_FIXTURE') == '1', 'Explicit disposable CI opt-in required')
    _require(url.get_backend_name() == 'postgresql' and url.host in {'127.0.0.1', 'localhost'}
             and url.port == 5432 and url.database == 'codestation_business_os', 'Disposable loopback PostgreSQL target required')
    _require(not settings.smtp_host.strip() and not settings.smtp_configured, 'Mail must remain disabled')
    email = os.environ.get('E2E_EMAIL', '').strip().lower()
    _require(bool(email), 'Explicit existing E2E_EMAIL required')
    org = db.get(Organization, tenant.organization_id)
    owner = db.get(User, tenant.user_id)
    member = db.get(Membership, tenant.membership_id)
    _require(org is not None and org.name.startswith('Read-only admin sweep ')
             and org.created_by_user_id == tenant.user_id and org.currency == 'USD', 'Dedicated USD owner organization required')
    _require(owner is not None and owner.email.lower() == email and owner.is_active and owner.is_verified,
             'Existing verified fixture owner required')
    _require(member is not None and member.organization_id == org.id and member.user_id == owner.id
             and member.status == 'active' and member.is_owner,  'Active matching owner membership required')
    _require(tenant.organization.id == org.id and tenant.organization.currency == org.currency,
             'Supplied organization context mismatch')


def seed_financial(db, tenant, request: Callable[[str, str], Request], fixture_date: date) -> FinancialRegistry:
    assert_financial_fixture_target(db, tenant)
    _require(type(fixture_date) is date, 'Explicit calendar fixture date required')
    marker = uuid4().hex[:8]
    currency = 'USD'

    def call(fn, *args, path: str):
        # Direct handlers lack the HTTP tenant dependency's request transaction.
        if not db.in_transaction():
            db.begin()
        return fn(*args, request('POST', path), db, tenant)

    account = call(create_account, FinancialAccountCreate(
        name=f'Read-only sweep bank {marker}', account_type='bank', currency=currency,
        opening_balance=Decimal('0')), path='/finance/accounts')

    def agreement(kind: str, amount: str):
        return call(create_accounting_loan, AccountingLoanCreate(
            lender_name=f'Read-only sweep {kind} {marker}', lender_type='bank', currency=currency,
            approved_amount=Decimal(amount), annual_interest_rate=Decimal('0'),
            approval_date=fixture_date, reference=f'RO-{kind}-{marker}'), path='/accounting/loans')

    def fund_and_repay(loan, principal: str, repayment: str):
        loan_id = loan['id']
        call(approve_loan, loan_id, path=f'/accounting/loans/{loan_id}/approve')
        call(disburse_loan, loan_id, LoanDisbursementCreate(
            account_id=account.id, disbursement_date=fixture_date,
            principal_amount=Decimal(principal), fee_withheld_amount=Decimal('0'),
            reference=f'RO-fund-{loan_id}'), path=f'/accounting/loans/{loan_id}/disburse')
        return call(repay_loan, loan_id, LoanAccountingRepaymentCreate(
            account_id=account.id, payment_date=fixture_date,
            principal_amount=Decimal(repayment), interest_amount=Decimal('0'), fee_amount=Decimal('0'),
            reference=f'RO-repay-{loan_id}'), path=f'/accounting/loans/{loan_id}/repay')['loan']

    draft = agreement('draft', '10')
    active = fund_and_repay(agreement('active', '20'), '10', '1')
    paid = fund_and_repay(agreement('paid', '2'), '2', '2')
    _require(draft['status'] == 'draft' and active['status'] == 'active'
             and Decimal(str(active['outstanding_principal'])) == Decimal('9')
             and Decimal(str(active['undisbursed_amount'])) == Decimal('10')
             and paid['status'] == 'paid' and Decimal(str(paid['outstanding_principal'])) == 0,
             'Loan fixture lifecycle mismatch')
    code = call(create_code, TaxCodeCreate(code=f'ROWH{marker}', name='Read-only sweep withholding',
        tax_kind='withholding', rate=Decimal('10'), effective_from=fixture_date), path='/accounting/tax/codes')
    expense = system_account(db, tenant.organization_id, 'operating_expenses')
    call(create_payable_bill, PayableBillCreate(supplier_name=f'Read-only sweep supplier {marker}',
        bill_date=fixture_date, currency=currency, amount=Decimal('10'),
        withholding_tax_code_id=code['id'], expense_ledger_account_id=expense.id,
        description='Synthetic read-only sweep liability', reference=f'RO-bill-{marker}'), path='/accounting/payables')
    settlement = call(create_settlement, TaxSettlementCreate(settlement_type='withholding_tax_payment',
        settlement_date=fixture_date, amount=Decimal('1'), account_id=account.id,
        reference=f'RO-tax-{marker}'), path='/accounting/tax/settlements')
    reconciliation = call(create_reconciliation, ReconciliationCreate(account_id=account.id,
        statement_end_date=fixture_date, statement_ending_balance=Decimal('8'),
        notes='Synthetic read-only draft; browser does not match or finalize'), path='/accounting/reconciliations')
    _require(reconciliation['status'] == 'draft', 'Reconciliation fixture must remain draft')
    report = audit_organization_accounting(db, tenant.organization_id)
    _require(report.ok, 'Seed accounting integrity check failed; retain CI database for diagnosis')
    root = '/dashboard/accounting/loans'
    return {
        'account_id': account.id, 'loan_draft_id': draft['id'], 'loan_active_id': active['id'],
        'loan_paid_id': paid['id'], 'tax_code_id': code['id'], 'tax_settlement_id': settlement['id'],
        'reconciliation_id': reconciliation['id'], 'fixture_date': fixture_date.isoformat(),
        'currency': currency, 'accounting_integrity': True,
        'route_overrides': {
            f'{root}/[loanId]': f"{root}/{active['id']}",
            f'{root}/[loanId]/approve': f"{root}/{draft['id']}/approve",
            f'{root}/[loanId]/receive': f"{root}/{active['id']}/receive",
            f'{root}/[loanId]/repay': f"{root}/{active['id']}/repay",
            f'{root}/[loanId]/close': f"{root}/{paid['id']}/close",
        },
    }
