from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, Request, status
from sqlalchemy import case, func, select

from app.models.expenses import Expense, ExpenseCategory
from app.models.finance import FinancialAccount, FinancialTransaction, Invoice, InvoiceItem, Payment
from app.models.orders import Order, OrderItem
from app.models.projects import Project
from app.schemas.order_settlements import (
    OrderSettlementAccountOption,
    OrderSettlementCategoryOption,
    OrderSettlementCreate,
    OrderSettlementExpenseRead,
    OrderSettlementMeta,
    OrderSettlementRead,
    OrderSettlementState,
)
from app.services.activity_log import record_activity
from app.services.crm import next_sequence_code

MONEY = Decimal("0.01")
ONE_RATE = Decimal("1.00000000")


def _money(value: Decimal | int | str) -> Decimal:
    return Decimal(value).quantize(MONEY, rounding=ROUND_HALF_UP)


def _tenant_today(timezone_name: str):
    try:
        return datetime.now(ZoneInfo(timezone_name)).date()
    except ZoneInfoNotFoundError:
        return datetime.now(timezone.utc).date()


def _account_balance(db, account: FinancialAccount) -> Decimal:
    net = db.scalar(
        select(
            func.coalesce(
                func.sum(
                    case(
                        (FinancialTransaction.direction == "credit", FinancialTransaction.amount),
                        else_=-FinancialTransaction.amount,
                    )
                ),
                0,
            )
        ).where(
            FinancialTransaction.organization_id == account.organization_id,
            FinancialTransaction.account_id == account.id,
        )
    ) or Decimal("0")
    return _money(Decimal(account.opening_balance) + Decimal(net))


def _active_invoice(db, organization_id: str, order_id: str) -> Invoice | None:
    return db.scalar(
        select(Invoice)
        .where(
            Invoice.organization_id == organization_id,
            Invoice.order_id == order_id,
            Invoice.status != "cancelled",
        )
        .order_by(Invoice.created_at.desc())
        .limit(1)
    )


