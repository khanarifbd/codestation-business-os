"use client";
import { useAdvancedAction } from "./use-advanced-action";
import type { AdvancedCommand } from "./use-advanced-action";
/** Assets post unkeyed accounting entries; reuse the checked write/exit controller unchanged. */
export function useAssetAction(canManage: boolean, dirty: boolean, returnHref: string) {
  const action = useAdvancedAction(canManage, dirty, returnHref);
  function arm(next: AdvancedCommand) {
    // Keep the reviewed consequences independent of mutable caller-owned arrays.
    const confirmation = { ...next.confirmation, details: next.confirmation.details.map(detail => ({ ...detail })) };
    return action.arm({ ...next, confirmation });
  }
  return { ...action, arm };
}
export type AssetAction = ReturnType<typeof useAssetAction>;
