"""Local-only, synthetic manual-review fixture. See seed_qa_review.md."""
import calendar
import os
from datetime import date, timedelta
from decimal import Decimal as D
from types import SimpleNamespace

from sqlalchemy import select, text

from app.api.v1.organizations import create_organization
from app.api.v1.finance import create_invoice
from app.api.v1.financial_safety import (
    safe_create_account, safe_change_invoice_status, safe_record_payment,
    safe_create_expense,
)
from app.api.v1.inventory import create_product, create_warehouse, receive_purchase
from app.api.v1.payroll import create_salary_profile, create_period, create_run
from app.core.config import settings
from app.core.security import hash_password
from app.db.session import SessionLocal, defer_commits, engine
from app.models.crm import Client, Lead, LeadStatus
from app.models.expenses import ExpenseCategory, Vendor
from app.models.finance import Invoice
from app.models.hr import LeaveRequest, LeaveType
from app.models.membership import Membership
from app.models.orders import Order, OrderItem
from app.models.organization import Organization
from app.models.projects import Project, ProjectMember, ProjectTask
from app.models.team import Employee, OrganizationRole
from app.models.user import User
from app.models.common import utc_now
from app.schemas.organization import OrganizationCreate
from app.schemas.finance import (
    FinancialAccountCreate, InvoiceCreate, InvoiceItemInput,
    InvoiceStatusAction, PaymentCreate,
)
from app.schemas.expenses import ExpenseCreate
from app.schemas.inventory import ProductCreate, WarehouseCreate, PurchaseReceiptCreate, PurchaseLineInput
from app.schemas.payroll import SalaryProfileCreate, PayrollPeriodCreate, PayrollRunCreate
from app.services.activity_log import record_activity
from seed_browser_e2e import request

NAME = "Local QA Review 2026"
SLUG = "local-qa-review-2026"


