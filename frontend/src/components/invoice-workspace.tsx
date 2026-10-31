"use client";

import { useCallback, useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";
import { InvoicePaymentWorkspace } from "@/components/invoice-payment-workspace";

export function InvoiceWorkspace({ invoiceId, returnHref }: { invoiceId: string; returnHref?: string | null }) {
  const { tenant } = useDashboardSession();
  const scope = JSON.stringify([tenant?.organization?.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions, invoiceId]);
  const [revision, setRevision] = useState(0);
  const refreshPreview = useCallback(() => setRevision((value) => value + 1), []);
  return <div className="invoice-workspace">
    <InvoiceDetailWorkspace key={scope} invoiceId={invoiceId} returnHref={returnHref} onUpdated={refreshPreview} />
    <div className="invoice-payment-continuation"><InvoicePaymentWorkspace key={`${scope}:${revision}`} invoiceId={invoiceId} /></div>
  </div>;
}
