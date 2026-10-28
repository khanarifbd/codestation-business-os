"use client";
import { useLayoutEffect, useRef } from "react";
import type { HRTimeAction } from "@/hooks/use-hr-time-action";
/** Local review boundary; source forms stay mounted while this dialog is open. */
export function HRTimeConfirmation({ action }: {
  action: HRTimeAction;
}) {
  const dialog = useRef<HTMLDivElement>(null), region = useRef<HTMLDivElement>(null), busy = useRef(action.busy), close = useRef(action.closeReview);
  useLayoutEffect(() => { busy.current = action.busy; close.current = action.closeReview; }, [action.busy, action.closeReview]);
  useLayoutEffect(() => {
    const node = dialog.current;
    if (!node)
      return;
    const focusables = () => Array.from(node.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')).filter(x => !x.hidden);
    const focus = () => region.current?.isConnected && region.current.focus();
    focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (!busy.current)
          close.current();
      }
      if (e.key !== "Tab")
        return;
      const items = focusables(), first = items[0], last = items[items.length - 1];
      if (!first) {
        e.preventDefault();
        focus();
        return;
      }
      if (e.shiftKey && (document.activeElement === first || !node.contains(document.activeElement))) {
        e.preventDefault();
        last.focus();
      }
      else if (!e.shiftKey && (document.activeElement === last || !node.contains(document.activeElement))) {
        e.preventDefault();
        first.focus();
      }
    };
    const focusin = (e: FocusEvent) => {
      if (!(e.target instanceof Node) || !node.contains(e.target))
        focus();
    };
    const pointer = (e: Event) => {
      if (busy.current) {
        e.preventDefault();
        focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("focusin", focusin, true);
    node.addEventListener("pointerdown", pointer, true);
    node.addEventListener("mousedown", pointer, true);
    return () => { document.removeEventListener("keydown", keydown, true); document.removeEventListener("focusin", focusin, true); node.removeEventListener("pointerdown", pointer, true); node.removeEventListener("mousedown", pointer, true); };
  }, []);
  useLayoutEffect(() => {
    if (action.busy)
      region.current?.focus();
  }, [action.busy]);
  if (!action.review)
    return null;
  return <div className="ht-modal-backdrop">
    <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="ht-review-title" className="ht-confirmation">
      <div ref={region} tabIndex={0} aria-label="Leave decision review details">
        <p className="ht-kicker">Confirm once</p>
        <h2 id="ht-review-title">{action.review.title}</h2>
        <p>This changes the leave request’s status from <strong>{String(action.review.intent.body.expected_status)}</strong> to <strong>{String(action.review.intent.body.status)}</strong>.</p>
        <p>The request will use the exact record and decision shown here. An interrupted response may still have completed; it will not be resent automatically.</p>{action.busy ? <p role="status">Submitting the decision… Keep this document open.</p> : null}</div>
      <footer className="ht-editor-footer">
        <button type="button" className="relationship-secondary" disabled={action.busy} onClick={action.closeReview}>Go back</button>
        <button type="button" className="relationship-primary" disabled={action.busy} onClick={() => void action.confirm()}>Confirm decision</button>
      </footer>
    </div>
  </div>;
}
