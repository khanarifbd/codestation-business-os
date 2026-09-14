"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, LockKeyhole } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api-error";

type LoanLifecycleItem = {
  id: string;
  lender_name: string;
  currency: string;
  approved_amount: string;
  disbursed_amount: string;
  outstanding_principal: string;
  status: string;
};

export function LoanLifecycleControls() {
  const [loans, setLoans] = useState<LoanLifecycleItem[]>([]);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/accounting/loans", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, "Could not load loan lifecycle"));
      setLoans(payload);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load loan lifecycle");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const actionable = useMemo(
    () => loans.filter((loan) =>
      loan.status === "draft" ||
      loan.status === "paid" ||
      (loan.status === "approved" && Number(loan.disbursed_amount) > 0 && Number(loan.outstanding_principal) === 0)
    ),
    [loans],
  );

  async function transition(loan: LoanLifecycleItem, action: "approve" | "close") {
    setLoadingId(loan.id);
    setError(null);
    try {
      const response = await fetch(`/api/accounting/loans/${loan.id}/${action}`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(getApiErrorMessage(payload, `Could not ${action} loan`));
      await load();
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `Could not ${action} loan`);
      setLoadingId(null);
    }
  }

  if (!actionable.length && !error) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <LockKeyhole className="mt-0.5 size-5 text-neutral-500" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Loan lifecycle controls</p>
            <p className="mt-1 text-xs text-neutral-500">
              Draft agreements require approval before money can be received. Fully repaid loans can be formally closed.
            </p>
            {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
            {actionable.length ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {actionable.map((loan) => {
                  const action: "approve" | "close" = loan.status === "draft" ? "approve" : "close";
                  return (
                    <button
                      key={loan.id}
                      type="button"
                      disabled={loadingId !== null}
                      onClick={() => void transition(loan, action)}
                      className="inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50"
                    >
                      <CheckCircle2 className="size-4" />
                      {action === "approve" ? "Approve" : "Close"} · {loan.lender_name}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
