"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

// Scoped to mounted CRM dialogs; no global keyboard handler or application-wide focus changes.
const mountedDialogs: HTMLElement[] = [];

function available(element: HTMLElement) {
  return element.isConnected && element.getClientRects().length > 0
    && !element.closest('[hidden], [inert]')
    && !element.matches(':disabled, [aria-disabled="true"]')
    && getComputedStyle(element).visibility !== "hidden";
}

function topDialog() {
  // A nested panel wins even when React runs child layout effects before its parent.
  const panels = mountedDialogs.filter(panel => panel.isConnected);
  return panels.filter(panel => !panels.some(other => other !== panel && panel.contains(other))).at(-1);
}

export function crmDialogFocusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]'))
    .filter(element => element.tabIndex >= 0 && available(element));
}

function focusInside(dialog: HTMLElement, initial = false) {
  const preferred = initial ? dialog.querySelector<HTMLElement>('[data-crm-dialog-initial]') : null;
  const target = preferred && available(preferred) ? preferred : crmDialogFocusable(dialog)[0] || dialog;
  target.focus({ preventScroll: true });
}

export function crmDialogKeyDown(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement, busy: boolean, onClose: () => void) {
  if (event.defaultPrevented || topDialog() !== dialog) return;
  if (event.key === "Escape") {
    // SearchableSelect closes its expanded listbox first, in its existing document listener.
    if (dialog.querySelector('[aria-expanded="true"][aria-haspopup="listbox"]')) return;
    event.preventDefault();
    if (!busy) onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = crmDialogFocusable(dialog), first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
    event.preventDefault(); first.focus();
  }
}

export function CrmDialog({ label, labelledBy, busy = false, onClose, className, panelClassName, closeOnBackdrop = true, restoreFocus = true, children }: {
  label: string;
  labelledBy?: string;
  busy?: boolean;
  onClose: () => void;
  className: string;
  panelClassName: string;
  closeOnBackdrop?: boolean;
  restoreFocus?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dialog = panel.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    mountedDialogs.push(dialog);
    if (topDialog() === dialog) focusInside(dialog, true);
    let redirecting = false;
    const containFocus = (event: FocusEvent) => {
      if (topDialog() !== dialog || redirecting || (event.target instanceof HTMLElement && dialog.contains(event.target) && available(event.target))) return;
      redirecting = true;
      focusInside(dialog);
      redirecting = false;
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      const wasTop = topDialog() === dialog;
      const index = mountedDialogs.indexOf(dialog);
      if (index >= 0) mountedDialogs.splice(index, 1);
      document.removeEventListener("focusin", containFocus);
      const next = topDialog();
      if (!wasTop || !restoreFocus) return;
      if (previous && available(previous) && (previous.tabIndex >= 0 || previous.hasAttribute("tabindex")) && (!next || next.contains(previous))) previous.focus({ preventScroll: true });
      else if (next) focusInside(next);
    };
  }, [restoreFocus]);

  // Repair focus only when the active target disappeared or became disabled; never reset ordinary typing.
  useLayoutEffect(() => {
    const dialog = panel.current, active = document.activeElement;
    if (dialog && topDialog() === dialog && (!(active instanceof HTMLElement) || !dialog.contains(active) || !available(active))) focusInside(dialog);
  });

  return <div className={className} onMouseDown={event => {
    if (event.target === event.currentTarget && panel.current === topDialog() && closeOnBackdrop && !busy) onClose();
  }}><div ref={panel} role="dialog" aria-modal="true" aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy} aria-busy={busy} tabIndex={-1} className={panelClassName} onKeyDown={event => crmDialogKeyDown(event, event.currentTarget, busy, onClose)}>{children}</div></div>;
}