def main():
    # Explicit opt-in plus a loopback-only PostgreSQL destination. No production,
    # external URLs, socket overrides or non-example.com users are accepted.
    if (os.getenv("QA_REVIEW_LOCAL_ONLY") != "1"
            or settings.environment.lower() not in {"development", "local", "test", "testing"}
            or engine.url.get_backend_name() != "postgresql"
            or engine.url.host not in {"localhost", "127.0.0.1", "::1"}
            or engine.url.query):
        raise SystemExit("Refusing seed: opt in with QA_REVIEW_LOCAL_ONLY=1 and use local development PostgreSQL without URL query overrides.")
    owner_email = os.getenv("E2E_EMAIL", "e2e-owner@example.com").strip().lower()
    if not owner_email.endswith("@example.com"):
        raise SystemExit("Fixture owner must use @example.com.")
    password = os.getenv("QA_REVIEW_PASSWORD", "")
    today = date.today()
    with SessionLocal() as db:
        # Serialize concurrent seeder invocations; the surrounding runner also
        # serializes use of the temporary PostgreSQL instance against tests.
        db.execute(text("SELECT pg_advisory_xact_lock(20261020, 15)"))
        existing = db.scalar(select(Organization).where(Organization.slug == SLUG))
        if existing:
            if existing.name != NAME:
                raise SystemExit("Reserved fixture slug belongs to another company; refusing to modify it.")
            print(f"Already seeded: {NAME} ({existing.id}); manual edits preserved.")
            return
        if len(password) < 16:
            raise SystemExit("Set QA_REVIEW_PASSWORD to a private local password of at least 16 characters; it is never printed or saved by this script.")

        def add(cls, **values):
            row = cls(**values)
            db.add(row)
            db.flush()
            return row

        def user(email, name):
            existing_user = db.scalar(select(User).where(User.email == email))
            if existing_user:
                # Do not reset credentials or mutate existing accounts.
                return existing_user
            return add(User, email=email, full_name=name, password_hash=hash_password(password), is_active=True, is_verified=True)

        with defer_commits(db):
            owner = user(owner_email, "QA Review Owner")
            result = create_organization(OrganizationCreate(name=NAME, country_code="US", timezone="UTC", currency="USD", business_type="Software & IT Services", team_size="6-10", financial_year_start_month=1), request(), db, owner)
            org = db.get(Organization, result.organization.id)
            org.slug = SLUG
            common = dict(organization_id=org.id, created_by_user_id=owner.id)
            tenant = SimpleNamespace(organization_id=org.id, user_id=owner.id, organization=org)
            req = request("/local-qa-review/seed")
            roles = {r.slug: r for r in db.scalars(select(OrganizationRole).where(OrganizationRole.organization_id == org.id))}
            hr_role = add(OrganizationRole, organization_id=org.id, name="QA HR Manager", slug="qa-hr-manager", permissions=["dashboard.view", "hr.self", "hr.view", "hr.manage", "team.view", "payroll.view", "payroll.manage"])
            employees = []
            for code, email, name, role in [
                ("QA-EMP-001", "qa-review-employee@example.com", "Casey Review", roles["user"]),
                ("QA-HR-001", "qa-review-hr@example.com", "Jordan Review", hr_role),
            ]:
                account_user = user(email, name)
                membership = add(Membership, organization_id=org.id, user_id=account_user.id, role_id=role.id, role=role.slug, status="active", is_owner=False)
                employees.append(add(Employee, organization_id=org.id, membership_id=membership.id, employee_code=code, work_email=email, join_date=date(today.year, 1, 1), work_location="Fictional QA office"))
            employee, hr = employees
            employee.manager_employee_id = hr.id
            client = add(Client, organization_id=org.id, client_code="QA-CLIENT-001", display_name="Fictional Maple Studio", email="maple-review@example.com", currency="USD")
            cost_client = add(Client, organization_id=org.id, client_code="QA-CLIENT-002", display_name="Fictional Cost-only Studio", email="cost-only-review@example.com", currency="USD", notes="No invoices. USD 60 cost tests transaction-currency reporting despite GBP client preference.")
            lead_status = db.scalar(select(LeadStatus).where(LeadStatus.organization_id == org.id, LeadStatus.is_default.is_(True)))
            for index, country in enumerate(("US", "GB", "BD"), 1):
                add(Lead, organization_id=org.id, lead_code=f"QA-LEAD-{index:03}", company_name=f"Fictional {country} Prospect", contact_name=f"Review Contact {index}", email=f"qa-prospect-{index}@example.com", country_code=country, currency="USD", estimated_value=500 * index, status_id=lead_status.id, assigned_employee_id=employee.id, notes="Synthetic local review only. Do not contact.")
            cash = safe_create_account(FinancialAccountCreate(name="QA Synthetic Cash", account_type="cash", currency="USD", opening_balance=D("5000"), notes="Fictional local ledger; no bank connection."), req, db, tenant)
            vendor = add(Vendor, **common, vendor_code="QA-VENDOR-001", name="Fictional Stock Supplier", email="qa-vendor@example.com", currency="USD")
            warehouse = create_warehouse(WarehouseCreate(code="QA-WH", name="QA Review Warehouse"), req, db, tenant)
            product = create_product(ProductCreate(sku="QA-STOCK-001", name="QA Review Stock Unit", item_type="stock_item", currency="USD", standard_cost=D("6"), selling_price=D("15")), req, db, tenant)
            receive_purchase(PurchaseReceiptCreate(supplier_name=vendor.name, vendor_id=vendor.id, warehouse_id=warehouse.id, receipt_date=today, currency="USD", reference="QA-UNPAID-STOCK", items=[PurchaseLineInput(product_id=product["id"], quantity=D("10"), unit_cost=D("6"))]), req, db, tenant)
            order = add(Order, **common, order_number="QA-ORDER-001", subject="QA website delivery", client_id=client.id, assigned_employee_id=employee.id, order_date=today, currency="USD", seller_name_snapshot=NAME, client_name_snapshot=client.display_name, subtotal=1200, total=1200)
            add(OrderItem, organization_id=org.id, order_id=order.id, item_name_snapshot="QA Website Service", description="Synthetic website delivery", quantity=1, unit_price=1200, line_subtotal=1200, discount_amount=0, taxable_amount=1200, tax_amount=0, line_total=1200)
            project = add(Project, **common, project_number="QA-PROJECT-001", name="QA Order-linked Website", client_id=client.id, order_id=order.id, project_manager_employee_id=hr.id, currency="USD", contract_value=1200, status="in_progress", due_date=today + timedelta(days=14))
            add(ProjectMember, organization_id=org.id, project_id=project.id, employee_id=employee.id, added_by_user_id=owner.id)
            add(ProjectTask, **common, project_id=project.id, task_code="QA-TASK-001", title="Review fixture website", assignee_employee_id=employee.id, due_date=today + timedelta(days=7))
            for label, amount in [("Paid order-linked service", "1200"), ("Draft excluded from revenue", "47.25"), ("Cancelled excluded from revenue", "24.68")]:
                invoice = create_invoice(InvoiceCreate(client_id=client.id, subject=f"QA {label}", issue_date=today, due_date=today + timedelta(days=14), currency="USD", items=[InvoiceItemInput(item_name=label, description="Synthetic local review service", quantity=D("1"), unit_price=D(amount))]), req, db, tenant)
                if label.startswith("Paid"):
                    # Deliberately order-only, exercising project attribution fallback.
                    db.get(Invoice, invoice.id).order_id = order.id
                    db.flush()
                    safe_change_invoice_status(invoice.id, InvoiceStatusAction(action="send"), req, db, tenant)
                    safe_record_payment(PaymentCreate(invoice_id=invoice.id, account_id=cash.id, payment_date=today, invoice_amount=D(amount), method="cash", reference="QA-SYNTHETIC-RECEIPT"), req, db, tenant)
                elif label.startswith("Cancelled"):
                    safe_change_invoice_status(invoice.id, InvoiceStatusAction(action="cancel", reason="Synthetic cancelled invoice for local review"), req, db, tenant)
            direct = db.scalar(select(ExpenseCategory).where(ExpenseCategory.organization_id == org.id, ExpenseCategory.cost_type == "direct"))
            operating = db.scalar(select(ExpenseCategory).where(ExpenseCategory.organization_id == org.id, ExpenseCategory.cost_type == "operating"))
            for label, category, cid, pid, amount in [("QA Project direct cost", direct, client.id, project.id, "250"), ("QA Cost-only client", operating, cost_client.id, None, "60")]:
                safe_create_expense(ExpenseCreate(description=label, category_id=category.id, account_id=cash.id, client_id=cid, project_id=pid, expense_date=today, expense_currency="USD", expense_amount=D(amount), payment_method="cash"), req, db, tenant)
            # Change the client preference after the USD cost was posted. The
            # historical transaction must keep its original reporting currency.
            cost_client.currency = "GBP"
            leave_type = add(LeaveType, organization_id=org.id, name="QA Annual Leave", code="QA-ANNUAL", annual_allowance_days=20, is_paid=True)
            for offset, state in [(1, "approved"), (4, "pending")]:
                day = today + timedelta(days=offset)
                add(LeaveRequest, organization_id=org.id, employee_id=employee.id, leave_type_id=leave_type.id, start_date=day, end_date=day, days=1, reason=f"Synthetic {state} non-overlapping review leave", status=state, reviewed_by_user_id=owner.id if state == "approved" else None, reviewed_at=utc_now() if state == "approved" else None)
            start = today.replace(day=1)
            end = today.replace(day=calendar.monthrange(today.year, today.month)[1])
            create_salary_profile(SalaryProfileCreate(employee_id=employee.id, currency="USD", base_salary=D("2000"), effective_from=start), req, db, tenant)
            period = create_period(PayrollPeriodCreate(name=f"QA {today:%B %Y}", period_start=start, period_end=end, pay_date=end), req, db, tenant)
            create_run(PayrollRunCreate(period_id=period.id, currency="USD"), req, db, tenant)
            # Validate the most important manual-review expectations before commit.
            from app.api.v1.reports_fast import _client_rows_fast, _project_rows_fast
            from app.models.inventory import InventoryBalance
            from app.models.payables import PayableBill
            db.flush()
            project_row = next(row for row in _project_rows_fast(db, org.id, today, today, None, None, None) if row.project_id == project.id)
            assert (project_row.invoiced_revenue, project_row.collected_revenue, project_row.direct_expenses, project_row.estimated_profit) == (1200, 1200, 250, 950)
            cost_row = next(row for row in _client_rows_fast(db, org.id, today, today, None, cost_client.id) if row.client_id == cost_client.id)
            assert (cost_row.currency, cost_row.estimated_profit, cost_row.margin_percent) == ("USD", -60, None)
            stock = db.scalar(select(InventoryBalance).where(InventoryBalance.organization_id == org.id))
            bill = db.scalar(select(PayableBill).where(PayableBill.organization_id == org.id))
            assert stock.on_hand_quantity == 10 and stock.inventory_value == 60
            assert bill.balance_due == 60
            record_activity(db, action="qa.review.seeded", scope="tenant", actor_user_id=owner.id, organization_id=org.id, entity_type="organization", entity_id=org.id, message="Created fictional local manual-review fixtures; no external messages or payments", request=req)
        db.commit()
        print(f"Ready: {NAME} ({org.id}); owner={owner_email}; employee=qa-review-employee@example.com; HR=qa-review-hr@example.com")
        print(f"Review reporting dates: {today.isoformat()}. USD revenue 1200, collected 1200, direct project cost 250, cost-only client expense 60, unpaid inventory AP 60, stock 10 units. Payroll remains draft.")


if __name__ == "__main__":
    main()
