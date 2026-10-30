import { InvoiceWorkspace } from "@/components/invoice-workspace";
import { safeFinanceReturn } from "@/lib/finance-compatibility-navigation";

export default async function InvoiceDetailPage({ params, searchParams }: {
  params: Promise<{ invoiceId: string }>;
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { invoiceId } = await params;
  const raw = (await searchParams)?.returnTo;
  const returnHref = typeof raw === "string" ? safeFinanceReturn(raw, ["invoices", "payments"]) : null;
  return <InvoiceWorkspace invoiceId={invoiceId} returnHref={returnHref} />;
}
