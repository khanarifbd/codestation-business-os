from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select, text
from starlette.requests import Request

from app.api.v1.finance import create_invoice_from_order
from app.db.session import SessionLocal, engine
from app.models.orders import Order
from app.services.accounting_sync import _invoice_product_revenue


@dataclass(frozen=True)
class Org:
    id: str
    currency: str
    timezone: str
    name: str


@dataclass(frozen=True)
class Tenant:
    organization_id: str
    user_id: str
    membership_id: str
    organization: Org
    role: str = "admin"


def request() -> Request:
    path = "/finance/invoices/from-order"
    return Request({"type":"http","method":"POST","path":path,"raw_path":path.encode(),"headers":[],"query_string":b"","scheme":"https","server":("testserver",443),"client":("127.0.0.1",50000)})


def main() -> None:
    with engine.begin() as conn:
        row=conn.execute(text("""SELECT o.id organization_id,o.created_by_user_id user_id,o.currency,o.timezone,o.name,m.id membership_id FROM organizations o JOIN memberships m ON m.organization_id=o.id AND m.user_id=o.created_by_user_id WHERE o.name='Existing Tenant Fixture' ORDER BY o.created_at DESC LIMIT 1""")).mappings().one()
    tenant=Tenant(str(row["organization_id"]),str(row["user_id"]),str(row["membership_id"]),Org(str(row["organization_id"]),str(row["currency"] or "BDT"),str(row["timezone"] or "UTC"),str(row["name"])))
    db=SessionLocal()
    try:
        order=db.scalar(select(Order).where(Order.organization_id==tenant.organization_id,Order.subject=="Product order").order_by(Order.created_at.desc()))
        if order is None: raise AssertionError("inventory sales fixture order missing")
        invoice=create_invoice_from_order(order.id,request(),db,tenant)  # type: ignore[arg-type]
        product_revenue=_invoice_product_revenue(db,tenant.organization_id,db.get(type(db.scalar(select(__import__('app.models.finance',fromlist=['Invoice']).Invoice).where(__import__('app.models.finance',fromlist=['Invoice']).Invoice.id==invoice.id))),invoice.id) if False else db.scalar(select(__import__('app.models.finance',fromlist=['Invoice']).Invoice).where(__import__('app.models.finance',fromlist=['Invoice']).Invoice.id==invoice.id)))
        if product_revenue != Decimal("720.00"):
            raise AssertionError(f"expected product revenue 720.00, got {product_revenue}")
    finally:
        db.close()
    print("inventory revenue verification passed: order-linked product invoice -> Sales Revenue classifier")


if __name__ == "__main__":
    main()
