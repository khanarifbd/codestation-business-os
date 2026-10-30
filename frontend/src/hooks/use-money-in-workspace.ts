"use client";
import { hasAccountingRejectionDetail } from "@/lib/accounting-rejection";
import { FINANCE_PATH, financeBrowse, financeHref, financePaymentQuery } from "@/lib/finance-compatibility-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { getApiErrorMessage } from "@/lib/api-error";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { asReceipt, eligibleAccount, initialMoneyInValues, invoiceCollectible, invoiceMatches, isInvoice, isInvoicePage, isMeta, moneyInAmount, moneyInPayload, purposes, type Category, type Invoice, type InvoicePage, type Meta, type MoneyInValues, type Purpose, type Receipt, type ReceiptKind, type SourceIdentity } from "@/components/accounting-money-in/money-in-model";
import { MONEY_IN_PATH, moneyInBrowse, moneyInCreateHref, moneyInInvoiceApi, moneyInKind, moneyInListHref, moneyInPurpose, moneyInReadApi, moneyInReceiptHref, safeMoneyInReturn } from "@/lib/money-in-navigation";
type StageStatus = "idle" | "create-uncertain" | "create-confirmed" | "created" | "issue-uncertain" | "issued" | "payment-uncertain" | "confirmed";
export type MoneyInStage = {
    status: StageStatus;
    invoiceId: string;
    note: string;
};
type Operation = {
    key: string;
    body: string;
    path: string;
    kind: ReceiptKind;
    expectedCurrency: string;
    expectedAccountCurrency: string;
};
class ReadError extends Error {
    constructor(message: string, public status: number) { super(message); }
}
async function read(path: string): Promise<unknown> { const r = await fetch(path, { cache: "no-store" }), b: unknown = await r.json().catch(() => null); if (!r.ok)
    throw new ReadError(getApiErrorMessage(b, "Information could not be loaded."), r.status); return b; }
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const knownMoneyRejection = (status: number, body: unknown) => [400, 401, 403, 404, 422].includes(status) && hasAccountingRejectionDetail(body);

