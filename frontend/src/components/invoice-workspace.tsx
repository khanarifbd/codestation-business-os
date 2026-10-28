"use client";

import { useCallback, useState } from "react";
import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";
import { InvoicePaymentWorkspace } from "@/components/invoice-payment-workspace";

export function InvoiceWorkspace({ invoiceId }: { invoiceId: string }) {
  const [revision, setRevision] = useState(0);
  const refreshPreview = useCallback(() => setRevision((value) => value + 1), []);
  return <div className="invoice-workspace">
    <InvoiceDetailWorkspace invoiceId={invoiceId} onUpdated={refreshPreview} />
    <div className="invoice-payment-continuation"><InvoicePaymentWorkspace key={`${invoiceId}:${revision}`} invoiceId={invoiceId} /></div>
  </div>;
}
