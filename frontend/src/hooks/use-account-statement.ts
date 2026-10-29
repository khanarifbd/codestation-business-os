"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { accountLedgerApi } from "@/lib/account-navigation";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { statementAccountHref, statementBrowse, type StatementBrowse } from "@/lib/statement-navigation";
import { isStatementAccounts, isStatementLedger, type StatementLedger } from "@/components/accounting-statements/statement-model";
export function useAccountStatement() {
  const { tenant } = useDashboardSession(), { canView } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams();
  const raw = query.toString(), browse = useMemo(() => statementBrowse(raw), [raw]), accounts = useAdvancedResource("/api/finance/accounts", canView, isStatementAccounts);
  const selected = accounts.value?.find(row => row.id === browse.account) ?? null;
  const selectedId = selected?.id, selectedCurrency = selected?.currency;
  const scope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions]);
  const identity = JSON.stringify([scope, browse]), latest = useRef(identity), alive = useRef(true), moving = useRef(false);
  useLayoutEffect(() => { latest.current = identity; }, [identity]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const validLedger = useCallback((value: unknown): value is StatementLedger => isStatementLedger(value) && Boolean(selectedId)
    && value.items.length <= 50 && value.next_cursor !== (browse.cursor || undefined)
    && value.items.every(row => row.currency === selectedCurrency && (browse.direction === "all" || row.direction === browse.direction)
      && (!browse.date_from || row.transaction_date >= browse.date_from) && (!browse.date_to || row.transaction_date <= browse.date_to)
      && (!browse.source_type || row.source_type === browse.source_type)), [selectedId, selectedCurrency, browse.cursor, browse.direction, browse.date_from, browse.date_to, browse.source_type]);
  const ledger = useAdvancedResource(accountLedgerApi(browse.account, browse), canView && !browse.invalid && Boolean(selected), validLedger);
  const historyScope = "statements:" + accountCursorHistoryScope(scope, tenant?.membership_id || "", browse.account, browse);
  const historyPosition = JSON.stringify([historyScope, browse.cursor, browse.page]);
  const [previous, setPrevious] = useState<{ key: string; cursor: string | undefined } | null>(null);
  useEffect(() => {
    if (!canView || browse.invalid || browse.account || !accounts.value?.length) return;
    const first = accounts.value.find(row => row.is_active) ?? accounts.value[0];
    router.replace(statementAccountHref({ ...browse, account: first.id, cursor: "", page: 1 }), { scroll: false });
  }, [canView, browse, accounts.value, router]);
  useEffect(() => {
    if (!canView || !selected || browse.invalid) return;
    let active = true;
    void readPreviousAccountCursor(historyScope, browse).then(cursor => { if (active) setPrevious({ key: historyPosition, cursor }); });
    return () => { active = false; };
  }, [canView, selected, browse, historyScope, historyPosition]);
  function apply(patch: Partial<StatementBrowse>) {
    const next = statementBrowse(new URLSearchParams(statementAccountHref({ ...browse, ...patch, cursor: "", page: 1 }).split("?")[1] || ""));
    if (next.invalid) return false;
    router.push(statementAccountHref(next), { scroll: false });
    return true;
  }
  async function nextPage() {
    if (!ledger.value?.next_cursor || ledger.loading || moving.current) return;
    moving.current = true;
    const captured = identity, cursor = ledger.value.next_cursor;
    try {
      await rememberAccountCursorStep(historyScope, browse, cursor);
      if (alive.current && latest.current === captured) router.push(statementAccountHref({ ...browse, cursor, page: browse.page + 1 }), { scroll: false });
    } finally { moving.current = false; }
  }
  const hasPrevious = browse.page > 1 && previous?.key === historyPosition && previous.cursor !== undefined;
  function previousPage() {
    if (hasPrevious && !ledger.loading) router.push(statementAccountHref({ ...browse, cursor: previous!.cursor!, page: browse.page - 1 }), { scroll: false });
  }
  async function refresh() {
    const captured = identity;
    const result = await accounts.refresh();
    if (alive.current && latest.current === captured && result.current && result.value) await ledger.refresh();
  }

  return { canView, browse, accounts, selected, ledger, apply, nextPage, previousPage, hasPrevious, refresh,
    firstPage: () => router.push(statementAccountHref({ ...browse, cursor: "", page: 1 }), { scroll: false }) };
}
