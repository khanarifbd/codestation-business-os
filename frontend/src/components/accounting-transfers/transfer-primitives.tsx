"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { FinancialConfirmationDialog, type ConfirmationDetail } from "@/components/financial-confirmation-dialog";
export { AccountState as TransferState, AccountHeading as TransferHeading, AccountSectionHeading as TransferSectionHeading } from "@/components/accounting-accounts/account-ui";
export function TransferDatum({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children || "—"}</dd></div>; }
/** Add keyboard containment and focus return without changing the shared financial dialog. */
export function TransferConfirmation({ open, loading, details, uncertain, onCancel, onConfirm }: { open: boolean; loading: boolean; details: ConfirmationDetail[]; uncertain: boolean; onCancel: () => void; onConfirm: () => Promise<void> }) {
  const root = useRef<HTMLDivElement>(null), cancel = useRef(onCancel), busy = useRef(loading);
  useEffect(() => { cancel.current = onCancel; busy.current = loading; }, [onCancel, loading]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const buttons = () => Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
    buttons()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy.current) cancel.current(); }
      if (event.key !== "Tab") return;
      const items = buttons(); if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || !root.current?.contains(document.activeElement))) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === items.at(-1) || !root.current?.contains(document.activeElement))) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <div ref={root}><FinancialConfirmationDialog open={open} loading={loading} title={uncertain ? "Retry this same recorded transfer?" : "Record this transfer?"} description="This posts to the accounting ledger. It does not move money through your bank or payment provider." details={details} confirmLabel={uncertain ? "Retry same operation" : "Confirm & record"} warning={uncertain ? "First verify the register. This retry reuses the original payload and idempotency key; do not create a different transfer for an uncertain result." : "The total deduction includes the fee. The principal is an account-to-account movement; only the fee is an expense. Posted transfers cannot be edited here."} onCancel={onCancel} onConfirm={onConfirm}/></div>;
}
