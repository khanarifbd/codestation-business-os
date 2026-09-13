import type { ReactNode } from "react";

import { LoanLifecycleControls } from "./loan-lifecycle-controls";

export default function LoanAccountingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <LoanLifecycleControls />
      {children}
    </>
  );
}
