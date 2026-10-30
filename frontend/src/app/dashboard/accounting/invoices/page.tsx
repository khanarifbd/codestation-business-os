import { InvoicesWorkspaceV2 } from "@/components/invoices-workspace-v2";
import { parseInvoiceClientIntent } from "@/lib/invoice-client-intent";

export default async function InvoicesPage({ searchParams }: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const requestedClientId = parseInvoiceClientIntent((await searchParams).client_id);
  return <InvoicesWorkspaceV2 requestedClientId={requestedClientId} />;
}
