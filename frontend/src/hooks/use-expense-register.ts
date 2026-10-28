"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { expenseBrowse, expenseCreateHref, expenseDocumentHref, expenseSetupCreateHref, expensesListHref, expensesReadApi, type ExpenseBrowse } from "@/lib/expense-navigation";
import { isExpenseMeta, isExpensePage, isExpenseSummary, isProfitability } from "@/components/expenses/expense-read-model";
import { useExpenseResource } from "./use-expense-resource";
import { requestWorkspaceExit } from "@/lib/workspace-navigation";

export function useExpenseRegister() {
  const { tenant } = useDashboardSession(), router = useRouter(), query = useSearchParams();
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view"));
  const canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const raw = query.toString(), browse = useMemo(() => expenseBrowse(raw), [raw]);
  const listHref = expensesListHref(browse), pageUrl = expensesReadApi(browse);
  const page = useExpenseResource(pageUrl, canView && browse.tab === "expenses", isExpensePage);
  const summary = useExpenseResource("/api/finance/expense-summary", canView && browse.tab === "expenses", isExpenseSummary);
  const meta = useExpenseResource("/api/finance/expense-meta-lite", canView && browse.tab !== "profitability", isExpenseMeta);
  const profitability = useExpenseResource("/api/finance/profitability", canView && browse.tab === "profitability", isProfitability);
  const current = { search: browse.search, direction: "all" as const, source_type: `${browse.status}|${browse.category}`, date_from: "", date_to: "", size: 50, cursor: browse.cursor, page: browse.page };
  const scope = accountCursorHistoryScope(tenant?.organization.id || "", tenant?.membership_id || "", "expenses", current);
  const position = JSON.stringify([scope, browse.page, browse.cursor]);
  const [previous, setPrevious] = useState<{ key: string; cursor: string | undefined } | null>(null);
  const [paging, setPaging] = useState<{ key: string; busy: boolean }>({ key: "", busy: false });
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const mounted = useRef(true), navEpoch = useRef(0), navBusy = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; navEpoch.current += 1; }; }, []);
  useEffect(() => { navEpoch.current += 1; navBusy.current = false; }, [position]);
  useEffect(() => {
    let active = true;
    const current = { search: browse.search, direction: "all" as const, source_type: `${browse.status}|${browse.category}`, date_from: "", date_to: "", size: 50, cursor: browse.cursor, page: browse.page };
    void readPreviousAccountCursor(scope, current).then(cursor => { if (active) setPrevious({ key: position, cursor }); });
    return () => { active = false; };
  }, [scope, position, browse.search, browse.status, browse.category, browse.cursor, browse.page]);
  useEffect(() => {
    if (!page.value || !browse.focus) return;
    const id = window.setTimeout(() => document.getElementById(`expense-row-${browse.focus}`)?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(id);
  }, [page.value, browse.focus]);
  const change = useCallback((changes: Partial<ExpenseBrowse>) => {
    if (!requestWorkspaceExit()) return;
    navEpoch.current += 1; navBusy.current = false;
    setNavigationError(null);
    router.replace(expensesListHref({ ...browse, ...changes, cursor: "", page: 1, focus: "" }), { scroll: false });
  }, [browse, router]);
  async function refreshCurrent() {
    // Refreshing setup clears the row components. Give a pending or uncertain
    // status operation the same preflight protection as leaving the view.
    if (!requestWorkspaceExit()) return;
    if (browse.tab === "profitability") await profitability.refresh();
    else await Promise.all([meta.refresh(), ...(browse.tab === "expenses" ? [page.refresh(), summary.refresh()] : [])]);
  }
  async function nextPage() {
    const cursor = page.value?.next_cursor;
    if (!cursor || page.loading || navBusy.current) return;
    const identity = ++navEpoch.current; navBusy.current = true; setPaging({ key: position, busy: true }); setNavigationError(null);
    try {
      await rememberAccountCursorStep(scope, current, cursor);
      if (!mounted.current || identity !== navEpoch.current) return;
      router.push(expensesListHref({ ...browse, cursor, page: browse.page + 1, focus: "" }), { scroll: false });
    } catch {
      if (mounted.current && identity === navEpoch.current) { navBusy.current = false; setPaging({ key: position, busy: false }); setNavigationError("The next page could not be opened. Your current register remains available."); }
    }
  }
  function previousPage() {
    if (page.loading || previous?.key !== position || previous.cursor === undefined) return;
    navEpoch.current += 1; navBusy.current = false;
    router.push(expensesListHref({ ...browse, cursor: previous.cursor, page: browse.page - 1, focus: "" }), { scroll: false });
  }
  return { canView, canManage, browse, listHref, page, summary, meta, profitability, change, refreshCurrent, nextPage, previousPage, navigationError,
    paging: paging.key === position && paging.busy,
    historyLoading: browse.page > 1 && previous?.key !== position,
    hasPrevious: previous?.key === position && previous.cursor !== undefined,
    createHref: expenseCreateHref(listHref),
    setupCreateHref: (kind: "vendors" | "categories") => expenseSetupCreateHref(kind, listHref),
    detailHref: (id: string) => expenseDocumentHref(id, expensesListHref({ ...browse, focus: id })),
  };
}
export type ExpenseRegisterState = ReturnType<typeof useExpenseRegister>;
