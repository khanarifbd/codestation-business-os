import { InvoiceDetailWorkspace } from "@/components/invoice-detail-workspace";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <InvoiceDetailWorkspace invoiceId={invoiceId} />;
}
