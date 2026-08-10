"use client";

import { AlertTriangle, Loader2, X } from "lucide-react";

export type ConfirmationDetail = {
  label: string;
  value: string;
  emphasis?: boolean;
};

type Props = {
  open: boolean;
  title: string;
  description: string;
  details: ConfirmationDetail[];
  confirmLabel: string;
  loading?: boolean;
  warning?: string;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

export function FinancialConfirmationDialog({
  open,
  title,
  description,
  details,
  confirmLabel,
  loading = false,
  warning,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-4" role="dialog" aria-modal="true" aria-labelledby="financial-confirmation-title">
      <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Review before posting</p>
            <h2 id="financial-confirmation-title" className="mt-1 text-xl font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-500">{description}</p>
          </div>
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-lg p-2 hover:bg-neutral-100 disabled:opacity-40" aria-label="Close confirmation">
            <X className="size-5" />
          </button>
        </div>

        <div className="mt-5 divide-y rounded-2xl border bg-neutral-50 px-4">
          {details.map((detail) => (
            <div key={detail.label} className="flex items-start justify-between gap-4 py-3">
              <span className="text-sm text-neutral-500">{detail.label}</span>
              <span className={`max-w-[60%] text-right text-sm ${detail.emphasis ? "font-semibold text-neutral-950" : "font-medium text-neutral-700"}`}>{detail.value}</span>
            </div>
          ))}
        </div>

        {warning ? (
          <div className="mt-4 flex gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>{warning}</p>
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={loading} className="rounded-xl border px-4 py-2.5 text-sm font-medium disabled:opacity-40">Go back</button>
          <button type="button" onClick={() => void onConfirm()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl bg-neutral-950 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {loading ? <Loader2 className="size-4 animate-spin" /> : null}
            {loading ? "Posting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
