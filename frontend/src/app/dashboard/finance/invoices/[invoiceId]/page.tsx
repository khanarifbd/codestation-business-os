import { notFound, redirect } from "next/navigation";

// Client history still links to this legacy URL. Keep one invoice controller and
// its existing tenant/permission checks; this alias never reads or changes data.
export default async function LegacyInvoiceDetailPage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const { invoiceId } = await params;
  if (!invoiceId || invoiceId === "." || invoiceId === "..") notFound();
  redirect(`/dashboard/accounting/invoices/${encodeURIComponent(invoiceId)}`);
}
