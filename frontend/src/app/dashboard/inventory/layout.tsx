import type { ReactNode } from "react";

import { OptionalInventorySelectGuard } from "./optional-select-guard";

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <OptionalInventorySelectGuard />
    </>
  );
}
