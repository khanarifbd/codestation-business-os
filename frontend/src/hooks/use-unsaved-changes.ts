"use client";

import { useEffect } from "react";

export function useUnsavedChanges(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [enabled]);
}

export function confirmDiscardChanges(hasChanges: boolean, message = "You have unsaved changes. Discard them?") {
  return !hasChanges || window.confirm(message);
}
