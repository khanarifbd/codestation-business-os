"use client";

import type { ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { MoneyOutConfirmation } from "@/components/accounting-money-out/money-out-ui";
import type { ConfirmationDetail } from "@/components/financial-confirmation-dialog";
export { AccountHeading as AdvancedHeading, AccountSectionHeading as AdvancedSectionHeading, AccountState as AdvancedState } from "@/components/accounting-accounts/account-ui";

export type AdvancedActionPresentation = {
  phase: "idle" | "saving" | "acknowledged" | "unknown";
  locked: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  operation: { title: string; description: string; warning: string; details: ConfirmationDetail[]; confirmLabel: string } | null;
  confirmation: { title: string; description: string; warning: string; details: ConfirmationDetail[]; confirmLabel: string } | null;
  confirm: () => void | Promise<void>;
  close: () => void;
};
export function AdvancedBack({ onClick, disabled = false, label = "Back to advanced accounting", context }: { onClick: () => void; disabled?: boolean; label?: string; context: string }) {
  return <div className="ad-breadcrumb"><button className="aa-back" type="button" onClick={onClick} disabled={disabled}><ArrowLeft aria-hidden="true"/>{label}</button><span>{context}</span></div>;
}
export function AdvancedField({ label, hint, children, wide = false }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className={`ad-field${wide ? " ad-span" : ""}`}><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}
export function AdvancedDatum({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children ?? "—"}</dd></div>; }
export function AdvancedNotice({ children, tone = "info" }: { children: ReactNode; tone?: "error" | "info" | "success" }) { return <div className="ad-notice" role={tone === "error" ? "alert" : "status"} data-tone={tone}>{children}</div>; }
export function AdvancedPager({ page, pages, total, onPage, scope = "matching loaded records" }: { page: number; pages: number; total: number; onPage: (value: number) => void; scope?: string }) {
  return <div className="ad-pager"><p>Page {page} of {pages} · {total} {scope}</p><div><button className="aa-secondary" type="button" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden="true"/>Previous</button><button className="aa-secondary" type="button" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ChevronRight aria-hidden="true"/></button></div></div>;
}
export function AdvancedActionStatus({ action, children }: { action: AdvancedActionPresentation; children?: ReactNode }) {
  if (action.phase === "unknown" || action.phase === "acknowledged") return <section className="ad-outcome" data-phase={action.phase} role="status"><div className="ad-outcome-icon">{action.phase === "unknown" ? <ShieldAlert aria-hidden="true"/> : <CheckCircle2 aria-hidden="true"/>}</div><div><p className="aa-eyebrow">{action.phase === "unknown" ? "Outcome needs verification" : "Write acknowledged"}</p><h2>{action.phase === "unknown" ? "Do not repeat this action." : "Repeat posting is locked in this workspace."}</h2><p>{action.notice || (action.phase === "unknown" ? "The response did not establish the outcome. Inspect the saved records before taking another financial action." : "A successful response is retained even if later parsing or navigation is unavailable.")}</p><p className="ad-muted">A record missing from a capped list is not proof that a write failed. Reads do not replay the original request.</p>{action.error ? <p className="ad-inline-error">{action.error}</p> : null}{action.operation ? <section className="ad-operation-context" aria-label="Submitted operation context"><h3>Submitted operation context</h3><p>This is the submitted review, not a fresh verification of saved server state.</p><dl>{action.operation.details.map((detail, index) => <div key={`${detail.label}-${index}`}><dt>{detail.label}</dt><dd className={detail.emphasis ? "ad-emphasis" : undefined}>{detail.value}</dd></div>)}</dl></section> : null}{children ? <div className="ad-outcome-actions">{children}</div> : null}</div></section>;
  return <>{action.error ? <AdvancedNotice tone="error">{action.error}</AdvancedNotice> : null}{action.notice ? <AdvancedNotice>{action.notice}</AdvancedNotice> : null}</>;
}
export function AdvancedConfirmation({ action }: { action: AdvancedActionPresentation }) {
  const c = action.confirmation;
  return <MoneyOutConfirmation open={Boolean(c)} loading={action.busy} title={c?.title || "Review accounting action"} description={c?.description || ""} warning={c?.warning || ""} details={c?.details || []} confirmLabel={c?.confirmLabel || "Confirm"} eyebrow="Review accounting action" busyLabel="Recording…" onCancel={action.close} onConfirm={action.confirm}/>;
}
export function AdvancedDocumentLink({ href, children }: { href: string; children: ReactNode }) { return <a className="aa-secondary" href={href}>{children}<ArrowRight aria-hidden="true"/></a>; }
