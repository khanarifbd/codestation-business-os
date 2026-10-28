"""Remove ONLY the approved prospective settlement layer for older invariants.
Every restored byte must match the exact v31 preimage; no alternative golden hash.
Runtime tests continue loading current application code, never this restoration.
"""
import hashlib

V31={'app/api/v1/order_settlements.py':'5e8ef9867c628e605fc5bcbd7922486f81c8a71a4e370922e974506a7f4720da','app/services/order_settlement.py':'62d37c6c9a211fa97a726f97240226a6974b82d76f651f952737e33463cddc09'}
POSTING_BLOCK='''    # These helpers post only GL entries; the operational cash movements above
    # remain the single receipt and optional fee. Payment also ensures issuance.
    post_invoice_payment(db, organization_id=organization_id, user_id=user_id, payment=payment)
    if expense is not None:
        post_expense(db, organization_id=organization_id, user_id=user_id, expense=expense)

'''
OLD_RETURN='''    return settle_order(
        db,
        organization_id=tenant.organization_id,
        user_id=tenant.user_id,
        organization_timezone=tenant.organization.timezone,
        order_id=order_id,
        payload=payload,
        request=request,
    )
'''
NEW_RETURN='''    with defer_commits(db):
        result = settle_order(
            db,
            organization_id=tenant.organization_id,
            user_id=tenant.user_id,
            organization_timezone=tenant.organization.timezone,
            order_id=order_id,
            payload=payload,
            request=request,
        )
    db.commit()
    return result
'''
def restore_v31(path,source):
    if path not in V31:return source
    def exact(old,new=''):
        nonlocal source
        if source.count(old)!=1:raise AssertionError('Missing/changed approved settlement delta in '+path+': '+old[:90])
        source=source.replace(old,new,1)
    if path=='app/api/v1/order_settlements.py':
        exact('from app.db.session import defer_commits\n');exact(NEW_RETURN,OLD_RETURN)
    else:
        exact('from app.services.financial_account_constraints import ensure_payment_receipt_account_supported\n')
        exact('from app.services.operational_posting import post_expense, post_invoice_payment\n')
        exact('            FinancialAccount.account_type != "credit_card",\n')
        exact('''        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if account is None or not account.is_active:''','''        .with_for_update()
    )
    if account is None or not account.is_active:''')
        exact('    ensure_payment_receipt_account_supported(account.account_type)\n')
        exact(POSTING_BLOCK)
    if hashlib.sha256(source.encode()).hexdigest()!=V31[path]:
        raise AssertionError('Unapproved change remains outside exact settlement delta: '+path)
    return source