def settlement_state(db, *, organization_id: str, order_id: str) -> OrderSettlementState:
    order = db.scalar(
        select(Order).where(Order.id == order_id, Order.organization_id == organization_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    invoice = _active_invoice(db, organization_id, order.id)
    if invoice is None:
        if order.status != "completed":
            return OrderSettlementState(
                order_id=order.id,
                eligible=False,
                reason="Complete the order before creating its invoice settlement.",
            )
        return OrderSettlementState(order_id=order.id, eligible=True)

    payment_row = db.execute(
        select(Payment, FinancialAccount.name)
        .join(
            FinancialAccount,
            (FinancialAccount.id == Payment.account_id)
            & (FinancialAccount.organization_id == organization_id),
        )
        .where(
            Payment.organization_id == organization_id,
            Payment.invoice_id == invoice.id,
            Payment.status == "confirmed",
        )
        .order_by(Payment.created_at.desc())
        .limit(1)
    ).first()
    payment = payment_row[0] if payment_row else None
    account_name = payment_row[1] if payment_row else None

    expenses: list[OrderSettlementExpenseRead] = []
    if payment is not None:
        expense_rows = db.execute(
            select(Expense, ExpenseCategory.name)
            .join(
                ExpenseCategory,
                (ExpenseCategory.id == Expense.category_id)
                & (ExpenseCategory.organization_id == organization_id),
            )
            .where(
                Expense.organization_id == organization_id,
                Expense.payment_id == payment.id,
                Expense.status == "posted",
            )
            .order_by(Expense.created_at.asc())
        ).all()
        expenses = [
            OrderSettlementExpenseRead(
                id=expense.id,
                expense_number=expense.expense_number,
                category_name=category_name,
                amount=expense.expense_amount,
                currency=expense.expense_currency,
            )
            for expense, category_name in expense_rows
        ]

    if invoice.status == "paid" and payment is not None:
        reason = "This order already has a paid invoice settlement."
    else:
        reason = f"Order already has active invoice {invoice.invoice_number}. Use the existing invoice workflow instead of creating another invoice."

    return OrderSettlementState(
        order_id=order.id,
        eligible=False,
        reason=reason,
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        invoice_status=invoice.status,
        invoice_total=invoice.total,
        invoice_amount_paid=invoice.amount_paid,
        invoice_balance_due=invoice.balance_due,
        invoice_sent_to_client=invoice.sent_at is not None,
        payment_id=payment.id if payment else None,
        payment_number=payment.payment_number if payment else None,
        account_id=payment.account_id if payment else None,
        account_name=account_name,
        gross_amount=payment.invoice_amount if payment else None,
        currency=invoice.currency,
        expenses=expenses,
    )


def settlement_meta(
    db,
    *,
    organization_id: str,
    order_id: str,
) -> OrderSettlementMeta:
    order = db.scalar(
        select(Order).where(Order.id == order_id, Order.organization_id == organization_id)
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")

    accounts = db.scalars(
        select(FinancialAccount)
        .where(
            FinancialAccount.organization_id == organization_id,
            FinancialAccount.is_active.is_(True),
            FinancialAccount.currency == order.currency,
        )
        .order_by(FinancialAccount.name.asc())
    ).all()
    categories = db.scalars(
        select(ExpenseCategory)
        .where(
            ExpenseCategory.organization_id == organization_id,
            ExpenseCategory.is_active.is_(True),
        )
        .order_by(ExpenseCategory.sort_order.asc(), ExpenseCategory.name.asc())
    ).all()
    return OrderSettlementMeta(
        order_id=order.id,
        order_number=order.order_number,
        currency=order.currency,
        total=order.total,
        accounts=[
            OrderSettlementAccountOption(
                id=account.id,
                name=account.name,
                account_type=account.account_type,
                currency=account.currency,
                current_balance=_account_balance(db, account),
            )
            for account in accounts
        ],
        expense_categories=[
            OrderSettlementCategoryOption(
                id=category.id,
                name=category.name,
                cost_type=category.cost_type,
            )
            for category in categories
        ],
    )


def settle_order(
    db,
    *,
    organization_id: str,
    user_id: str,
    organization_timezone: str,
    order_id: str,
    payload: OrderSettlementCreate,
    request: Request,
) -> OrderSettlementRead:
    order = db.scalar(
        select(Order)
        .where(Order.id == order_id, Order.organization_id == organization_id)
        .with_for_update()
    )
    if order is None:
        raise HTTPException(status_code=404, detail="Order not found")
    if order.status != "completed":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete the order before creating its invoice settlement",
        )

    existing_invoice = _active_invoice(db, organization_id, order.id)
    if existing_invoice is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Order already has active invoice {existing_invoice.invoice_number}",
        )

    account = db.scalar(
        select(FinancialAccount)
        .where(
            FinancialAccount.id == payload.account_id,
            FinancialAccount.organization_id == organization_id,
        )
        .with_for_update()
    )
    if account is None or not account.is_active:
        raise HTTPException(status_code=404, detail="Active settlement account not found")
    if account.currency != order.currency:
        raise HTTPException(
            status_code=400,
            detail=(
                f"V1 order settlement requires an account in {order.currency}. "
                "Use the existing cross-currency payment workflow when conversion is required."
            ),
        )

    gross_amount = _money(order.total)
    if gross_amount <= 0:
        raise HTTPException(status_code=409, detail="Order total must be greater than zero to settle")

    expense_amount = _money(payload.expense_amount)
    if expense_amount > gross_amount:
        raise HTTPException(
            status_code=400,
            detail="Settlement expense cannot exceed the order total",
        )

    category = None
    if expense_amount > 0:
        category = db.scalar(
            select(ExpenseCategory).where(
                ExpenseCategory.id == payload.expense_category_id,
                ExpenseCategory.organization_id == organization_id,
                ExpenseCategory.is_active.is_(True),
            )
        )
        if category is None:
            raise HTTPException(status_code=404, detail="Active expense category not found")

    settlement_date = payload.settlement_date or _tenant_today(organization_timezone)
    if settlement_date < order.order_date:
        raise HTTPException(
            status_code=400,
            detail="Settlement date cannot be before the order date",
        )

    current_balance = _account_balance(db, account)
    if expense_amount > current_balance + gross_amount:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Insufficient balance in {account.name} after receiving the order payment. "
                f"Available would be {_money(current_balance + gross_amount)} {account.currency}."
            ),
        )

    project = db.scalar(
        select(Project).where(
            Project.organization_id == organization_id,
            Project.order_id == order.id,
        )
    )
    order_items = db.scalars(
        select(OrderItem)
        .where(
            OrderItem.organization_id == organization_id,
            OrderItem.order_id == order.id,
        )
        .order_by(OrderItem.sort_order.asc(), OrderItem.created_at.asc())
    ).all()
    if not order_items:
        raise HTTPException(status_code=409, detail="Order has no line items")

    now = datetime.now(timezone.utc)
    invoice = Invoice(
        organization_id=organization_id,
        invoice_number=next_sequence_code(db, organization_id, "invoice"),
        client_id=order.client_id,
        order_id=order.id,
        project_id=project.id if project else None,
        quotation_id=order.quotation_id,
        assigned_employee_id=order.assigned_employee_id,
        created_by_user_id=user_id,
        status="paid",
        subject=order.subject,
        issue_date=settlement_date,
        due_date=settlement_date,
        currency=order.currency,
        tax_calculation_mode=order.tax_calculation_mode,
        seller_name_snapshot=order.seller_name_snapshot,
        seller_email_snapshot=order.seller_email_snapshot,
        seller_address_snapshot=order.seller_address_snapshot,
        seller_tax_identifier_snapshot=order.seller_tax_identifier_snapshot,
        client_name_snapshot=order.client_name_snapshot,
        client_contact_snapshot=order.client_contact_snapshot,
        client_email_snapshot=order.client_email_snapshot,
        client_address_snapshot=order.client_address_snapshot,
        client_tax_identifier_snapshot=order.client_tax_identifier_snapshot,
        subtotal=order.subtotal,
        discount_total=order.discount_total,
        tax_total=order.tax_total,
        total=gross_amount,
        amount_paid=gross_amount,
        balance_due=Decimal("0.00"),
        notes=order.notes,
        terms_conditions=order.terms_conditions,
        internal_notes=order.internal_notes,
        sent_at=now if payload.mark_invoice_sent_to_client else None,
        paid_at=now,
    )
    db.add(invoice)
    db.flush()

    for item in order_items:
        db.add(
            InvoiceItem(
                organization_id=organization_id,
                invoice_id=invoice.id,
                source_order_item_id=item.id,
                product_id=item.product_id,
                sort_order=item.sort_order,
                item_name_snapshot=item.item_name_snapshot,
                sku_snapshot=item.sku_snapshot,
                item_type_snapshot=item.item_type_snapshot,
                unit_snapshot=item.unit_snapshot,
                service_duration_months_snapshot=item.service_duration_months_snapshot,
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                discount_percent=item.discount_percent,
                tax_rate=item.tax_rate,
                line_subtotal=item.line_subtotal,
                discount_amount=item.discount_amount,
                taxable_amount=item.taxable_amount,
                tax_amount=item.tax_amount,
                line_total=item.line_total,
            )
        )
    db.flush()

    reference = (payload.reference or order.external_order_id or order.order_number).strip()
    payment = Payment(
        organization_id=organization_id,
        payment_number=next_sequence_code(db, organization_id, "payment"),
        invoice_id=invoice.id,
        account_id=account.id,
        payment_date=settlement_date,
        invoice_currency=order.currency,
        account_currency=account.currency,
        invoice_amount=gross_amount,
        account_amount=gross_amount,
        exchange_rate=ONE_RATE,
        method="other",
        reference=reference,
        notes=f"Created from order settlement {order.order_number}",
        status="confirmed",
        created_by_user_id=user_id,
    )
    db.add(payment)
    db.flush()
    db.add(
        FinancialTransaction(
            organization_id=organization_id,
            account_id=account.id,
            transaction_date=settlement_date,
            direction="credit",
            amount=gross_amount,
            currency=account.currency,
            source_type="payment",
            source_id=payment.id,
            reference=reference or payment.payment_number,
            description=f"Payment {payment.payment_number} for invoice {invoice.invoice_number}",
            created_by_user_id=user_id,
        )
    )

    expense = None
    if expense_amount > 0 and category is not None:
        expense = Expense(
            organization_id=organization_id,
            expense_number=next_sequence_code(db, organization_id, "expense"),
            vendor_id=None,
            category_id=category.id,
            account_id=account.id,
            client_id=order.client_id,
            project_id=project.id if project else None,
            order_id=order.id,
            invoice_id=invoice.id,
            payment_id=payment.id,
            description=(payload.expense_description or f"Settlement fee for {order.order_number}").strip(),
            expense_date=settlement_date,
            expense_currency=order.currency,
            expense_amount=expense_amount,
            account_currency=account.currency,
            account_amount=expense_amount,
            exchange_rate=ONE_RATE,
            profitability_currency=order.currency,
            profitability_amount=expense_amount,
            profitability_exchange_rate=ONE_RATE,
            tax_amount=Decimal("0.00"),
            payment_method="other",
            reference=reference,
            notes=f"Created with invoice settlement for {order.order_number}",
            status="posted",
            created_by_user_id=user_id,
        )
        db.add(expense)
        db.flush()
        db.add(
            FinancialTransaction(
                organization_id=organization_id,
                account_id=account.id,
                transaction_date=settlement_date,
                direction="debit",
                amount=expense_amount,
                currency=account.currency,
                source_type="expense",
                source_id=expense.id,
                reference=reference or expense.expense_number,
                description=f"Expense {expense.expense_number}: {expense.description}",
                created_by_user_id=user_id,
            )
        )

    db.flush()

    record_activity(
        db,
        action="finance.invoice.created_from_order_settlement",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=organization_id,
        entity_type="invoice",
        entity_id=invoice.id,
        after={
            "invoice_number": invoice.invoice_number,
            "order_id": order.id,
            "project_id": project.id if project else None,
            "status": invoice.status,
            "currency": invoice.currency,
            "total": str(invoice.total),
            "sent_to_client": payload.mark_invoice_sent_to_client,
        },
        metadata={"source_order_id": order.id, "settlement_mode": "order_quick_settlement"},
        message=f"Invoice {invoice.invoice_number} created and settled from order {order.order_number}",
        request=request,
    )
    record_activity(
        db,
        action="finance.payment.recorded",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=organization_id,
        entity_type="payment",
        entity_id=payment.id,
        after={
            "payment_number": payment.payment_number,
            "invoice_id": invoice.id,
            "invoice_amount": str(gross_amount),
            "invoice_currency": order.currency,
            "account_id": account.id,
            "account_amount": str(gross_amount),
            "account_currency": account.currency,
            "exchange_rate": str(ONE_RATE),
            "invoice_status": invoice.status,
            "balance_due": "0.00",
        },
        metadata={"ledger_direction": "credit", "settlement_mode": "order_quick_settlement"},
        message=f"Payment {payment.payment_number} recorded for invoice {invoice.invoice_number}",
        request=request,
    )
    if expense is not None and category is not None:
        record_activity(
            db,
            action="finance.expense.posted",
            scope="tenant",
            actor_user_id=user_id,
            organization_id=organization_id,
            entity_type="expense",
            entity_id=expense.id,
            after={
                "expense_number": expense.expense_number,
                "category_id": category.id,
                "account_id": account.id,
                "client_id": order.client_id,
                "project_id": project.id if project else None,
                "order_id": order.id,
                "invoice_id": invoice.id,
                "payment_id": payment.id,
                "expense_amount": str(expense_amount),
                "expense_currency": order.currency,
                "account_amount": str(expense_amount),
                "account_currency": account.currency,
                "profitability_amount": str(expense_amount),
                "profitability_currency": order.currency,
            },
            metadata={
                "ledger_direction": "debit",
                "cost_type": category.cost_type,
                "settlement_mode": "order_quick_settlement",
            },
            message=f"Expense {expense.expense_number} posted with order settlement",
            request=request,
        )
    record_activity(
        db,
        action="finance.order.settled",
        scope="tenant",
        actor_user_id=user_id,
        organization_id=organization_id,
        entity_type="order",
        entity_id=order.id,
        after={
            "invoice_id": invoice.id,
            "payment_id": payment.id,
            "expense_id": expense.id if expense else None,
            "account_id": account.id,
            "gross_amount": str(gross_amount),
            "expense_amount": str(expense_amount),
            "net_amount": str(_money(gross_amount - expense_amount)),
            "currency": order.currency,
            "settlement_date": settlement_date.isoformat(),
        },
        message=f"Order {order.order_number} invoice and settlement completed",
        request=request,
    )

    db.commit()

    return OrderSettlementRead(
        order_id=order.id,
        order_number=order.order_number,
        project_id=project.id if project else None,
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        payment_id=payment.id,
        payment_number=payment.payment_number,
        expense_id=expense.id if expense else None,
        expense_number=expense.expense_number if expense else None,
        account_id=account.id,
        account_name=account.name,
        currency=order.currency,
        gross_amount=gross_amount,
        expense_amount=expense_amount,
        net_amount=_money(gross_amount - expense_amount),
        settlement_date=settlement_date,
        invoice_sent_to_client=payload.mark_invoice_sent_to_client,
    )
