"use client";

import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";

type FocusOptions = {
  busy: boolean;
  onClose: () => void;
  restoreFocus?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

function visibleEnabled(element: HTMLElement) {
  return element.isConnected && element.getClientRects().length > 0 &&
    !element.closest('[hidden], [inert]') && !element.matches(':disabled, [aria-disabled="true"]') &&
    getComputedStyle(element).visibility !== "hidden";
}

export function projectDialogFocusable(dialog: HTMLElement) {
  return Array.from(dialog.querySelectorAll<HTMLElement>('button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]'))
    .filter(element => element.tabIndex >= 0 && visibleEnabled(element));
}

function focusInside(dialog: HTMLElement, initial = false) {
  const preferred = initial ? dialog.querySelector<HTMLElement>('[data-project-dialog-initial]') : null;
  const target = preferred && visibleEnabled(preferred) ? preferred : projectDialogFocusable(dialog)[0] || dialog;
  target.focus({ preventScroll: true });
}

export function projectDialogKeyDown(event: KeyboardEvent<HTMLElement>, dialog: HTMLElement, busy: boolean, onClose: () => void) {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    // The inner selector receives Escape first; its expanded listbox owns this key.
    if (dialog.querySelector('[aria-expanded="true"][aria-haspopup="listbox"]')) return;
    event.preventDefault();
    if (!busy) onClose();
    return;
  }
  if (event.key !== "Tab") return;
  const controls = projectDialogFocusable(dialog), first = controls[0], last = controls[controls.length - 1];
  if (!first) { event.preventDefault(); dialog.focus({ preventScroll: true }); return; }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === dialog || !dialog.contains(active))) {
    event.preventDefault(); last.focus();
  } else if (!event.shiftKey && (active === last || active === dialog || !dialog.contains(active))) {
    event.preventDefault(); first.focus();
  }
}

function useProjectDialogFocus(container: RefObject<HTMLDivElement | null>, existingDialog: boolean, restoreFocus: boolean, returnFocusRef?: RefObject<HTMLElement | null>) {
  const target = () => existingDialog ? container.current?.querySelector<HTMLElement>('[role="dialog"]') : container.current;
  useLayoutEffect(() => {
    const dialog = existingDialog ? container.current?.querySelector<HTMLElement>('[role="dialog"]') : container.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const fallback = returnFocusRef?.current;
    const priorTabIndex = dialog.getAttribute("tabindex");
    if (priorTabIndex === null) dialog.setAttribute("tabindex", "-1");
    focusInside(dialog, true);
    let redirecting = false;
    const containFocus = (event: FocusEvent) => {
      if (redirecting || event.target instanceof HTMLElement && dialog.contains(event.target) && visibleEnabled(event.target)) return;
      redirecting = true;
      focusInside(dialog);
      redirecting = false;
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (priorTabIndex === null) dialog.removeAttribute("tabindex");
      if (!restoreFocus) return; // Sharing exits through a new document, not this DOM opener.
      const usableReturn = (node: HTMLElement | null | undefined) => node && visibleEnabled(node) && (node.tabIndex >= 0 || node.hasAttribute("tabindex"));

      if (usableReturn(previous)) previous?.focus({ preventScroll: true });
      else if (usableReturn(fallback)) fallback?.focus({ preventScroll: true });
    };
  }, [container, existingDialog, restoreFocus, returnFocusRef]);
  // After every commit, retain a valid inner target; only repair lost/disabled focus.
  // This does not repeatedly refocus an enabled input or the shared review region.
  useLayoutEffect(() => {
    const dialog = target(), active = document.activeElement;
    if (dialog && (!(active instanceof HTMLElement) || !dialog.contains(active) || !visibleEnabled(active))) focusInside(dialog);
  });
}

export function ProjectDialog({ label, busy, onClose, restoreFocus = true, returnFocusRef, className, children }: FocusOptions & { label: string; className: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useProjectDialogFocus(ref, false, restoreFocus, returnFocusRef);
  return <div ref={ref} role="dialog" aria-modal="true" aria-label={label} aria-busy={busy} tabIndex={-1} className={className} onKeyDown={event => projectDialogKeyDown(event, event.currentTarget, busy, onClose)}>{children}</div>;
}

/** Controls the existing financial dialog without adding another dialog role. */
export function ProjectDialogFocus({ busy, onClose, restoreFocus = true, returnFocusRef, children }: FocusOptions & { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useProjectDialogFocus(ref, true, restoreFocus, returnFocusRef);
  return <div ref={ref} data-project-dialog-focus aria-busy={busy} style={{ display: "contents" }} onKeyDown={event => {
    const dialog = event.currentTarget.querySelector<HTMLElement>('[role="dialog"]');
    if (dialog) projectDialogKeyDown(event, dialog, busy, onClose);
  }}>{children}</div>;
}
