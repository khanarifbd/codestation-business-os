"use client";

import { useCallback, useEffect, useRef } from "react";
import { WORKSPACE_EXIT_EVENT, requestWorkspaceExit } from "@/lib/workspace-navigation";

export type QuotationNavigateOptions = {
  replace?: boolean;
  /** The caller has already confirmed discarding, or has persisted the draft. */
  discard?: boolean;
};

export type QuotationNavigationGuardOptions = {
  /** Prevent explicit exits while a write is pending; native unload still warns. */
  isBusy?: boolean;
  /** Optional same-event write latch for embedded panels, before React commits busy state. */
  pendingRef?: { readonly current: boolean };
  /** Optional truthful exit warning for a retained operation with an uncertain write outcome. */
  discardMessage?: string;
  /** Disable listeners on a shared read-only/list controller. Defaults preserve existing editors. */
  enabled?: boolean;
  documentLabel?: "quotation" | "order" | "inventory" | "project" | "work update" | "people" | "HR request" | "self review" | "financial account" | "transfer" | "payroll" | "money receipt" | "expense" | "credit application" | "payable" | "reconciliation" | "accounting entry" | "loan operation";
};

type AnchorIntent = {
  href: string | null;
  target?: string | null;
  download?: boolean;
  button?: number;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  defaultPrevented?: boolean;
};

/** Pure link classification. Hash changes and new documents in other tabs keep native behavior. */
export function quotationAnchorDestination(intent: AnchorIntent, currentHref: string): string | null {
  const href = intent.href?.trim();
  if (!href || href.startsWith("#") || intent.download || intent.defaultPrevented
    || (intent.button ?? 0) !== 0 || intent.altKey || intent.ctrlKey || intent.metaKey || intent.shiftKey
    || (intent.target && intent.target.toLowerCase() !== "_self")) return null;
  try {
    const current = new URL(currentHref);
    const destination = new URL(href, current);
    if (!["http:", "https:"].includes(destination.protocol)) return null;
    if (destination.origin === current.origin && destination.pathname === current.pathname
      && destination.search === current.search && (destination.hash || href.includes("#"))) return null;
    return destination.href;
  } catch {
    return null;
  }
}

const DISCARD_MESSAGE = "You have unsaved quotation changes. Discard them and leave this page?";

/**
 * Scope this hook to one quotation, order or inventory create/edit document.
 *
 * Entry MUST use a native anchor/full-document navigation, not router.push or Next Link.
 * Ordinary anchor exits also become document navigations, including when clean, so a
 * later browser Back/Forward crosses a document boundary instead of bypassing this guard.
 * No history or router APIs are patched. In-document hash history is deliberately untouched.
 * Native beforeunload dialogs are browser-controlled and are not a mobile recovery system.
 */
export function useQuotationNavigationGuard(
  hasChanges: boolean,
  { isBusy = false, pendingRef, enabled = true, documentLabel = "quotation", discardMessage }: QuotationNavigationGuardOptions = {},
) {
  const dirtyRef = useRef(hasChanges);
  const busyRef = useRef(isBusy);
  const confirmedExitRef = useRef(false);

  useEffect(() => {
    dirtyRef.current = hasChanges;
    busyRef.current = isBusy;
  }, [hasChanges, isBusy]);

  const confirmLeave = useCallback(() => {
    if (pendingRef?.current || busyRef.current) return false;
    return !dirtyRef.current || window.confirm(discardMessage || (documentLabel === "quotation" ? DISCARD_MESSAGE : `You have unsaved ${documentLabel} changes. Discard them and leave this page?`));
  }, [documentLabel, discardMessage, pendingRef]);

  const markClean = useCallback(() => {
    // Call only after an authoritative save/discard, never when a request starts.
    // The owner must also update its saved baseline / pending state before further editing.
    dirtyRef.current = false;
    busyRef.current = false;
  }, []);

  const navigate = useCallback((href: string, options: QuotationNavigateOptions = {}) => {
    if (pendingRef?.current || busyRef.current) return false;
    let destination: URL;
    try {
      destination = new URL(href, window.location.href);
      if (!["http:", "https:"].includes(destination.protocol)) return false;
    } catch {
      return false;
    }
    const current = new URL(window.location.href);
    const isHashOnly = destination.origin === current.origin && destination.pathname === current.pathname
      && destination.search === current.search && href.includes("#");
    if (isHashOnly) {
      // Hash transitions do not unload the document and must not consume leave consent.
      if (options.replace) window.location.replace(destination.href);
      else window.location.assign(destination.href);
      return true;
    }
    if (!options.discard && !confirmLeave()) return false;
    // Suppress only the next unload after this explicit consent, not all future unloads.
    confirmedExitRef.current = true;
    try {
      if (options.replace) window.location.replace(destination.href);
      else window.location.assign(destination.href);
      return true;
    } catch {
      confirmedExitRef.current = false;
      return false;
    }
  }, [confirmLeave, pendingRef]);

  useEffect(() => {
    if (!enabled) return;
    const resetConfirmedExit = () => { confirmedExitRef.current = false; };
    const beforeWorkspaceExit = (event: Event) => {
      if (event.defaultPrevented) return;
      if (!confirmLeave()) event.preventDefault();
      // Consent is only a preflight. A failed switch/logout must leave the draft protected.
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (confirmedExitRef.current) {
        confirmedExitRef.current = false;
        return;
      }
      if (!dirtyRef.current && !busyRef.current && !pendingRef?.current) return;
      event.preventDefault();
      // Retained for older browsers; the browser supplies its own generic warning text.
      event.returnValue = "";
    };
    const captureAnchor = (event: MouseEvent) => {
      const target = event.target;
      const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor) return;
      const destination = quotationAnchorDestination({
        href: anchor.getAttribute("href"),
        target: anchor.getAttribute("target"),
        download: anchor.hasAttribute("download"),
        button: event.button,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        shiftKey: event.shiftKey,
        defaultPrevented: event.defaultPrevented,
      }, window.location.href);
      if (!destination) return;
      // Capture precedes React / Next Link handlers. Cancel never reaches their router.
      event.preventDefault();
      event.stopImmediatePropagation();
      confirmedExitRef.current = false;
      // Several independent panels can be active (for example a note plus sharing).
      // Ask every registered owner once before consenting to a full-document exit.
      if (requestWorkspaceExit()) navigate(destination, { discard: true });
    };

    window.addEventListener("click", captureAnchor, true);
    window.addEventListener(WORKSPACE_EXIT_EVENT, beforeWorkspaceExit);
    // A restored document or a new interaction must never inherit an earlier leave consent.
    window.addEventListener("pageshow", resetConfirmedExit);
    window.addEventListener("pointerdown", resetConfirmedExit, true);
    window.addEventListener("keydown", resetConfirmedExit, true);
    if (hasChanges || isBusy) window.addEventListener("beforeunload", beforeUnload);
    return () => {
      window.removeEventListener("click", captureAnchor, true);
      window.removeEventListener(WORKSPACE_EXIT_EVENT, beforeWorkspaceExit);
      window.removeEventListener("pageshow", resetConfirmedExit);
      window.removeEventListener("pointerdown", resetConfirmedExit, true);
      window.removeEventListener("keydown", resetConfirmedExit, true);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [hasChanges, isBusy, pendingRef, enabled, navigate, confirmLeave]);

  return { confirmLeave, navigate, markClean };
}
