"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useAdvancedAction } from "./use-advanced-action";
import { useControlDocument } from "./use-control-document";
import { controlToday, controlMoney, isRecurring, isAutomation, isPeriod, periodClosePayload, periodReopenPayload } from "@/components/finance-controls/control-model";
import type { ControlTab } from "@/components/finance-controls/control-types";
export function useControlAction(tab: ControlTab, id: string, mode: string, returnTo: string) {
  const vm = useControlDocument(tab, id, returnTo), { tenant } = useDashboardSession(), source = vm.record;
  const [note, setNote] = useState(""),
    [error, setError] = useState<string | null>(null),
    values = useRef(note),
    current = useRef(source),
    reviewed = useRef(source);
  useLayoutEffect(() => { current.current = source; }, [source]);
  const action = useAdvancedAction(vm.canView && vm.canManage && !vm.invalidId, note !== "", vm.detailHref),
    today = controlToday(tenant?.organization.timezone);
  const allowed = Boolean(source && !vm.resource.loading
    && (tab === "recurring" && mode === "status" && isRecurring(source)
      || tab === "automation" && isAutomation(source)
      && (mode === "configure" && (source.auto_post || source.is_active && source.eligible) || mode === "retry" && source.retryable && source.is_active && source.auto_post)
      || tab === "periods" && isPeriod(source) && (mode === "close" && source.status === "open" && today && source.end_date <= today || mode === "reopen" && source.status === "closed")));
  function change(value: string) {
    if (!action.canEdit())
      return;
    action.close();
    action.clearError();
    values.current = value;
    setNote(value);
    setError(null);
  }
  function review() {
    if (!allowed || !source || current.current !== source || !vm.canView || !vm.canManage)
      return;
    setError(null);
    reviewed.current = source;
    const url = `/api/finance-controls/${tab === "recurring" ? "recurring-expenses" : tab === "automation" ? "recurring-auto-post" : "accounting-periods"}/${encodeURIComponent(id)}`;
    if (tab === "recurring" && isRecurring(source)) {
      const active = !source.is_active;
      action.arm({
        url,
        method: "PATCH",
        body: { is_active: active },
        confirmation: {
          title: `${active ? "Resume" : "Pause"} ${source.name}?`,
          description: active ? "Resume this schedule's availability. No expense is posted by this action." : "Pause this recurring schedule. Existing expenses are not reversed or deleted.",
          warning: "Auto Post may remain configured while paused. Review its separate automation state before resuming.",
          confirmLabel: active ? "Resume schedule" : "Pause schedule",
          details: [
            { label: "Schedule", value: source.name },
            { label: "Next scheduled date", value: source.next_due_date },
            { label: "Change", value: active ? "Paused → Active" : "Active → Paused" }
          ]
        },
        validate: v => isRecurring(v) && v.id === id && v.is_active === active,
        resultHref: () => vm.detailHref
      });
      return;
    }
    if (tab === "automation" && isAutomation(source)) {
      const enabled = !source.auto_post, retry = mode === "retry";
      action.arm({
        url: retry ? url + "/retry" : url,
        method: retry ? "POST" : "PATCH",
        body: retry ? { expected_next_due_date: source.next_due_date } : { enabled },
        confirmation: {
          title: retry ? `Attempt the due occurrence for ${source.name}?` : `${enabled ? "Enable" : "Disable"} Auto Post?`,
          description: retry ? "Attempt one occurrence using the server's current schedule values. This is an immediate accounting action, not a draft." : enabled ? "Enable automatic posting when the configured schedule becomes due and passes server checks." : "Disable future automatic posting. Already recorded expenses remain unchanged.",
          warning: retry ? "The reviewed due date must still match under the server lock. Amount, account and other schedule values are NOT frozen by this date-only condition. No replay key or automatic retry is available; inspect records after an uncertain result." : "Eligibility is a setup check, not guaranteed funds or open-period approval. No scheduler execution or timing is inferred by this screen.",
          confirmLabel: retry ? "Attempt due occurrence" : enabled ? "Enable Auto Post" : "Disable Auto Post",
          details: [
            { label: "Schedule", value: source.name },
            { label: "Reviewed due date", value: source.next_due_date },
            { label: "Last-read configured amount", value: controlMoney(source.expense_amount, source.expense_currency) },
            { label: "Last-read account", value: `${source.account_name} · ${source.account_currency}` }
          ]
        },
        validate: v => isAutomation(v) && v.id === id && (retry || v.auto_post === enabled),
        resultHref: () => vm.detailHref
      });
      return;
    }
    if (tab === "periods" && isPeriod(source)) {
      const close = mode === "close", checked = close ? periodClosePayload(values.current) : periodReopenPayload(values.current);
      if (!checked.body) {
        setError(checked.error);
        return;
      }
      action.arm({
        url: url + `/${mode}`,
        body: checked.body,
        confirmation: {
          title: `${close ? "Close" : "Reopen"} ${source.name}?`,
          description: close ? "Mark this date range closed for the application's posting checks." : "Allow posting in this period again, with an audit reason.",
          warning: "This changes accounting controls, not a cosmetic label. Global close-versus-concurrent-post serialization remains a release verification gate; this screen does not guarantee that race is resolved.",
          confirmLabel: close ? "Close accounting period" : "Reopen accounting period",
          details: [
            { label: "Period", value: source.name },
            { label: "Inclusive dates", value: `${source.start_date} — ${source.end_date}` },
            { label: close ? "Close notes" : "Audit reason", value: values.current.trim() || "No notes" }
          ]
        },
        validate: v => isPeriod(v) && v.id === id && v.status === (close ? "closed" : "open"),
        resultHref: () => vm.detailHref
      });
    }
  }
  return {

    ...vm,
    mode,
    note,
    error,
    action: {

      ...action,
      confirm: () => {
        if (current.current !== reviewed.current || !allowed) {
          action.close();
          setError("The record changed after review. Reload and review the current state.");
          return;
        }
        return action.confirm();
      }

    },
    allowed,
    change,
    review,
    today,
    cancel: action.cancel,
    refresh: () => { action.close(); current.current = null; return vm.refresh(); }

  };
}
export type ControlActionState = ReturnType<typeof useControlAction>;
