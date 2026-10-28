/** Shared preflight for imperative workspace/account exits, before any mutation begins. */
export const WORKSPACE_EXIT_EVENT = "business-os:before-workspace-exit";

/** False means an active editor canceled the exit or is still saving. No state is cleared. */
export function requestWorkspaceExit(): boolean {
  if (typeof window === "undefined") return true;
  return window.dispatchEvent(new Event(WORKSPACE_EXIT_EVENT, { cancelable: true }));
}
