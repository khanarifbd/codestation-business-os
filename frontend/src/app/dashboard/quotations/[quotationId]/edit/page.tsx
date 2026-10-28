import { QuotationV2Workspace } from "../../quotation-v2-workspace";

export default async function EditQuotationPage({ params }: { params: Promise<{ quotationId: string }> }) {
  const { quotationId } = await params;
  return <QuotationV2Workspace key={`edit:${quotationId}`} mode="edit" quotationId={quotationId} />;
}
