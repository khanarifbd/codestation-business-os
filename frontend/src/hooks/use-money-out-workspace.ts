"use client";
import { hasAccountingRejectionDetail } from "@/lib/accounting-rejection";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { decimalInput, eligibleAccount, initialMoneyOutValues, isAccounts, isMeta, isExpenseDetail, isExpensePage, moneyOutPayload, moneyOutPreview, visibleExpenses, visiblePostedTotals, type Account, type ExpenseDetail, type ExpensePage, type Meta, type MoneyOutBrowse, type MoneyOutValues, type Purpose } from "@/components/accounting-money-out/money-out-model";
import { MONEY_OUT_PATH, moneyOutBrowse, moneyOutCreateHref, moneyOutListHref, moneyOutPageApi, moneyOutPurpose, moneyOutViewHref, safeMoneyOutReturn } from "@/lib/money-out-navigation";
type Phase = "idle" | "uncertain" | "confirmed";
type Operation = {
    key: string;
    body: string;
    expected: {
        expenseCurrency: string;
        accountCurrency: string;
        expense: string;
        tax: string;
        deduction: string;
        rate: string;
        clientId: string | null;
        projectId: string | null;
        orderId: string | null;
    };
};
async function read(path: string): Promise<unknown> { const response = await fetch(path, { cache: "no-store" }), data: unknown = await response.json().catch(() => null); if (!response.ok)
    throw new Error(getApiErrorMessage(data, "Expense information could not be loaded.")); return data; }
const knownMoneyRejection = (status: number, body: unknown) => [400, 401, 403, 404, 422].includes(status) && hasAccountingRejectionDetail(body);

