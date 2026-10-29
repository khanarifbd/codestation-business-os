"use client";
import { useRef, useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useAdvancedPermissions, useAdvancedResource } from "@/hooks/use-advanced-resource";
import { useAdvancedAction } from "@/hooks/use-advanced-action";
import { blankPeriod, blankRecurring, controlMoney, controlToday, isControlAccounts, isControlMeta, periodCreatePayload, periodMatchesCreate, postingAccountContext, recurringCreatePayload, recurringMatchesCreate } from "@/components/finance-controls/control-model";
import type { PeriodForm, RecurringForm } from "@/components/finance-controls/control-types";
import { controlDetailHref, safeControlReturn } from "@/lib/finance-controls-navigation";
export function useControlCreate(kind: "recurring" | "periods", returnTo: string | null) {
  const { tenant } = useDashboardSession(), permissions = useAdvancedPermissions(), backHref = safeControlReturn(returnTo, kind);
  const [form, setForm] = useState(() => blankRecurring(tenant?.organization.currency, controlToday(tenant?.organization.timezone))),
    [period, setPeriod] = useState(blankPeriod),
    [error, setError] = useState<string | null>(null);
  const formRef = useRef(form), periodRef = useRef(period), [initial] = useState(() => JSON.stringify(kind === "recurring" ? form : period));
  const meta = useAdvancedResource("/api/finance/expense-meta", permissions.canView && kind === "recurring", isControlMeta),
    accounts = useAdvancedResource("/api/finance/accounts", permissions.canView && kind === "recurring", isControlAccounts);
  const action = useAdvancedAction(permissions.canView && permissions.canManage, JSON.stringify(kind === "recurring" ? form : period) !== initial, backHref);
  function change<K extends keyof RecurringForm>(key: K, value: RecurringForm[K]) {
    if (!action.canEdit())
      return;
    action.close();
    setError(null);
    formRef.current = { ...formRef.current, [key]: value };
    if (key === "client_id")
      formRef.current.project_id = "";
    if (key === "project_id" && value) {
      const project = meta.value?.projects.find(p => p.id === value);
      if (project)
        formRef.current.client_id = project.client_id;
    }
    setForm(formRef.current);
  }
  function changePeriod<K extends keyof PeriodForm>(key: K, value: PeriodForm[K]) {
    if (!action.canEdit())
      return;
    action.close();
    setError(null);
    periodRef.current = { ...periodRef.current, [key]: value };
    setPeriod(periodRef.current);
  }
  function review() {
    if (!action.canEdit())
      return;
    if (kind === "periods") {
      const parsed = periodCreatePayload(periodRef.current);
      if (!parsed.body) {
        setError(parsed.error);
        return;
      }
      const body = parsed.body;
      action.arm({
        url: "/api/finance-controls/accounting-periods",
        body,
        validate: value => periodMatchesCreate(value, body),
        resultHref: value => periodMatchesCreate(value, body) ? controlDetailHref(kind, value.id, backHref) : null,
        confirmation: {
          title: "Create this accounting period?",
          description: "Creates an open period. Overlap is checked by the server; no period is closed by this action.",
          warning: "Both boundary dates are included. Check the range carefully; this workspace does not edit or delete saved periods.",
          details: [{ label: "Name", value: body.name }, { label: "Inclusive range", value: `${body.start_date} – ${body.end_date}` }],
          confirmLabel: "Create open period"
        }
      });
      return;
    }
    const parsed = recurringCreatePayload(formRef.current, meta.value);
    if (!parsed.body) {
      setError(parsed.error);
      return;
    }
    const body = parsed.body;
    const account = postingAccountContext(body, accounts.value);
    if (!account.account?.is_active) {
      setError("Verify an active payment account before creating this schedule.");
      return;
    }
    action.arm({
      url: "/api/finance-controls/recurring-expenses",
      body,
      validate: value => recurringMatchesCreate(value, body),
      resultHref: value => recurringMatchesCreate(value, body) ? controlDetailHref(kind, value.id, backHref) : null,
      confirmation: {
        title: "Create this recurring schedule?",
        description: "Saves a manual schedule only. This action does not post an expense or enable automatic posting.",
        warning: [parsed.warning, account.warning, "Automatic posting is a separate, explicit configuration. No catch-up or scheduler timing is promised."].filter(Boolean).join(" "),
        details: [
          { label: "Schedule", value: body.name },
          { label: "Expense each occurrence", value: controlMoney(body.expense_amount, body.expense_currency), emphasis: true },
          { label: "Frequency", value: `Every ${body.interval_count} ${body.frequency} interval` },
          { label: "First due", value: body.next_due_date },
          { label: "Paid from", value: `${account.account?.name} · ${account.account?.currency}` }
        ],
        confirmLabel: "Create manual schedule"
      }
    });
  }
  return {
    ...permissions,
    kind,
    backHref,
    form,
    period,
    meta,
    accounts,
    action,
    error,
    change,
    changePeriod,
    review,
    cancel: action.cancel
  };
}
