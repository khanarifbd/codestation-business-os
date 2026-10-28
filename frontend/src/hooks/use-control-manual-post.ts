"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useControlDocument } from "@/hooks/use-control-document";
import { useAdvancedResource } from "@/hooks/use-advanced-resource";
import { useRecurringExpensePost } from "@/hooks/use-recurring-expense-post";
import { isControlAccounts, isControlMeta, isRecurring, postingAccountContext, profitabilityContext } from "@/components/finance-controls/control-model";
import { manualPostFormError } from "@/components/finance-controls/manual-post-form";
import type { RecurringPostPayload } from "@/components/finance-controls/recurring-post-operation";
/** Presentation adapter only: the v24 keyed operation owns all POST/replay/ACK state. */
export function useControlManualPost(id: string, returnTo: string | null, scope: string) {
  const vm = useControlDocument("recurring", id, returnTo), source = isRecurring(vm.record) ? vm.record : null;
  const posting = useRecurringExpensePost(scope, vm.canView && vm.canManage);
  const meta = useAdvancedResource("/api/finance/expense-meta", vm.canView, isControlMeta),
    accounts = useAdvancedResource("/api/finance/accounts", vm.canView, isControlAccounts);
  const seeded = useRef(false),
    reviewed = useRef(source),
    latest = useRef(source),
    [formError, setFormError] = useState<string | null>(null),
    [reviewCurrency, setReviewCurrency] = useState<string | null>(null),
    [readbackError, setReadbackError] = useState<string | null>(null);
  useLayoutEffect(() => { latest.current = source; }, [source]);
  useEffect(() => {
    if (!source || !source.is_active || seeded.current || !vm.canManage)
      return;
    let active = true;
    queueMicrotask(() => {
      if (active && latest.current === source && !seeded.current && posting.open(source))
        seeded.current = true;
    });
    return () => { active = false; };
  }, [source, vm.canManage, posting]);
  const account = source ? postingAccountContext(source, accounts.value) : null,
    profitability = source ? profitabilityContext(source, meta.value) : null;
  const ready = Boolean(source?.is_active && account?.supported && !profitability?.warning && meta.value && accounts.value);
  const context = useRef({ ready, meta: meta.value, accounts: accounts.value, phase: posting.phase }),
    reviewedContext = useRef({ meta: meta.value, accounts: accounts.value });
  useLayoutEffect(() => { context.current = { ready, meta: meta.value, accounts: accounts.value, phase: posting.phase }; }, [ready, meta.value, accounts.value, posting.phase]);
  function review(payload: RecurringPostPayload) {
    if (!ready || !source || latest.current !== source || posting.locked)
      return false;
    const error = manualPostFormError(payload, source, profitability?.currency || null);
    setFormError(error);
    if (error)
      return false;
    reviewed.current = source;
    reviewedContext.current = { meta: meta.value, accounts: accounts.value };
    const accepted = posting.review(payload);
    if (accepted)
      setReviewCurrency(profitability?.currency || null);
    return accepted;
  }
  async function confirm() {
    if (context.current.phase === "idle"
      && (!context.current.ready || latest.current !== reviewed.current || context.current.meta !== reviewedContext.current.meta
        || context.current.accounts !== reviewedContext.current.accounts)) {
      posting.cancelReview();
      setFormError("Posting context changed after review. Reload and review the current schedule.");
      return;
    }
    const acknowledged = await posting.post();
    if (!acknowledged)
      return;
    const fresh = await vm.refresh();
    if (fresh?.current && !fresh.value)
      setReadbackError("Posting was acknowledged, but the schedule refresh is unavailable. Do not post again. Return to the register and explicitly reload current schedules.");
  }
  function cancel() {
    if (posting.close())
      window.location.assign(vm.backHref);
  }
  return {
    ...vm,
    source,
    posting,
    meta,
    accounts,
    ready,
    account,
    profitability,
    readbackError,
    formError,
    reviewCurrency,
    review,
    confirm,
    cancel
  };
}