export function useMoneyInWorkspace() {
    const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), query = useSearchParams(), route = useParams<{
        kind?: string;
        receiptId?: string;
    }>();
    const mode = pathname.endsWith("/new") ? "create" : route.receiptId ? "receipt" : "register", purpose = moneyInPurpose(query.get("purpose")), legacyInvoice = mode === "register" && pathname !== FINANCE_PATH ? query.get("invoice_id") : null;
    const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
    const rawQuery = query.toString();
    const financeContext = pathname === FINANCE_PATH ? financeHref({ ...financeBrowse(rawQuery), tab: "payments" }) : null;
    const browseQuery = `${pathname === FINANCE_PATH ? financePaymentQuery(rawQuery) : rawQuery}`;
    const browse = useMemo(() => moneyInBrowse(browseQuery), [browseQuery]);
    const returnHref = safeMoneyInReturn(query.get("returnTo")), listHref = moneyInListHref(browse, financeContext), pageUrl = moneyInReadApi({ ...browse }), browseKind = browse.kind, prefillInvoiceId = query.get("invoice_id"), receiptId = route.receiptId || "", receiptKind = moneyInKind(route.kind || null);
    const [meta, setMeta] = useState<Meta | null>(null), [metaLoading, setMetaLoading] = useState(true), [metaError, setMetaError] = useState<string | null>(null), [categories, setCategories] = useState<Category[]>([]);
    const [pageState, setPageState] = useState<{
        key: string;
        rows: Receipt[] | null;
        next: string | null;
        loading: boolean;
        error: string | null;
    }>({ key: "", rows: null, next: null, loading: true, error: null });
    const [document, setDocument] = useState<Receipt | null>(null), [documentLoading, setDocumentLoading] = useState(true), [documentError, setDocumentError] = useState<string | null>(null);
    const [values, setValues] = useState<MoneyInValues>(() => ({ ...initialMoneyInValues(), source_id: mode === "create" && purpose === "invoice" ? (query.get("invoice_id") || "") : "" }));
    const [sourceIdentity, setSourceIdentity] = useState<SourceIdentity | null>(null), [initialValues] = useState(values);
    const [invoice, setInvoice] = useState<Invoice | null>(null), [sourceLoading, setSourceLoading] = useState(false), [sourceError, setSourceError] = useState<string | null>(null), [sourceReady, setSourceReady] = useState(false);
    const [invoicePage, setInvoicePage] = useState<InvoicePage | null>(null), [invoiceSearch, setInvoiceSearchState] = useState(""), [invoiceCursor, setInvoiceCursor] = useState(""), [invoiceHistory, setInvoiceHistory] = useState<string[]>([]), [invoicesLoading, setInvoicesLoading] = useState(false), [invoiceError, setInvoiceError] = useState<string | null>(null);
    const [stage, setStageState] = useState<MoneyInStage>({ status: "idle", invoiceId: "", note: "" }), [saving, setSaving] = useState(false), [confirmOpen, setConfirmOpen] = useState(false), [confirmationVersion, setConfirmationVersion] = useState(0), [writeError, setWriteError] = useState<string | null>(null), [receipt, setReceipt] = useState<Receipt | null>(null);
    const pageIdentity = JSON.stringify([pageUrl, rawQuery]);
    const [previous, setPrevious] = useState<{
        key: string;
        cursor: string | undefined;
    } | null>(null), [pagingState, setPagingState] = useState({ source: pageIdentity, pending: false }), [invoicePagingKey, setInvoicePagingKey] = useState<string | null>(null);
    // Pager state belongs to one route identity. Reset during the guarded render
    // transition so returning to an earlier URL cannot revive a stale pending UI.
    if (pagingState.source !== pageIdentity) setPagingState({ source: pageIdentity, pending: false });
    const setPagingUrl = (url: string | null) => setPagingState({ source: pageIdentity, pending: url === pageUrl });
    const paging = pagingState.source === pageIdentity && pagingState.pending, selectorKey = JSON.stringify([invoiceSearch, invoiceCursor]), invoiceNavigating = invoicePagingKey === selectorKey;
    const mounted = useRef(true), metaEpoch = useRef(0), pageEpoch = useRef(0), sourceEpoch = useRef(0), invoiceEpoch = useRef(0), documentEpoch = useRef(0), inFlight = useRef(false), readRecovery = useRef(false), navBusy = useRef(false), invoiceNavBusy = useRef(false), navEpoch = useRef(0), stageRef = useRef(stage), sourceRef = useRef<SourceIdentity | null>(null), operation = useRef<Operation | null>(null), everUncertain = useRef(false), committed = useRef(false), confirmationSequence = useRef(0), activeConfirmation = useRef(0);
    const setStage = (next: MoneyInStage) => { activeConfirmation.current = 0; stageRef.current = next; if (mounted.current)
        setStageState(next); };
    const unknown = ["create-uncertain", "create-confirmed", "issue-uncertain", "payment-uncertain"].includes(stage.status), dirty = mode === "create" && stage.status !== "confirmed" && (stage.status !== "idle" || JSON.stringify(values) !== JSON.stringify(initialValues));
    const navigation = useDocumentNavigationGuard(dirty, { enabled: mode === "create", isBusy: saving, pendingRef: inFlight, documentLabel: "money receipt", discardMessage: stage.status !== "idle" ? "An invoice or receipt may already be saved. Leaving loses this tab’s retained stages and retry key. Verify the current company’s invoice and payment history before recording any replacement. Leave anyway?" : undefined });
    const project = meta?.projects.find(p => purpose === "project" && p.id === values.source_id), order = meta?.orders.find(o => purpose === "order" && o.id === values.source_id), client = meta?.clients.find(c => purpose === "advance" && c.id === values.source_id), account = meta?.accounts.find(a => a.id === values.account_id) || null, category = categories.find(c => c.id === values.category_id) || null;
    const related = values.relation_type === "client" ? meta?.clients.find(c => c.id === values.relation_id) : values.relation_type === "project" ? meta?.projects.find(p => p.id === values.relation_id) : values.relation_type === "order" ? meta?.orders.find(o => o.id === values.relation_id) : null;
    const currency = invoice?.currency || sourceIdentity?.currency || project?.currency || order?.currency || client?.currency || (purpose === "other" ? related?.currency : "") || account?.currency || "";
    const compatibleAccounts = (meta?.accounts || []).filter(a => eligibleAccount(a) && (!currency || a.currency === currency));
    const sourceLabel = invoice ? `${invoice.invoice_number} · ${invoice.client_name}` : project ? `${project.number} · ${project.name}` : order ? `${order.number} · ${order.client_name}` : client ? `${client.code} · ${client.name}` : category?.name || purposes.find(p => p.value === purpose)!.title;
    const cursorBrowse = { search: "", direction: "all" as const, source_type: browse.invoice_id, date_from: "", date_to: "", size: 20, cursor: browse.cursor, page: browse.page };
    const scope = accountCursorHistoryScope(tenant?.organization.id || "", tenant?.membership_id || "", "money-in-payments", cursorBrowse), position = JSON.stringify([scope, browse.page, browse.cursor]);
    const loadMeta = useCallback(async () => { if (!canView || mode !== "create" || inFlight.current || stageRef.current.status !== "idle")
        return; activeConfirmation.current = 0; setConfirmOpen(false); const e = ++metaEpoch.current; setMetaLoading(true); setMetaError(null); try {
        const m = await read("/api/finance/meta");
        if (!isMeta(m))
            throw new Error("Finance selection data could not be verified.");
        let cats: Category[] = [];
        if (purpose === "other") {
            const c = await read("/api/accounting/chart-of-accounts");
            if (!Array.isArray(c) || !c.every(x => record(x) && typeof x.id === "string" && typeof x.name === "string" && typeof x.category === "string" && typeof x.is_active === "boolean"))
                throw new Error("Income categories could not be verified.");
            cats = (c as Category[]).filter(x => x.category === "income" && x.is_active);
        }
        if (mounted.current && e === metaEpoch.current) {
            setMeta(m);
            setCategories(cats);
        }
    }
    catch (error) {
        if (mounted.current && e === metaEpoch.current) {
            setMeta(null);
            setCategories([]);
            setMetaError(error instanceof Error ? error.message : "Selection data unavailable.");
        }
    }
    finally {
        if (mounted.current && e === metaEpoch.current)
            setMetaLoading(false);
    } }, [canView, mode, purpose, setConfirmOpen, setMetaLoading, setMetaError, setMeta, setCategories]);
    const loadPage = useCallback(async () => { if (!canView || mode !== "register" || legacyInvoice)
        return; const e = ++pageEpoch.current; setPageState({ key: pageUrl, rows: null, next: null, loading: true, error: null }); try {
        const b = await read(pageUrl), items = browseKind === "payment" && record(b) ? b.items : b;
        if (browseKind === "payment" && (!record(b) || !(b.next_cursor === null || typeof b.next_cursor === "string")))
            throw new Error("The payment cursor response could not be verified. The last page is unknown.");
        if (!Array.isArray(items))
            throw new Error("Receipt register could not be verified.");
        const rows = items.map(x => asReceipt(browseKind, x));
        if (rows.some(x => !x))
            throw new Error("Receipt register contains an unverified record.");
        const next = browseKind === "payment" && record(b) && typeof b.next_cursor === "string" ? b.next_cursor : null;
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, rows: rows as Receipt[], next, loading: false, error: null });
    }
    catch (error) {
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, rows: null, next: null, loading: false, error: error instanceof Error ? error.message : "Receipts unavailable." });
    } }, [canView, mode, legacyInvoice, pageUrl, browseKind, setPageState]);
    const loadDocument = useCallback(async () => { if (!canView || mode !== "receipt")
        return; const e = ++documentEpoch.current; setDocument(null); setDocumentError(null); setDocumentLoading(true); try {
        if (!["payment", "advance", "income"].includes(route.kind || ""))
            throw new Error("Unsupported receipt kind.");
        const paths = { payment: "/api/finance/payments", advance: "/api/accounting/customer-advances", income: "/api/accounting/money" };
        const b = await read(`${paths[receiptKind]}/${encodeURIComponent(receiptId)}`), r = asReceipt(receiptKind, b);
        if (!r || r.record.id !== receiptId)
            throw new Error("Receipt identity could not be verified.");
        if (mounted.current && e === documentEpoch.current)
            setDocument(r);
    }
    catch (error) {
        if (mounted.current && e === documentEpoch.current)
            setDocumentError(error instanceof Error ? error.message : "Receipt unavailable.");
    }
    finally {
        if (mounted.current && e === documentEpoch.current)
            setDocumentLoading(false);
    } }, [canView, mode, receiptId, receiptKind, route.kind, setDocument, setDocumentError, setDocumentLoading]);
    const loadInvoices = useCallback(async () => { if (!canView || mode !== "create" || purpose !== "invoice" || stageRef.current.status !== "idle")
        return; const e = ++invoiceEpoch.current; setInvoicesLoading(true); setInvoiceError(null); setInvoicePage(null); try {
        const p = await read(moneyInInvoiceApi(invoiceSearch, invoiceCursor));
        if (!isInvoicePage(p))
            throw new Error("Invoice selector response could not be verified.");
        if (mounted.current && e === invoiceEpoch.current)
            setInvoicePage(p);
    }
    catch (error) {
        if (mounted.current && e === invoiceEpoch.current)
            setInvoiceError(error instanceof Error ? error.message : "Invoices unavailable.");
    }
    finally {
        if (mounted.current && e === invoiceEpoch.current)
            setInvoicesLoading(false);
    } }, [canView, mode, purpose, invoiceSearch, invoiceCursor, setInvoicesLoading, setInvoiceError, setInvoicePage]);
    const loadSource = useCallback(async () => {
        if (!mounted.current || !canView || mode !== "create" || inFlight.current || stageRef.current.status !== "idle")
            return;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        const e = ++sourceEpoch.current;
        setInvoice(null);
        setSourceError(null);
        setSourceReady(false);
        sourceRef.current = null;
        setSourceIdentity(null);
        if (!values.source_id || ["advance", "other"].includes(purpose)) {
            setSourceLoading(false);
            return;
        }
        setSourceLoading(true);
        try {
            let identity: SourceIdentity, found: Invoice | null = null;
            if (purpose === "invoice") {
                const b = await read(`/api/finance/invoices/${encodeURIComponent(values.source_id)}`);
                if (!isInvoice(b) || b.id !== values.source_id)
                    throw new Error("Invoice identity could not be verified.");
                found = b;
                identity = { purpose, id: b.id, orderId: b.order_id || "", projectId: b.project_id || "", clientId: b.client_id, currency: b.currency };
                if (!invoiceCollectible(b))
                    throw new Error("This invoice is not currently open for collection.");
            }
            else {
                const source = purpose === "project" ? meta?.projects.find(x => x.id === values.source_id) : meta?.orders.find(x => x.id === values.source_id);
                if (!source)
                    throw new Error("The selected source is unavailable in the loaded metadata.");
                identity = { purpose, id: source.id, orderId: purpose === "project" ? (source as import("@/components/accounting-money-in/money-in-model").Project).order_id : source.id, projectId: purpose === "project" ? source.id : "", clientId: source.client_id, currency: source.currency };
                const state = await read(`/api/finance/orders/${encodeURIComponent(identity.orderId)}/settlement`);
                if (!record(state) || state.order_id !== identity.orderId)
                    throw new Error("Source invoice identity could not be checked.");
                if (typeof state.reason === "string" && state.reason.includes("staged billing"))
                    throw new Error("This source uses staged billing. Use its billing schedule and milestone invoices instead.");
                if (typeof state.invoice_id === "string") {
                    const b = await read(`/api/finance/invoices/${encodeURIComponent(state.invoice_id)}`);
                    if (!isInvoice(b) || b.id !== state.invoice_id || !invoiceMatches(b, identity))
                        throw new Error("The existing invoice does not match this source.");
                    if (b.status === "cancelled" || b.status === "paid")
                        throw new Error("The source invoice is cancelled or fully paid.");
                    found = b;
                }
            }
            if (!mounted.current || e !== sourceEpoch.current)
                return;
            sourceRef.current = identity;
            setSourceIdentity(identity);
            setInvoice(found);
            setSourceReady(true);
            if (found && purpose === "invoice" && prefillInvoiceId === found.id)
                setValues(v => v.amount ? v : { ...v, amount: String(found.balance_due) });
        }
        catch (error) {
            if (mounted.current && e === sourceEpoch.current)
                setSourceError(error instanceof Error ? error.message : "Source unavailable.");
        }
        finally {
            if (mounted.current && e === sourceEpoch.current)
                setSourceLoading(false);
        }
    }, [canView, mode, purpose, values.source_id, meta, prefillInvoiceId, setInvoice, setSourceLoading, setConfirmOpen, setSourceError, setSourceReady, setSourceIdentity, setValues]);
    useEffect(() => { mounted.current = true; const epochs = [metaEpoch, pageEpoch, sourceEpoch, invoiceEpoch, documentEpoch]; return () => { mounted.current = false; epochs.forEach(e => ++e.current); }; }, []);
    useEffect(() => { if (legacyInvoice && canView)
        window.location.replace(moneyInCreateHref("invoice", moneyInListHref(browse), legacyInvoice)); }, [legacyInvoice, canView, browse]);
    useEffect(() => { const timer = window.setTimeout(() => void loadMeta(), 0); return () => window.clearTimeout(timer); }, [loadMeta]);
    useEffect(() => { const epoch = pageEpoch, timer = window.setTimeout(() => void loadPage(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadPage]);
    useEffect(() => { const epoch = documentEpoch, timer = window.setTimeout(() => void loadDocument(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadDocument]);
    useEffect(() => { const epoch = invoiceEpoch, timer = window.setTimeout(() => void loadInvoices(), 200); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadInvoices]);
    useEffect(() => { const epoch = sourceEpoch, timer = window.setTimeout(() => void loadSource(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadSource]);
    useEffect(() => { ++navEpoch.current; navBusy.current = false; }, [pageUrl, rawQuery]);
    useEffect(() => { invoiceNavBusy.current = false; }, [selectorKey]);
    useEffect(() => { if (mode !== "register" || browse.kind !== "payment")
        return; let active = true; void readPreviousAccountCursor(scope, { search: "", direction: "all", source_type: "", date_from: "", date_to: "", size: 20, page: browse.page, cursor: browse.cursor }).then(cursor => { if (active)
        setPrevious({ key: position, cursor }); }); return () => { active = false; }; }, [mode, browse.kind, scope, position, browse.page, browse.cursor]);
    const rows = pageState.key === pageUrl ? pageState.rows : null, pageLoading = pageState.key !== pageUrl || pageState.loading, pageError = pageState.key === pageUrl ? pageState.error : null, nextCursor = pageState.key === pageUrl ? pageState.next : null;
    useEffect(() => { if (mode === "register" && browse.focus && pageState.key === pageUrl && pageState.rows)
        window.document.getElementById(`money-in-row-${browse.focus}`)?.focus(); }, [mode, browse.focus, pageState.key, pageState.rows, pageUrl]);
    const hasPrevious = browse.page > 1 && previous?.key === position && previous.cursor !== undefined;
    function changeKind(kind: ReceiptKind) { ++navEpoch.current; navBusy.current = false; setPagingUrl(null); router.push(moneyInListHref({ kind }, financeContext)); }
    async function nextPage() { if (!nextCursor || pageLoading || navBusy.current)
        return; navBusy.current = true; setPagingUrl(pageUrl); const e = ++navEpoch.current; try {
        await rememberAccountCursorStep(scope, cursorBrowse, nextCursor);
        if (mounted.current && e === navEpoch.current)
            router.push(moneyInListHref({ ...browse, cursor: nextCursor, page: browse.page + 1, focus: "" }, financeContext));
    }
    catch {
        if (mounted.current && e === navEpoch.current) {
            navBusy.current = false;
            setPagingUrl(null);
            setPageState({ key: pageUrl, rows: null, next: null, loading: false, error: "Page navigation failed. Retry the register read." });
        }
    } }
    function previousPage() { if (hasPrevious && !pageLoading && !navBusy.current) {
        navBusy.current = true;
        setPagingUrl(pageUrl);
        router.push(moneyInListHref({ ...browse, cursor: previous!.cursor!, page: browse.page - 1, focus: "" }, financeContext));
    } }
    function change<K extends keyof MoneyInValues>(key: K, value: MoneyInValues[K]) { if (!canManage || mode !== "create" || inFlight.current || committed.current || ["create-uncertain", "create-confirmed", "issue-uncertain", "payment-uncertain"].includes(stageRef.current.status) || everUncertain.current)
        return; if (stageRef.current.status !== "idle" && ["source_id", "category_id", "relation_type", "relation_id"].includes(key))
        return; if (key === "source_id") {
        ++sourceEpoch.current;
        sourceRef.current = null;
        setSourceIdentity(null);
        setInvoice(null);
        setSourceReady(false);
        setSourceError(null);
        setSourceLoading(Boolean(value));
    } activeConfirmation.current = 0; setConfirmOpen(false); setValues(v => ({ ...v, [key]: value, ...(key === "source_id" ? { amount: "", account_id: "" } : {}), ...(key === "relation_type" ? { relation_id: "" } : {}) })); operation.current = null; setWriteError(null); }
    let formError: string | null = null;
    if (!meta || metaLoading)
        formError = "Load the finance selection data before recording a receipt.";
    else if (!account || !eligibleAccount(account) || account.currency !== currency)
        formError = "Select an active, matching-currency receiving account (not a credit card).";
    else if (moneyInAmount(values.amount) === null)
        formError = "Enter a positive amount whose cents can be represented safely.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date))
        formError = "Select the date received.";
    else if (values.reference.length > 180)
        formError = "Reference must be 180 characters or fewer.";
    else if (purpose === "advance" && !client)
        formError = "Select a client.";
    else if (purpose === "other" && (!category || !values.description.trim() || values.description.length > 500 || (values.relation_type && !related)))
        formError = "Select an income category, describe the receipt, and complete any business relationship.";
    else if (!["other", "advance"].includes(purpose) && (!sourceReady || sourceLoading || sourceError))
        formError = sourceError || "Verify the selected invoice or source first.";
    else if (invoice && (transferCents(values.amount) || BigInt(0)) > (transferCents(invoice.balance_due) || BigInt(0)))
        formError = "The amount exceeds the last verified invoice balance due.";
    const canContinue = !unknown && stage.status !== "confirmed" && !formError;
    function review() { if (!mounted.current || !canManage || !canView || mode !== "create" || inFlight.current || committed.current || ["create-uncertain", "create-confirmed", "issue-uncertain"].includes(stageRef.current.status))
        return; if (stageRef.current.status === "payment-uncertain" && operation.current || canContinue) {
        activeConfirmation.current = ++confirmationSequence.current;
        setConfirmationVersion(activeConfirmation.current);
        setWriteError(null);
        setConfirmOpen(true);
    } }
    function cancelReview() { if (!inFlight.current) { activeConfirmation.current = 0; setConfirmOpen(false); } }
    async function postMoneyIn() {
        if (!mounted.current || !canManage || !canView || mode !== "create" || !confirmOpen || !confirmationVersion || activeConfirmation.current !== confirmationVersion || inFlight.current || committed.current || ["create-uncertain", "create-confirmed", "issue-uncertain", "confirmed"].includes(stageRef.current.status) || (!canContinue && stageRef.current.status !== "payment-uncertain"))
            return;
        // A confirmation is a single-use intent, not a reusable render callback.
        activeConfirmation.current = 0;
        inFlight.current = true;
        setSaving(true);
        setWriteError(null);
        let active: "create" | "issue" | "payment" = "payment", classified = false;
        try {
            let currentInvoice = invoice;
            if (!["advance", "other"].includes(purpose) && !operation.current) {
                const identity = sourceRef.current;
                if (!identity)
                    throw new Error("Verify the source before recording.");
                if (!currentInvoice) {
                    active = "create";
                    classified = false;
                    const path = purpose === "project" ? `/api/finance/invoices/from-project/${encodeURIComponent(identity.id)}` : `/api/finance/invoices/from-order/${encodeURIComponent(identity.orderId)}`;
                    const r = await fetch(path, { method: "POST" });
                    classified = true;
                    if (r.ok)
                        setStage({ status: "create-confirmed", invoiceId: "", note: "Invoice creation was confirmed. Do not create another invoice if its response cannot be read." });
                    const b: unknown = await r.json().catch(() => null);
                    if (!mounted.current)
                        return;
                    if (!r.ok) {
                        if (!knownMoneyRejection(r.status, b))
                            setStage({ status: "create-uncertain", invoiceId: "", note: "Invoice creation may have completed. Read the source status; do not repeat creation." });
                        throw new Error(getApiErrorMessage(b, "Invoice creation was not confirmed."));
                    }
                    if (!isInvoice(b) || !invoiceMatches(b, identity))
                        throw new Error("Invoice creation was confirmed, but the returned identity could not be verified. Recover through read-only source status.");
                    currentInvoice = b;
                    setInvoice(b);
                    setStage({ status: "created", invoiceId: b.id, note: `Invoice ${b.invoice_number} was saved. Payment has not been recorded.` });
                }
                if (currentInvoice.status === "draft") {
                    active = "issue";
                    classified = false;
                    const id = currentInvoice.id;
                    const r = await fetch(`/api/finance/invoices/${encodeURIComponent(id)}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }) });
                    classified = true;
                    if (r.ok)
                        setStage({ status: "issue-uncertain", invoiceId: id, note: "Invoice issue was confirmed; read back its authoritative status before another action." });
                    const b: unknown = await r.json().catch(() => null);
                    if (!mounted.current)
                        return;
                    if (!r.ok) {
                        if (!knownMoneyRejection(r.status, b))
                            setStage({ status: "issue-uncertain", invoiceId: id, note: "Invoice issue may have completed. Verify status before continuing; do not issue again." });
                        throw new Error(getApiErrorMessage(b, "The invoice could not be issued. The saved draft is retained."));
                    }
                    if (!isInvoice(b) || b.id !== id || !invoiceMatches(b, identity) || !invoiceCollectible(b))
                        throw new Error("The issued invoice response could not be verified. Read its current status; do not issue it again.");
                    currentInvoice = b;
                    setInvoice(b);
                }
                if (!invoiceCollectible(currentInvoice))
                    throw new Error("The invoice is not currently collectible. Verify its current status.");
                setStage({ status: "issued", invoiceId: currentInvoice.id, note: `Invoice ${currentInvoice.invoice_number} is issued. Payment is a separate posting.` });
            }
            active = "payment";
            classified = false;
            if (!operation.current) {
                const p = moneyInPayload(purpose, values, currentInvoice?.id || "");
                operation.current = { key: window.crypto.randomUUID(), body: JSON.stringify(p.body), path: p.path, kind: p.kind, expectedCurrency: currency, expectedAccountCurrency: account!.currency };
            }
            const op = operation.current, r = await fetch(op.path, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body });
            classified = true;
            if (r.ok) {
                committed.current = true;
                setStage({ status: "confirmed", invoiceId: stageRef.current.invoiceId, note: "The server confirmed the receipt. Do not record it again, even if the result cannot be loaded." });
            }
            const b: unknown = await r.json().catch(() => null);
            if (!mounted.current)
                return;
            if (!r.ok) {
                if (everUncertain.current || !knownMoneyRejection(r.status, b)) {
                    everUncertain.current = true;
                    setStage({ status: "payment-uncertain", invoiceId: stageRef.current.invoiceId, note: "The receipt may already be recorded. The original payload and retry key are retained; a later rejection does not prove the earlier request failed." });
                }
                throw new Error(getApiErrorMessage(b, "Receipt posting was not confirmed."));
            }
            setConfirmOpen(false);
            navigation.markClean();
            const saved = asReceipt(op.kind, b), sent = JSON.parse(op.body) as Record<string, unknown>;
            const matching = saved && (saved.kind === "payment" ? saved.record.invoice_currency === op.expectedCurrency && saved.record.account_currency === op.expectedAccountCurrency && saved.record.invoice_id === sent.invoice_id && saved.record.account_id === sent.account_id && transferCents(saved.record.invoice_amount) === transferCents(String(sent.invoice_amount)) && transferCents(saved.record.account_amount) === transferCents(String(sent.invoice_amount)) && /^1(?:\.0{1,8})?$/.test(String(saved.record.exchange_rate)) : saved.record.currency === op.expectedCurrency && saved.record.financial_account_id === sent.financial_account_id && (saved.kind === "advance" ? saved.record.client_id === sent.client_id && transferCents(saved.record.original_amount) === transferCents(String(sent.amount)) : saved.record.category_ledger_account_id === sent.category_ledger_account_id && saved.record.source_type === sent.source_type && saved.record.source_id === sent.source_id && transferCents(saved.record.amount) === transferCents(String(sent.amount))));
            if (matching)
                setReceipt(saved);
            else
                setWriteError("The server confirmed the receipt, but its returned identity could not be verified. Verify history; do not post again.");
        }
        catch (error) {
            if (!mounted.current)
                return;
            if (!classified) {
                if (active === "create")
                    setStage({ status: "create-uncertain", invoiceId: "", note: "Invoice creation was interrupted and may still complete. Read status; never repeat this creation automatically." });
                else if (active === "issue")
                    setStage({ status: "issue-uncertain", invoiceId: stageRef.current.invoiceId || invoice?.id || "", note: "Invoice issue was interrupted and may still complete. Read status; do not repeat issue." });
                else if (operation.current && !committed.current) {
                    everUncertain.current = true;
                    setStage({ status: "payment-uncertain", invoiceId: stageRef.current.invoiceId, note: "The receipt outcome is uncertain. Keep this tab and verify history before an explicit same-operation retry." });
                }
            }
            setWriteError(error instanceof Error ? error.message : "Receipt could not be confirmed.");
            setConfirmOpen(false);
            if (committed.current)
                navigation.markClean();
        }
        finally {
            inFlight.current = false;
            if (mounted.current)
                setSaving(false);
        }
    }
    async function recoverSource() { if (!canView || inFlight.current || readRecovery.current || !sourceRef.current || !["create-uncertain", "create-confirmed", "issue-uncertain"].includes(stageRef.current.status))
        return; readRecovery.current = true; setSourceLoading(true); setWriteError(null); const identity = sourceRef.current, e = ++sourceEpoch.current; try {
        let id = stageRef.current.invoiceId;
        if (!id) {
            const state = await read(`/api/finance/orders/${encodeURIComponent(identity.orderId)}/settlement`);
            if (!record(state) || state.order_id !== identity.orderId || typeof state.invoice_id !== "string")
                throw new Error("No invoice identity was returned yet. This does not prove the earlier request failed. Do not repeat creation; verify again or seek support.");
            id = state.invoice_id;
        }
        const b = await read(`/api/finance/invoices/${encodeURIComponent(id)}`);
        if (!isInvoice(b) || b.id !== id || !invoiceMatches(b, identity))
            throw new Error("Recovered invoice does not match the retained source. Stop and verify it.");
        if (!mounted.current || e !== sourceEpoch.current)
            return;
        setInvoice(b);
        if (stageRef.current.status === "issue-uncertain" && b.status === "draft")
            throw new Error("The invoice is still draft at this read. The earlier issue request may still complete; do not repeat it.");
        if (b.status === "draft")
            setStage({ status: "created", invoiceId: b.id, note: "Saved draft recovered. Review again to issue this same invoice and record payment." });
        else if (invoiceCollectible(b))
            setStage({ status: "issued", invoiceId: b.id, note: "Issued invoice verified. Review again to record its payment; no second issue is needed." });
        else
            throw new Error("This invoice is now paid or cancelled. Do not post a replacement receipt; verify its history.");
    }
    catch (error) {
        if (mounted.current && e === sourceEpoch.current)
            setWriteError(error instanceof Error ? error.message : "Source recovery unavailable.");
    }
    finally {
        readRecovery.current = false;
        if (mounted.current && e === sourceEpoch.current)
            setSourceLoading(false);
    } }
    function openReceipt() { if (!committed.current)
        return; navigation.navigate(receipt ? moneyInReceiptHref(receipt.kind, receipt.record.id, returnHref) : returnHref, { discard: true, replace: true }); }
    const historyLoading = browse.page > 1 && previous?.key !== position;
    return { mode, canView, canManage, purpose, browse, returnHref, listHref, rows, pageLoading, pageError, nextCursor, hasPrevious, historyLoading, paging, nextPage, previousPage, changeKind, loadPage, document, documentLoading, documentError, loadDocument, meta, metaLoading, metaError, loadMeta, categories, values, change, invoice, sourceLoading, sourceError, loadSource, sourceLabel, currency, account, category, compatibleAccounts, invoicePage, invoiceSearch, setInvoiceSearch: (s: string) => { ++invoiceEpoch.current; invoiceNavBusy.current = false; setInvoicePagingKey(null); setInvoicePage(null); setInvoicesLoading(true); setInvoiceSearchState(s); setInvoiceCursor(""); setInvoiceHistory([]); }, loadInvoices, invoicesLoading: invoicesLoading || invoiceNavigating, invoiceError, nextInvoices: () => { if (invoicePage?.next_cursor && !invoicesLoading && !invoiceNavBusy.current) {
            invoiceNavBusy.current = true;
            setInvoicePagingKey(selectorKey);
            setInvoicesLoading(true);
            setInvoicePage(null);
            setInvoiceHistory(h => [...h, invoiceCursor]);
            setInvoiceCursor(invoicePage.next_cursor);
        } }, previousInvoices: () => { if (invoiceHistory.length && !invoicesLoading && !invoiceNavBusy.current) {
            invoiceNavBusy.current = true;
            setInvoicePagingKey(selectorKey);
            setInvoicesLoading(true);
            setInvoicePage(null);
            setInvoiceCursor(invoiceHistory.at(-1)!);
            setInvoiceHistory(h => h.slice(0, -1));
        } }, hasPreviousInvoices: invoiceHistory.length > 0, formError, stage, saving, confirmOpen, review, cancelReview, postMoneyIn, recoverSource, receipt, writeError, dirty, unknown, canContinue, locked: unknown || saving || stage.status === "confirmed", sourceLocked: stage.status !== "idle", openReceipt, back: () => mode === "create" ? navigation.navigate(returnHref) : router.push(returnHref), createHref: (p: Purpose) => moneyInCreateHref(p, listHref), receiptHref: (r: Receipt) => moneyInReceiptHref(r.kind, r.record.id, moneyInListHref({ ...browse, focus: r.record.id }, financeContext)), verificationHref: stage.invoiceId ? `${MONEY_IN_PATH}?filter_invoice=${encodeURIComponent(stage.invoiceId)}` : MONEY_IN_PATH };
}
export type MoneyInState = ReturnType<typeof useMoneyInWorkspace>;
