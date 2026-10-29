"use client";

import { FileText, Pencil, WalletCards } from "lucide-react";
import Link from "next/link";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { orderDocumentHref, orderReturnHref } from "@/lib/order-navigation";
import "@/components/commercial/order-detail.css";

export default function OrderWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ orderId: string }>();
  const pathname = usePathname();
  const orderId = params.orderId;
  const searchParams = useSearchParams();
  const returnHref = orderReturnHref(searchParams.toString());
  const detailPath = `/dashboard/orders/${encodeURIComponent(orderId)}`;
  const commercialPath = `${detailPath}/commercial`;
  const showEditAction = pathname === detailPath;

  return <>
    <div className="order-workspace-nav">
      <div>
        <nav aria-label="Order workspace">
          <Link href={orderDocumentHref(orderId, "view", returnHref)} aria-current={pathname === detailPath ? "page" : undefined}><FileText aria-hidden="true" />Order</Link>
          <Link href={orderDocumentHref(orderId, "commercial", returnHref)} aria-current={pathname.startsWith(commercialPath) ? "page" : undefined}><WalletCards aria-hidden="true" />Commercial</Link>
        </nav>
        {showEditAction ? <a href={orderDocumentHref(orderId, "edit", returnHref)} className="order-workspace-edit"><Pencil aria-hidden="true" />Edit order</a> : null}
      </div>
    </div>
    <div key={orderId} className="order-workspace-route">{children}</div>
  </>;
}
