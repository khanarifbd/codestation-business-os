"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CircleDashed, LockKeyhole } from "lucide-react";
import { MoneyOutConfirmation } from "@/components/accounting-money-out/money-out-ui";
import type { ConfirmationDetail } from "@/components/financial-confirmation-dialog";
import type { ReconciliationSession } from "./reconciliation-types";

export {
  AccountHeading as ReconciliationHeading,
  AccountSectionHeading as ReconciliationSectionHeading,
  AccountState as ReconciliationState,
} from "@/components/accounting-accounts/account-ui";

export const reconciliationPretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());

export function ReconciliationBack({ onClick, disabled = false, matching = false, context }: {
  onClick: () => void; disabled?: boolean; matching?: boolean; context: string;
}) {
  return <div className="aa-breadcrumb rc-breadcrumb">
    <button type="button" className="aa-back" onClick={onClick} disabled={disabled}>
      <ArrowLeft aria-hidden="true"/>{matching ? "Back to statement" : "Back to reconciliations"}
    </button>
    <span>{context}</span>
  </div>;
}

export function ReconciliationStatus({ status }: { status: ReconciliationSession["status"] }) {
  return <span className="rc-status" data-finalized={status === "finalized" || undefined}>
    {status === "finalized" ? <LockKeyhole aria-hidden="true"/> : <CircleDashed aria-hidden="true"/>}
    {status === "finalized" ? "Finalized" : "Draft"}
  </span>;
}

export function ReconciliationField({ label, hint, children, wide = false }: {
  label: string; hint?: string; children: ReactNode; wide?: boolean;
}) {
  return <label className={`rc-field${wide ? " rc-wide" : ""}`}>
    <span>{label}</span>{children}{hint ? <small>{hint}</small> : null}
  </label>;
}

export function ReconciliationDatum({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>;
}

export function ReconciliationPager({ page, pages, count, busy, onPage }: {
  page: number; pages: number; count: number; busy?: boolean; onPage: (value: number) => void;
}) {
  return <div className="rc-pager">
    <p>Page {page} of {pages} · {count} match{count === 1 ? "" : "es"} in the loaded slice</p>
    <div>
      <button type="button" className="aa-secondary" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>
        <ArrowLeft aria-hidden="true"/>Previous
      </button>
      <button type="button" className="aa-secondary" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>
        Next<ArrowRight aria-hidden="true"/>
      </button>
    </div>
  </div>;
}

export function ReconciliationConfirmation({ open, loading, details, title, description, warning, confirmLabel, onCancel, onConfirm }: {
  open: boolean; loading: boolean; details: ConfirmationDetail[]; title: string;
  description: string; warning: string; confirmLabel: string; onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}) {
  if (!open) return null;
  return <div className="rc-confirmation"><MoneyOutConfirmation open={open} loading={loading} details={details} title={title}
    description={description} warning={warning} confirmLabel={confirmLabel} onCancel={onCancel}
    onConfirm={onConfirm} eyebrow="Review reconciliation" busyLabel="Saving…"/></div>;
}
