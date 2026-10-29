"use client";
import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { useSearchParams } from "next/navigation";
import { MoneyOutConfirmation } from "@/components/accounting-money-out/money-out-ui";
import { usePortalDocument } from "@/hooks/use-client-portal-document";
import { useClientQuotationDecision } from "@/hooks/use-client-quotation-decision";
import { portalMoney } from "./portal-model";
import { portalDocumentPlaceholder } from "./portal-documents";
import { PortalDatum, PortalState, PortalStatus } from "./portal-ui";
export function PortalQuotationDecision({ id }: { id: string }) {
  const vm = usePortalDocument("quotations", id), query = useSearchParams();
  const desired = query.get("decision"), selected = desired === "accepted" || desired === "rejected" ? desired : null;
  const action = useClientQuotationDecision(vm.record, selected, vm.detailHref), row = vm.record.value;
  const placeholder = portalDocumentPlaceholder(vm);
  if (!action.operation && (placeholder || !row)) return placeholder;
  if (!selected && !action.operation) return <PortalState title="Choose a decision from the quotation" backHref={vm.backHref}>Open the read-only quotation, then choose Review acceptance or Review rejection.</PortalState>;
  const frozen = action.operation;
  return <main className="cp-page"><div className="cp-container cp-decision-workspace">
    <button type="button" className="cp-back" disabled={action.busy} onClick={action.cancel}>← Back to quotation</button>
    <header className="cp-action-heading"><p className="cp-kicker">Quotation decision · separate review</p><h1>{(frozen?.target || selected) === "rejected" ? "Review rejection" : "Review acceptance"}</h1><p>Read the document before confirming. This changes the shared quotation&apos;s status, not an order, invoice or payment.</p></header>
    <section className="cp-panel"><h2>{frozen?.number || row?.quotation_number}</h2><dl className="cp-facts"><PortalDatum label="Client">{frozen?.client || row?.client_name}</PortalDatum><PortalDatum label="Document amount" emphasis>{frozen?.amount || (row ? portalMoney(row.total, row.currency) : "—")}</PortalDatum><PortalDatum label={frozen ? "Status when submitted" : "Current status"}><PortalStatus status={frozen?.previous || row?.status || "unknown"} /></PortalDatum><PortalDatum label="Decision">{frozen?.target || selected}</PortalDatum></dl><p className="cp-muted">Only the latest sent revision can receive a decision. Check the document, client and amount before continuing.</p></section>
    {action.error ? <div className="cp-error" role="alert">{action.error}</div> : null}{action.notice ? <div className="cp-notice" role="status">{action.notice}</div> : null}
    {action.locked ? <section className="cp-outcome" role="status"><h2>{action.busy ? "Decision in progress" : action.phase === "unknown" ? "Outcome needs verification" : "Decision workspace locked against repeat submission"}</h2><p>{action.busy ? "Keep this page open. Intentional exits are blocked while the request is pending." : "No repeat or opposite decision is offered here. Leaving or reloading loses this in-memory request context."}</p>{action.result ? <p>Verified returned status: <PortalStatus status={action.result.status} /></p> : null}{action.phase === "unknown" ? <button type="button" className="cp-button" disabled={vm.record.loading} onClick={() => void action.verify()}>Read current saved status</button> : null}{!action.busy ? <button type="button" className="cp-button" onClick={action.cancel}>Return to quotation</button> : null}</section> : row?.status === "sent" ? <section className="cp-action-footer"><p>This decision is not editable afterward in the client portal. Acceptance does not create an order.</p><div><button type="button" className="cp-button" onClick={action.cancel}>Cancel review</button><button type="button" className={`cp-button ${selected === "rejected" ? "cp-danger" : "cp-primary"}`} onClick={action.arm}>Review final confirmation</button></div></section> : <div className="cp-notice"><p>This quotation is not currently sent; a new decision cannot be submitted.</p><button type="button" className="cp-button" onClick={action.cancel}>Return to quotation</button></div>}
    <PortalDecisionConfirmation open={Boolean(action.review)} loading={action.busy} eyebrow="Confirm client decision" title={action.review?.target === "rejected" ? "Reject this quotation?" : "Accept this quotation?"} description="Confirm the exact shared document and decision below." details={action.review ? [{ label: "Quotation", value: action.review.number }, { label: "Client", value: action.review.client }, { label: "Amount", value: action.review.amount, emphasis: true }, { label: "Current status", value: action.review.previous }, { label: "Decision", value: action.review.target }] : []} warning="This is a terminal client decision. The server still verifies the latest sent revision; acceptance does not create an order. Do not repeat the request if its outcome is uncertain." confirmLabel={action.review?.target === "rejected" ? "Confirm rejection" : "Confirm acceptance"} busyLabel="Recording decision…" onCancel={action.close} onConfirm={action.confirm} />
  </div></main>;
}

/** A disabled second pointer press can blur focus to BODY without focusin.
 * Keep this pending dialog local; reuse the shared keyboard/return-focus logic. */
export function PortalDecisionConfirmation(props: ComponentProps<typeof MoneyOutConfirmation>) {
  const root = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!props.open || !props.loading) return;
    const host = root.current;
    if (!host) return;
    const dialog = host.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const focusReview = () => {
      const review = dialog.querySelector<HTMLElement>("[data-financial-confirmation-content]");
      if (review?.isConnected) review.focus({ preventScroll: true });
    };
    const retainPointerFocus = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const disabled = event.target.closest("button:disabled");
      if (!disabled || !dialog.contains(disabled)) return;
      event.preventDefault();
      focusReview();
    };
    const containPendingFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusReview();
    };
    document.addEventListener("pointerdown", retainPointerFocus, true);
    document.addEventListener("mousedown", retainPointerFocus, true);
    document.addEventListener("focusin", containPendingFocus, true);
    return () => {
      document.removeEventListener("pointerdown", retainPointerFocus, true);
      document.removeEventListener("mousedown", retainPointerFocus, true);
      document.removeEventListener("focusin", containPendingFocus, true);
    };
  }, [props.open, props.loading]);
  return <div ref={root}><MoneyOutConfirmation {...props} /></div>;
}