export function useMoneyOutWorkspace() {
    const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), query = useSearchParams(), route = useParams<{
        expenseId?: string;
    }>();
    const mode = pathname.endsWith("/new") ? "create" : route.expenseId ? "view" : "register", purpose = moneyOutPurpose(query.get("purpose")), expenseId = route.expenseId || "";
    const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
    const rawQuery = query.toString(), browse = useMemo(() => moneyOutBrowse(rawQuery), [rawQuery]), returnHref = safeMoneyOutReturn(query.get("returnTo")), listHref = moneyOutListHref(browse), pageUrl = moneyOutPageApi({ ...browse });
    const [meta, setMeta] = useState<Meta | null>(null);
    const [accounts, setAccounts] = useState<Account[] | null>(null);
    const [setupLoading, setSetupLoading] = useState(true);
    const [setupError, setSetupError] = useState<string | null>(null);
    const [pageState, setPageState] = useState<{
        key: string;
        page: ExpensePage | null;
        loading: boolean;
        error: string | null;
    }>({ key: "", page: null, loading: true, error: null });
    const [document, setDocument] = useState<ExpenseDetail | null>(null);
    const [documentLoading, setDocumentLoading] = useState(true);
    const [documentError, setDocumentError] = useState<string | null>(null);
    const [values, setValues] = useState<MoneyOutValues>(initialMoneyOutValues);
    const [initial] = useState(values);
    const [phase, setPhase] = useState<Phase>("idle");
    const [saving, setSaving] = useState(false);
    const [writeError, setWriteError] = useState<string | null>(null);
    const [receipt, setReceipt] = useState<ExpenseDetail | null>(null);
    const [confirmedExpenseId, setConfirmedExpenseId] = useState<string | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [confirmationVersion, setConfirmationVersion] = useState(0);
    const [previous, setPrevious] = useState<{
        key: string;
        cursor: string | undefined;
    } | null>(null);
    const [pendingPage, setPendingPage] = useState<string | null>(null);
    const mounted = useRef(true), setupEpoch = useRef(0), pageEpoch = useRef(0), documentEpoch = useRef(0), inFlight = useRef(false), uncertain = useRef(false), committed = useRef(false), operation = useRef<Operation | null>(null), confirmationSequence = useRef(0), activeConfirmation = useRef(0), navigationPending = useRef(false), navigationSequence = useRef(0);
    const preview = moneyOutPreview(values, purpose, meta, accounts), { account, project, client, category, vendor, currency, crossCurrency } = preview, formError = setupLoading ? "Wait for authoritative expense setup to finish loading." : preview.error;
    const dirty = mode === "create" && phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(initial));
    const navigation = useDocumentNavigationGuard(dirty, { enabled: mode === "create", isBusy: saving, pendingRef: inFlight, documentLabel: "expense", discardMessage: phase === "uncertain" ? "This expense may already be recorded. Leaving loses this tab’s retained retry key. Verify the current company’s expense history before recording any replacement. Leave anyway?" : undefined });
    const cursorBrowse = { search: "", direction: "all" as const, source_type: JSON.stringify([browse.status, browse.category_id]), date_from: "", date_to: "", size: browse.size, page: browse.page, cursor: browse.cursor }, scope = accountCursorHistoryScope(tenant?.organization.id || "", tenant?.membership_id || "", "money-out-expenses", cursorBrowse), position = JSON.stringify([scope, browse.page, browse.cursor]);
    const loadSetup = useCallback(async () => {
        if (!mounted.current || !canView || mode === "view" || inFlight.current || uncertain.current || committed.current)
            return;
        const epoch = ++setupEpoch.current;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        setSetupLoading(true);
        setSetupError(null);
        try {
            const [m, a] = await Promise.all([read("/api/finance/expense-meta"), mode === "create" ? read("/api/finance/accounts") : Promise.resolve(null)]);
            if (!isMeta(m))
                throw new Error("Expense setup could not be verified.");
            if (mode === "create") {
                if (!isAccounts(a))
                    throw new Error("Authoritative account types could not be verified.");
                if (new Set(a.map(x => x.id)).size !== a.length || m.accounts.some(x => !a.some(y => y.id === x.id && y.currency === x.currency)))
                    throw new Error("Expense setup and account identities do not agree. Reload; no partial account list is used.");
            }
            if (!mounted.current || epoch !== setupEpoch.current)
                return;
            setMeta(m);
            setAccounts(mode === "create" ? a as Account[] : null);
        }
        catch (error) {
            if (mounted.current && epoch === setupEpoch.current) {
                setMeta(null);
                setAccounts(null);
                setSetupError(error instanceof Error ? error.message : "Expense setup unavailable.");
            }
        }
        finally {
            if (mounted.current && epoch === setupEpoch.current)
                setSetupLoading(false);
        }
    }, [canView, mode, setConfirmOpen, setSetupLoading, setSetupError, setMeta, setAccounts]);
    const loadPage = useCallback(async () => { if (!mounted.current || !canView || mode !== "register")
        return; const epoch = ++pageEpoch.current; setPageState({ key: pageUrl, page: null, loading: true, error: null }); try {
        const p = await read(pageUrl);
        if (!isExpensePage(p))
            throw new Error("Expense register response or cursor could not be verified.");
        if (mounted.current && epoch === pageEpoch.current)
            setPageState({ key: pageUrl, page: p, loading: false, error: null });
    }
    catch (error) {
        if (mounted.current && epoch === pageEpoch.current)
            setPageState({ key: pageUrl, page: null, loading: false, error: error instanceof Error ? error.message : "Expense register unavailable." });
    } }, [canView, mode, pageUrl, setPageState]);
    const loadDocument = useCallback(async () => { if (!mounted.current || !canView || mode !== "view")
        return; const epoch = ++documentEpoch.current; setDocument(null); setDocumentLoading(true); setDocumentError(null); try {
        const d = await read(`/api/finance/expenses/${encodeURIComponent(expenseId)}`);
        if (!isExpenseDetail(d) || d.id !== expenseId)
            throw new Error("Expense document identity could not be verified.");
        if (mounted.current && epoch === documentEpoch.current)
            setDocument(d);
    }
    catch (error) {
        if (mounted.current && epoch === documentEpoch.current)
            setDocumentError(error instanceof Error ? error.message : "Expense unavailable.");
    }
    finally {
        if (mounted.current && epoch === documentEpoch.current)
            setDocumentLoading(false);
    } }, [canView, mode, expenseId, setDocument, setDocumentLoading, setDocumentError]);
    useEffect(() => { mounted.current = true; const epochs = [setupEpoch, pageEpoch, documentEpoch]; return () => { mounted.current = false; activeConfirmation.current = 0; epochs.forEach(e => ++e.current); }; }, []);
    useEffect(() => { const timer = window.setTimeout(() => void loadSetup(), 0), epoch = setupEpoch; return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadSetup]);
    useEffect(() => { const timer = window.setTimeout(() => void loadPage(), 0), epoch = pageEpoch; return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadPage]);
    useEffect(() => { const timer = window.setTimeout(() => void loadDocument(), 0), epoch = documentEpoch; return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadDocument]);
    useEffect(() => {
        const epoch = ++navigationSequence.current;
        navigationPending.current = false;
        // A browser-history transition is not necessarily routed through changeBrowse.
        // Invalidate delayed cursor storage work and clear only this settled page's latch.
        queueMicrotask(() => { if (mounted.current && epoch === navigationSequence.current) setPendingPage(null); });
    }, [pageUrl, rawQuery]);
    useEffect(() => { if (mode !== "register")
        return; let active = true; void readPreviousAccountCursor(scope, { search: "", direction: "all", source_type: "", date_from: "", date_to: "", size: browse.size, page: browse.page, cursor: browse.cursor }).then(cursor => { if (active)
        setPrevious({ key: position, cursor }); }); return () => { active = false; }; }, [mode, scope, position, browse.size, browse.page, browse.cursor]);
    useEffect(() => { if (mode === "register" && browse.focus && pageState.key === pageUrl && pageState.page)
        window.document.getElementById(`money-out-row-${browse.focus}`)?.focus(); }, [mode, browse.focus, pageState.key, pageState.page, pageUrl]);
    const page = pageState.key === pageUrl ? pageState.page : null, rows = page?.items || null, filteredRows = rows ? visibleExpenses(rows, browse) : null, visibleTotals = filteredRows ? visiblePostedTotals(filteredRows) : null, pageLoading = pageState.key !== pageUrl || pageState.loading, pageError = pageState.key === pageUrl ? pageState.error : null, nextCursor = page?.next_cursor || null, hasPrevious = browse.page > 1 && previous?.key === position && previous.cursor !== undefined, paging = pendingPage === pageUrl;
    function changeBrowse(patch: Partial<MoneyOutBrowse>) { ++navigationSequence.current; navigationPending.current = false; setPendingPage(null); const reset = Object.keys(patch).some(k => ["category_id", "status", "size"].includes(k)); router.push(moneyOutListHref({ ...browse, ...patch, focus: "", ...(reset ? { cursor: "", page: 1 } : {}) })); }
    async function nextPage() { if (!nextCursor || pageLoading || navigationPending.current)
        return; navigationPending.current = true; setPendingPage(pageUrl); const epoch = ++navigationSequence.current; try {
        await rememberAccountCursorStep(scope, cursorBrowse, nextCursor);
        if (mounted.current && epoch === navigationSequence.current)
            router.push(moneyOutListHref({ ...browse, cursor: nextCursor, page: browse.page + 1, focus: "" }));
    }
    catch {
        if (mounted.current && epoch === navigationSequence.current) {
            navigationPending.current = false;
            setPendingPage(null);
            setPageState({ key: pageUrl, page: null, loading: false, error: "Page navigation failed. Reload the register." });
        }
    } }
    function previousPage() { if (hasPrevious && !pageLoading && !navigationPending.current) {
        navigationPending.current = true;
        setPendingPage(pageUrl);
        router.push(moneyOutListHref({ ...browse, cursor: previous!.cursor!, page: browse.page - 1, focus: "" }));
    } }
    function change<K extends keyof MoneyOutValues>(key: K, value: MoneyOutValues[K]) { if (!mounted.current || !canManage || mode !== "create" || inFlight.current || uncertain.current || committed.current)
        return; activeConfirmation.current = 0; setConfirmOpen(false); operation.current = null; setWriteError(null); setValues(v => ({ ...v, [key]: value, ...(key === "account_id" ? { account_amount: "" } : {}) })); }
    function review() { if (!mounted.current || !canView || !canManage || mode !== "create" || inFlight.current || committed.current || (!uncertain.current && (formError || !preview.amounts)))
        return; activeConfirmation.current = ++confirmationSequence.current; setConfirmationVersion(activeConfirmation.current); setWriteError(null); setConfirmOpen(true); }
    function cancelReview() { if (!inFlight.current && confirmationVersion === activeConfirmation.current) {
        activeConfirmation.current = 0;
        setConfirmOpen(false);
    } }
    async function postExpense() {
        if (!mounted.current || !canView || !canManage || mode !== "create" || !confirmOpen || !confirmationVersion || confirmationVersion !== activeConfirmation.current || inFlight.current || committed.current || (!uncertain.current && (formError || !preview.amounts)))
            return;
        activeConfirmation.current = 0;
        inFlight.current = true;
        setSaving(true);
        setWriteError(null);
        let classified = false;
        try {
            if (!operation.current) {
                const amounts = preview.amounts!;
                operation.current = { key: window.crypto.randomUUID(), body: JSON.stringify(moneyOutPayload(values, purpose, currency, crossCurrency)), expected: { expenseCurrency: currency, accountCurrency: account!.currency, ...amounts, clientId: purpose === "project" ? project!.client_id : purpose === "client" ? client!.id : null, projectId: purpose === "project" ? project!.id : null, orderId: purpose === "project" ? project!.order_id : null } };
            }
            const op = operation.current, response = await fetch("/api/finance/expenses", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body });
            classified = true;
            if (response.ok)
                committed.current = true;
            const data: unknown = await response.json().catch(() => null);
            if (!mounted.current)
                return;
            if (!response.ok) {
                if (uncertain.current || !knownMoneyRejection(response.status, data)) {
                    uncertain.current = true;
                    setPhase("uncertain");
                }
                throw new Error(getApiErrorMessage(data, "The expense posting was not confirmed."));
            }
            setPhase("confirmed");
            setConfirmOpen(false);
            navigation.markClean();
            if (data && typeof data === "object" && "id" in data && typeof data.id === "string" && data.id.length > 0 && data.id.length <= 200 && !/[\u0000-\u001f]/.test(data.id))
                setConfirmedExpenseId(data.id);
            const sent = JSON.parse(op.body) as ReturnType<typeof moneyOutPayload>, expected = op.expected;
            const matches = isExpenseDetail(data) && data.account_id === sent.account_id && data.expense_date === sent.expense_date && data.expense_currency === expected.expenseCurrency && data.account_currency === expected.accountCurrency && data.client_id === expected.clientId && data.project_id === expected.projectId && data.order_id === expected.orderId && data.invoice_id === null && data.payment_id === null && transferCents(data.expense_amount) === transferCents(expected.expense) && transferCents(data.tax_amount) === transferCents(expected.tax) && transferCents(data.account_amount) === transferCents(expected.deduction) && data.profitability_currency === expected.expenseCurrency && transferCents(data.profitability_amount) === transferCents(expected.expense) && decimalInput(String(data.exchange_rate)) === decimalInput(expected.rate) && decimalInput(String(data.profitability_exchange_rate)) === "1";
            if (matches)
                setReceipt(data);
            else
                setWriteError("The server confirmed the expense, but its returned identity or amounts could not be verified. Check existing records; do not post again.");
        }
        catch (error) {
            if (!mounted.current)
                return;
            if (!committed.current && operation.current && !classified) {
                uncertain.current = true;
                setPhase("uncertain");
            }
            if (committed.current) {
                setPhase("confirmed");
                navigation.markClean();
            }
            setConfirmOpen(false);
            setWriteError(error instanceof Error ? error.message : "The expense outcome could not be confirmed.");
        }
        finally {
            inFlight.current = false;
            if (mounted.current)
                setSaving(false);
        }
    }
    function openReceipt() { if (!committed.current)
        return; navigation.navigate(confirmedExpenseId ? moneyOutViewHref(confirmedExpenseId, returnHref) : returnHref, { discard: true, replace: true }); }
    return { mode, canView, canManage, purpose, browse, returnHref, listHref, rows, filteredRows, visibleTotals, pageLoading, pageError, nextCursor, hasPrevious, historyLoading: browse.page > 1 && previous?.key !== position, paging, nextPage, previousPage, changeBrowse, loadPage, meta, accounts, setupLoading, setupError, loadSetup, categories: meta?.categories || [], values, change, preview, account, project, client, category, vendor, currency, crossCurrency, formError, phase, receipt, confirmedExpenseId, document, documentLoading, documentError, loadDocument, saving, locked: saving || phase !== "idle", canContinue: !formError && Boolean(preview.amounts) && phase !== "confirmed", dirty, writeError, confirmOpen, review, cancelReview, postExpense, openReceipt, back: () => mode === "create" ? navigation.navigate(returnHref) : router.push(returnHref), createHref: (p: Purpose) => moneyOutCreateHref(p, listHref), viewHref: (id: string) => moneyOutViewHref(id, moneyOutListHref({ ...browse, focus: id })), verificationHref: MONEY_OUT_PATH, activeAccounts: (accounts || []).filter(eligibleAccount), resetPage: () => { ++navigationSequence.current; navigationPending.current = false; setPendingPage(null); router.push(moneyOutListHref({ ...browse, cursor: "", page: 1, focus: "" })); } };
}
export type MoneyOutState = ReturnType<typeof useMoneyOutWorkspace>;
