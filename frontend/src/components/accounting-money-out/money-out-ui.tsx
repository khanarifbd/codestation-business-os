"use client";
import Link from "next/link";
import { ArrowRight, HandCoins, ReceiptText } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { FinancialConfirmationDialog, type ConfirmationDetail } from "@/components/financial-confirmation-dialog";
export { AccountHeading as MoneyOutHeading, AccountSectionHeading as MoneyOutSectionHeading, AccountState as MoneyOutState } from "@/components/accounting-accounts/account-ui";

export function MoneyOutDatum({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>;
}
export function MoneyOutField({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`mo-field${wide ? " mo-span" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
export function MoneyOutConfirmation({ open, loading, details, title, description, warning, confirmLabel, eyebrow, busyLabel, onCancel, onConfirm }: {
  open: boolean; loading: boolean; details: ConfirmationDetail[]; title: string; description: string; warning: string; confirmLabel: string;
  eyebrow?: string; busyLabel?: string;
  onCancel: () => void; onConfirm: () => void | Promise<void>;
}) {
  const root = useRef<HTMLDivElement>(null), cancel = useRef(onCancel), busy = useRef(loading);
  useEffect(() => { cancel.current = onCancel; busy.current = loading; }, [onCancel, loading]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () => Array.from(root.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]') ?? []);
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy.current) cancel.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      if (!items.length) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === items[0] || !root.current?.contains(document.activeElement))) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && (document.activeElement === items.at(-1) || !root.current?.contains(document.activeElement))) { event.preventDefault(); items[0].focus(); }
    };
    document.addEventListener("keydown", keydown, true);
    return () => { document.removeEventListener("keydown", keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <div ref={root}><FinancialConfirmationDialog open={open} loading={loading} details={details} title={title} description={description} warning={warning} confirmLabel={confirmLabel} eyebrow={eyebrow} busyLabel={busyLabel} onCancel={onCancel} onConfirm={onConfirm}/></div>;
}

export function MoneyOutRelatedLinks() {
  return <nav className="mo-related-links" aria-label="Other money-out workflows"><Link href="/dashboard/accounting/payables"><ReceiptText aria-hidden="true"/><div><strong>Pay an existing supplier bill</strong><small>Use Payables to settle the bill without recording the cost twice.</small></div><ArrowRight aria-hidden="true"/></Link><Link href="/dashboard/accounting/loans"><HandCoins aria-hidden="true"/><div><strong>Repay a loan</strong><small>Use Loans to keep principal, interest and charges separate.</small></div><ArrowRight aria-hidden="true"/></Link></nav>;
}
