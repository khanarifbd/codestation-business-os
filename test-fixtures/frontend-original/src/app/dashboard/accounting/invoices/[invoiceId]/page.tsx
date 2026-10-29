import { InvoiceWorkspace } from "@/components/invoice-workspace";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  return <InvoiceWorkspace invoiceId={invoiceId} />;
}
