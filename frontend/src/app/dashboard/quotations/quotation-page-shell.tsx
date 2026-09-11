"use client";

import { FileText, PanelsTopLeft } from "lucide-react";
import { useState } from "react";

import { QuotationWorkspace } from "./quotation-workspace";
import { QuotationV2Workspace } from "./quotation-v2-workspace";

type ViewMode = "quotations" | "proposal";

export function QuotationPageShell() {
  const [view, setView] = useState<ViewMode>("quotations");

  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-[1500px] px-4 pt-4 sm:px-8 lg:px-10">
        <div className="inline-flex rounded-2xl border border-neutral-200 bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => setView("quotations")}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
              view === "quotations"
                ? "bg-neutral-950 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            <FileText className="size-4" />
            Quotations
          </button>
          <button
            type="button"
            onClick={() => setView("proposal")}
            className={`flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition ${
              view === "proposal"
                ? "bg-neutral-950 text-white"
                : "text-neutral-600 hover:bg-neutral-50"
            }`}
          >
            <PanelsTopLeft className="size-4" />
            Proposal V2
          </button>
        </div>
      </div>

      {view === "quotations" ? <QuotationWorkspace /> : <QuotationV2Workspace />}
    </div>
  );
}
