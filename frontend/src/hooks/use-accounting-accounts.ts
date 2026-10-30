"use client";
import { requestWorkspaceExit } from "@/lib/workspace-navigation";
import { FINANCE_PATH, financeBrowse, financeHref } from "@/lib/finance-compatibility-navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { accountInitialValues, accountPayload, accountPositions, accountLedgerTotals, accountLedgerCsv, isAccountList, isAccountGateways, isAccountLedger, isFinancialAccount, type FinancialAccount, type AccountValues, type AccountGateway, type AccountLedgerPage, type AccountLedgerBrowse } from "@/components/accounting-accounts/account-model";
import { ACCOUNTS_PATH, accountListHref, accountViewHref, accountCreateHref, accountEditHref, safeAccountListReturn, safeAccountViewReturn, accountLedgerState, accountLedgerApi } from "@/lib/account-navigation";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
export class AccountRequestError extends Error {
    constructor(message: string, public status: number, public definiteRejection = false) {
        super(message);
    }
}
export async function accountRequest(path: string, init?: RequestInit, acknowledged?: () => void): Promise<unknown> {
    const response = await fetch(path, { cache: "no-store", ...init });
    if (response.ok) acknowledged?.();
    const body: unknown = await response.json().catch(() => null);
    // A proxy JSON parse failure retains HTTP status but is not a backend rejection.
    if (!response.ok)
        throw new AccountRequestError(getApiErrorMessage(body, "Financial account request failed."), response.status, response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 409 && getApiErrorMessage(body, "").trim().length > 0 && getApiErrorMessage(body, "").trim() !== "Unexpected upstream response");
    return body;
}
export function useAccountingAccounts() {
    const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), params = useSearchParams(), route = useParams<{
        accountId?: string;
    }>();
    const accountId = route.accountId ?? "";
    const financeContext = pathname === FINANCE_PATH ? financeBrowse(params.toString()) : null;
    const mode = pathname.endsWith("/new") ? "create" : pathname.endsWith("/edit") ? "edit" : accountId ? "view" : "register";
    const editing = mode === "create" || mode === "edit";
    const writeScope = JSON.stringify([tenant?.organization.id, tenant?.membership_id, tenant?.role_id, tenant?.permissions, pathname]);
    const activeWriteScope = useRef<string | null>(writeScope);
    useLayoutEffect(() => {
        activeWriteScope.current = writeScope;
        return () => { if (activeWriteScope.current === writeScope) activeWriteScope.current = null; };
    }, [writeScope]);
    const canView = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.view"));
    const canManage = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.manage"));
    const returnHref = mode === "edit" ? safeAccountViewReturn(params.get("returnTo"), accountId) : safeAccountListReturn(params.get("returnTo"));
    const browse = accountLedgerState(params.toString()), ledgerUrl = accountLedgerApi(accountId, browse);
    const viewHref = accountViewHref(accountId, returnHref, browse);
    const historyScope = accountCursorHistoryScope(tenant?.organization.id ?? "", tenant?.membership_id ?? "", accountId, browse);
    const historyPosition = JSON.stringify([historyScope, browse.page, browse.cursor]);
    const [previousPage, setPreviousPage] = useState<{ key: string; cursor: string | undefined } | null>(null);
    const [accounts, setAccounts] = useState<FinancialAccount[] | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState<string | null>(null);
    const [gateways, setGateways] = useState<AccountGateway[]>([]), [gatewayError, setGatewayError] = useState<string | null>(null);
    const [values, setValues] = useState<AccountValues>(() => accountInitialValues(null, tenant?.organization.currency)), [initial, setInitial] = useState<AccountValues>(() => accountInitialValues(null, tenant?.organization.currency));
    const [uncertain, setUncertain] = useState(false);
    const [saving, setSaving] = useState(false), [committed, setCommitted] = useState(false), [savedId, setSavedId] = useState<string | null>(null);
    const [ledgerState, setLedgerState] = useState<{
        key: string;
        data: AccountLedgerPage | null;
        error: string | null;
        loading: boolean;
    }>({
        key: "", data: null, error: null, loading: true
    });
    const [ledgerRevision, setLedgerRevision] = useState(0);
    const [queryInput, setQueryInput] = useState<{
        key: string;
        value: string;
    } | null>(null);
    const mounted = useRef(true), epoch = useRef(0), ledgerEpoch = useRef(0), inFlight = useRef(false), committedRef = useRef(false), uncertainRef = useRef(false), initialized = useRef(false);
    const account = accounts?.find(row => row.id === accountId) ?? null;
    const dirty = editing && !committed && JSON.stringify(values) !== JSON.stringify(initial);
    const navigation = useDocumentNavigationGuard(dirty, {
        enabled: editing, isBusy: saving, pendingRef: inFlight, documentLabel: "financial account", discardMessage: uncertain ? "This account may already have been created. Leaving loses this document’s duplicate-submit protection. Check Accounts before creating another account; do not repeat the opening balance." : undefined
    });
    const load = useCallback(async () => {
        if ((mode === "create" ? !canManage : !canView) || inFlight.current)
            return;
        const current = ++epoch.current;
        setLoading(true);
        setError(null);
        setGatewayError(null);
        const active = () => mounted.current && current === epoch.current;
        const core = mode === "create" ? Promise.resolve() : accountRequest("/api/finance/accounts").then(result => {
            if (!active())
                return;
            if (!isAccountList(result))
                throw new Error("Account response could not be verified. Retry loading.");
            setAccounts(result);
            if (editing && !initialized.current) {
                const loaded = result.find(row => row.id === accountId);
                if (loaded) {
                    const draft = accountInitialValues(loaded);
                    setValues(draft);
                    setInitial(draft);
                    initialized.current = true;
                }
            }
        }).catch(reason => {
            if (!active())
                return;
            setAccounts(null);
            setError(reason instanceof Error ? reason.message : "Could not load accounts.");
            if (reason instanceof AccountRequestError && reason.status === 401)
                router.replace("/login");
        });
        if (mode === "create" && !canView)
            setGatewayError("Gateway discovery requires finance viewing permission. You can create an unlinked manual account.");
        const connections = editing && canView ? accountRequest("/api/finance/payment-gateways/stripe").then(result => {
            if (!active())
                return;
            if (!isAccountGateways(result))
                throw new Error("Gateway connection response could not be verified.");
            setGateways(result.connections.filter(row => row.connected && row.id));
        }).catch(reason => {
            if (active()) {
                setGateways([]);
                setGatewayError(reason instanceof Error ? reason.message : "Gateway connections unavailable.");
                if (reason instanceof AccountRequestError && reason.status === 401)
                    router.replace("/login");
            }
        }) : Promise.resolve();
        await Promise.all([core, connections]);
        if (active())
            setLoading(false);
    }, [accountId, canView, canManage, editing, mode, router]);
    const invalidate = useCallback(() => {
        epoch.current++;
        ledgerEpoch.current++;
    }, []);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        void Promise.resolve().then(() => {
            if (active)
                void load();
        });
        return () => {
            active = false;
            mounted.current = false;
            invalidate();
        };
    }, [load, invalidate]);
    useEffect(() => {
        if (mode !== "view" || !canView)
            return;
        const current = ++ledgerEpoch.current;
        let active = true;
        const timer = window.setTimeout(() => {
            if (!active)
                return;
            setLedgerState({
                key: ledgerUrl, data: null, error: null, loading: true
            });
            void accountRequest(ledgerUrl).then(result => {
                if (!active || !mounted.current || current !== ledgerEpoch.current)
                    return;
                if (!isAccountLedger(result))
                    throw new Error("Statement response could not be verified. Retry loading.");
                setLedgerState({
                    key: ledgerUrl, data: result, error: null, loading: false
                });
            }).catch(reason => {
                if (!active || !mounted.current || current !== ledgerEpoch.current)
                    return;
                setLedgerState({
                    key: ledgerUrl, data: null, error: reason instanceof Error ? reason.message : "Statement unavailable.", loading: false
                });
                if (reason instanceof AccountRequestError && reason.status === 401)
                    router.replace("/login");
            });
        }, 250);
        return () => {
            active = false;
            window.clearTimeout(timer);
        };
    }, [mode, canView, ledgerUrl, ledgerRevision, router]);
    useEffect(() => {
        if (mode !== "view" || !canView) return;
        let active = true;
        void readPreviousAccountCursor(historyScope, accountLedgerState(params.toString())).then(cursor => {
            if (active) setPreviousPage({ key: historyPosition, cursor });
        });
        return () => { active = false; };
    }, [mode, canView, historyScope, historyPosition, params]);
    useEffect(() => {
        if (mode === "view" && params.has("cursors")) router.replace(viewHref, { scroll: false });
    }, [mode, params, router, viewHref]);
    const focus = financeContext?.account_focus ?? params.get("focus") ?? "";
    useEffect(() => {
        if (!loading && mode === "register" && focus)
            document.getElementById(`account-row-${focus}`)?.focus();
    }, [loading, mode, focus]);
    const ledger = ledgerState.key === ledgerUrl ? ledgerState.data : null;
    const ledgerLoading = ledgerState.key !== ledgerUrl || ledgerState.loading;
    const ledgerError = ledgerState.key === ledgerUrl ? ledgerState.error : null;
    const ownsWriteScope = () => mounted.current && activeWriteScope.current === writeScope;
    function change<K extends keyof AccountValues>(field: K, value: AccountValues[K]) {
        if (!ownsWriteScope() || inFlight.current || committedRef.current || uncertainRef.current || !canManage)
            return;
        if (mode === "edit" && ["account_type", "currency", "opening_balance"].includes(field))
            return;
        setValues(old => ({ ...old, [field]: value, ...(field === "gateway_connection_id" && gateways.some(row => row.id === value) ? { provider_name: "Stripe" } : {}) }));
    }
    function changeLedger(next: Partial<AccountLedgerBrowse>, paging = false) {
        setQueryInput(null);
        router.push(accountViewHref(accountId, returnHref, { ...browse, ...next, cursor: paging ? next.cursor ?? browse.cursor : "", page: paging ? next.page ?? browse.page : 1 }), { scroll: false });
    }
    const hasPreviousPage = browse.page > 1 && previousPage?.key === historyPosition && previousPage.cursor !== undefined;
    const previousHistoryLoading = browse.page > 1 && previousPage?.key !== historyPosition;
    async function nextLedgerPage() {
        if (!ledger?.next_cursor || ledgerLoading) return;
        const currentEpoch = ledgerEpoch.current;
        await rememberAccountCursorStep(historyScope, browse, ledger.next_cursor);
        if (mounted.current && currentEpoch === ledgerEpoch.current)
            changeLedger({ cursor: ledger.next_cursor, page: browse.page + 1 }, true);
    }
    function previousLedgerPage() {
        if (hasPreviousPage && !ledgerLoading)
            changeLedger({ cursor: previousPage!.cursor!, page: browse.page - 1 }, true);
    }
    const canSubmit = canManage && (mode === "create" || canView && accounts !== null && account !== null) && values.name.trim() !== "";
    function savedHref(id = savedId) {
        if (!canView) return "/dashboard";
        return mode === "edit" ? returnHref : id ? accountViewHref(id, returnHref) : returnHref;
    }
    async function save() {
        if (!ownsWriteScope() || !editing || !canSubmit || inFlight.current || committedRef.current || uncertainRef.current)
            return;
        inFlight.current = true;
        setSaving(true);
        setError(null);
        let writeStarted = false;
        try {
            const body = JSON.stringify(accountPayload(values, mode === "edit", account));
            writeStarted = true;
            const result = await accountRequest(mode === "edit" ? `/api/finance/accounts/${encodeURIComponent(accountId)}` : "/api/accounting/financial-accounts", { method: mode === "edit" ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body }, () => { if (ownsWriteScope()) committedRef.current = true; });
            if (!ownsWriteScope())
                return;
            committedRef.current = true;
            const id = isFinancialAccount(result) ? result.id : mode === "edit" ? accountId : null;
            setSavedId(id);
            setCommitted(true);
            inFlight.current = false;
            setSaving(false);
            navigation.markClean();
            if (!canView) return; // Keep a truthful receipt when the saved account cannot be read.
            if (!navigation.navigate(savedHref(id), { replace: true, discard: true }))
                setError("The account was saved. Open the saved result below; do not submit again.");
        }
        catch (reason) {
            if (!ownsWriteScope())
                return;
            if (mode === "create" && writeStarted && !committedRef.current && !(reason instanceof AccountRequestError && reason.definiteRejection)) {
                uncertainRef.current = true;
                setUncertain(true);
            }
            setError(uncertainRef.current ? "The account creation outcome is unknown. It may already exist, including its opening balance. Do not submit again; review Accounts in a separate tab. Reloading or leaving this document loses this local protection." : committedRef.current ? "The account was saved, but the saved result could not be opened. Do not submit again." : reason instanceof Error ? reason.message : "The save response could not be confirmed. Check Accounts before retrying.");
            if (reason instanceof AccountRequestError && reason.status === 401)
                router.replace("/login");
        }
        finally {
            inFlight.current = false;
            if (ownsWriteScope())
                setSaving(false);
        }
    }
    function exportPage() {
        if (!account || !ledger || ledgerLoading)
            return;
        const url = URL.createObjectURL(new Blob([accountLedgerCsv(ledger.items)], { type: "text/csv;charset=utf-8" }));
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${account.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-statement-page-${browse.page}.csv`;
        anchor.click();
        URL.revokeObjectURL(url);
    }
    return {
        mode, editing, accountId, hasPreviousPage, previousHistoryLoading, previousLedgerPage, nextLedgerPage, accounts, account, loading, error, gateways, gatewayError, values, saving, dirty, committed, uncertain, canView, canManage, canSubmit, returnHref, viewHref, browse, ledger, ledgerLoading, ledgerError, queryDraft: queryInput?.key === ledgerUrl ? queryInput.value : browse.search, setQueryDraft: (value: string) => setQueryInput({ key: ledgerUrl, value }), positions: accountPositions(accounts ?? []), pageTotals: accountLedgerTotals(ledger?.items ?? []), sourceTypes: [...new Set([...(ledger?.items ?? []).map(row => row.source_type), ...(browse.source_type ? [browse.source_type] : [])])].sort(), change, load, save, changeLedger, exportPage, retryLedger: () => setLedgerRevision(value => value + 1), refresh: async () => {
            await load();
            setLedgerRevision(value => value + 1);
        }, back: () => editing ? navigation.navigate(returnHref) : router.push(returnHref), openAccount: (id: string) => { if (financeContext && !requestWorkspaceExit()) return; router.push(accountViewHref(id, financeContext ? financeHref({ ...financeContext, tab: "accounts", account_focus: id }) : accountListHref(id))); }, createHref: accountCreateHref(financeContext ? financeHref({ ...financeContext, tab: "accounts" }) : ACCOUNTS_PATH), editHref: accountEditHref(accountId, viewHref), openSaved: () => navigation.navigate(savedHref(), { discard: true, replace: true })
    };
}
export type AccountingAccountsState = ReturnType<typeof useAccountingAccounts>;
