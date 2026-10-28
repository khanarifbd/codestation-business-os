import { QuotationV2Workspace } from "../quotation-v2-workspace";

export default async function QuotationPage({ params }: { params: Promise<{ quotationId: string }> }) {
  const { quotationId } = await params;
  return <QuotationV2Workspace key={`view:${quotationId}`} mode="view" quotationId={quotationId} />;
}
