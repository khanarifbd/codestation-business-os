import { redirect } from "next/navigation";

export default async function LegacyInvoicePrintPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  redirect(`/print/invoices/${encodeURIComponent(invoiceId)}`);
}
