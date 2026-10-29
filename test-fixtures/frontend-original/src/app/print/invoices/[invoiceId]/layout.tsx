import type { ReactNode } from "react";

/**
 * Keep the document's typography and spacing in the shared print page.
 * The previous layout injected a second @media print stylesheet that
 * reduced every font, margin and QR size only in the PDF output.
 */
export default function InvoicePrintLayout({ children }: { children: ReactNode }) {
  return children;
}
