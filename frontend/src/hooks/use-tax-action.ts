"use client";
import { useAdvancedAction } from "./use-advanced-action";
import type { AdvancedCommand } from "./use-advanced-action";
/** Tax configuration and settlement writes retain the shared unkeyed outcome guard. */
export function useTaxAction(canManage: boolean, dirty: boolean, returnHref: string) {
  const action = useAdvancedAction(canManage, dirty, returnHref);
  function arm(next: AdvancedCommand) {
    const confirmation = { ...next.confirmation, details: next.confirmation.details.map(detail => ({ ...detail })) };
    return action.arm({ ...next, confirmation });
  }
  return { ...action, arm };
}
export type TaxAction = ReturnType<typeof useTaxAction>;
