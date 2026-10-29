"use client";
import { type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
export { AccountHeading as ExpenseHeading, AccountSectionHeading as ExpenseSectionHeading, AccountState as ExpenseState } from "@/components/accounting-accounts/account-ui";
export { MoneyOutConfirmation as ExpenseConfirmation } from "@/components/accounting-money-out/money-out-ui";
export const pretty = (value: string) => value.replaceAll("_", " ").replace(/\b\w/g, c => c.toUpperCase());
export function ExpenseBack({ onClick, disabled = false, context, label = "Back to expenses" }: { onClick: () => void; disabled?: boolean; context: string; label?: string }) {
  return <div className="aa-breadcrumb"><button className="aa-back" disabled={disabled} onClick={onClick}><ArrowLeft aria-hidden="true"/>{label}</button><span>{context}</span></div>;
}
export function ExpenseField({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`ex-field${wide ? " ex-wide" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
export function ExpenseDatum({ label, children }: { label: string; children: ReactNode }) {
  return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>;
}
