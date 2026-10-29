"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { FinancialConfirmationDialog, type ConfirmationDetail } from "@/components/financial-confirmation-dialog";
export { AccountHeading as MoneyInHeading, AccountSectionHeading as MoneyInSectionHeading, AccountState as MoneyInState } from "@/components/accounting-accounts/account-ui";

export function MoneyInDatum({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>;
}
export function MoneyInField({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`mi-field${wide ? " mi-span" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
export function MoneyInConfirmation({ open, loading, details, title, description, warning, confirmLabel, onCancel, onConfirm }: {
  open: boolean; loading: boolean; details: ConfirmationDetail[]; title: string; description: string; warning: string; confirmLabel: string;
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
  return <div ref={root}><FinancialConfirmationDialog open={open} loading={loading} details={details} title={title} description={description} warning={warning} confirmLabel={confirmLabel} onCancel={onCancel} onConfirm={onConfirm}/></div>;
}
