import { Suspense } from "react";
import QuotationsList from "./quotations-list";

export default function QuotationsPage() {
  return <Suspense fallback={<p role="status">Loading quotations…</p>}><QuotationsList /></Suspense>;
}
