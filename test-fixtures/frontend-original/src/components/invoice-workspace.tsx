"use client";

import { useCallback, useState } from "react";
import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";
import { InvoicePaymentWorkspace } from "@/components/invoice-payment-workspace";

export function InvoiceWorkspace({ invoiceId }: { invoiceId: string }) {
  const [revision, setRevision] = useState(0);
  const refreshPreview = useCallback(() => setRevision((value) => value + 1), []);
  return <>
    <InvoiceDetailWorkspace invoiceId={invoiceId} onUpdated={refreshPreview} />
    <InvoicePaymentWorkspace key={`${invoiceId}:${revision}`} invoiceId={invoiceId} />
  </>;
}
