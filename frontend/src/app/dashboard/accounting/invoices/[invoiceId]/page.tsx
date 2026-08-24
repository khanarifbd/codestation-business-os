import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";
import { InvoicePaymentWorkspace } from "@/components/invoice-payment-workspace";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <>
    <InvoiceDetailWorkspace invoiceId={invoiceId} />
    <InvoicePaymentWorkspace invoiceId={invoiceId} />
  </>;
}
