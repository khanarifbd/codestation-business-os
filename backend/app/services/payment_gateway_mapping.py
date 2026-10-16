"""Tenant-validated gateway account mapping (metadata only; never posts money)."""
from fastapi import HTTPException
from sqlalchemy import select

from app.models.finance import FinancialAccount
from app.models.payment_gateways import PaymentGatewayConnection


def validate_gateway_mapping(
    db, *, organization_id: str, gateway_connection_id: str | None,
    account_type: str, currency: str, exclude_account_id: str | None = None,
) -> str | None:
    if not gateway_connection_id:
        return None
    if account_type != "payment_gateway":
        raise HTTPException(status_code=422, detail="Only payment gateway accounts can be linked to a gateway connection")
    gateway = db.scalar(select(PaymentGatewayConnection).where(
        PaymentGatewayConnection.id == gateway_connection_id,
        PaymentGatewayConnection.organization_id == organization_id,
        PaymentGatewayConnection.is_active.is_(True),
    ))
    if gateway is None:
        raise HTTPException(status_code=404, detail="Active gateway connection not found in this company")
    if gateway.provider == "stripe" and gateway.mode == "test" and currency.upper() != "USD":
        raise HTTPException(status_code=422, detail="Stripe Sandbox mapping currently requires a USD financial account")
    existing = select(FinancialAccount.id).where(
        FinancialAccount.organization_id == organization_id,
        FinancialAccount.gateway_connection_id == gateway.id,
        FinancialAccount.currency == currency.upper(),
    )
    if exclude_account_id:
        existing = existing.where(FinancialAccount.id != exclude_account_id)
    if db.scalar(existing) is not None:
        raise HTTPException(status_code=409, detail="This gateway is already linked to another financial account in the same currency")
    return gateway.id
