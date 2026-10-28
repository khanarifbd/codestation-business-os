"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { getApiErrorMessage } from "@/lib/api-error";
import { creditAmount, creditMaximum, creditPayload, creditToday, creditValidation, isCurrentAdvance, isReceivableAdvance, isReceivableInvoice, isReceivablePage, type CreditOperation, type CreditPhase, type CreditValues, type CurrentAdvance, type ReceivableAdvance, type ReceivableBrowse, type ReceivableInvoice, type ReceivablePage, type ReceivableRow } from "@/components/accounting-receivables/receivables-model";
import { creditApplyHref, receivableCollectHref, receivableInvoiceHref, receivablesBrowse, receivablesListHref, receivablesReadApi, safeReceivablesReturn } from "@/lib/receivables-navigation";
async function read(path: string): Promise<unknown> { const response = await fetch(path, { cache: "no-store" }), body: unknown = await response.json().catch(() => null); if (!response.ok)
    throw new Error(getApiErrorMessage(body, "Financial information is unavailable.")); return body; }
export function useReceivablesWorkspace() {
    const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), query = useSearchParams(), params = useParams<{
        invoiceId?: string;
    }>();
    const mode = pathname.endsWith("/apply-credit") ? "apply" : "register", invoiceId = params.invoiceId || "", rawQuery = query.toString();
    const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
    const browse = useMemo(() => receivablesBrowse(rawQuery), [rawQuery]), listHref = receivablesListHref(browse), returnHref = safeReceivablesReturn(query.get("returnTo")), pageUrl = receivablesReadApi(browse), pageIdentity = JSON.stringify([pageUrl, rawQuery]);
    const [pageState, setPageState] = useState<{
        key: string;
        data: ReceivablePage | null;
        loading: boolean;
        error: string | null;
    }>({ key: "", data: null, loading: true, error: null });
    const [invoice, setInvoice] = useState<ReceivableInvoice | null>(null), [advances, setAdvances] = useState<ReceivableAdvance[]>([]), [sourceLoading, setSourceLoading] = useState(true), [sourceError, setSourceError] = useState<string | null>(null);
    const [values, setValues] = useState<CreditValues>(() => ({ advance_id: "", amount: "", application_date: creditToday(tenant?.organization.timezone) }));
    const [initialSnapshot, setInitialSnapshot] = useState<CreditValues | null>(null);
    const [phase, setPhaseState] = useState<CreditPhase>("idle"), [saving, setSaving] = useState(false), [confirmOpen, setConfirmOpen] = useState(false), [confirmationVersion, setConfirmationVersion] = useState(0), [operationState, setOperationState] = useState<CreditOperation | null>(null), [writeError, setWriteError] = useState<string | null>(null);
    const [currentAdvance, setCurrentAdvance] = useState<CurrentAdvance | null>(null), [recoveryInvoice, setRecoveryInvoice] = useState<ReceivableInvoice | null>(null), [recoveryLoading, setRecoveryLoading] = useState(false), [recoveryError, setRecoveryError] = useState<string | null>(null);
    const [previous, setPrevious] = useState<{
        key: string;
        cursor: string | undefined;
    } | null>(null), [pagingState, setPagingState] = useState({ source: pageIdentity, pending: false });
    if (pagingState.source !== pageIdentity)
        setPagingState({ source: pageIdentity, pending: false });
    const paging = pagingState.source === pageIdentity && pagingState.pending;
    const mounted = useRef(true), pageEpoch = useRef(0), sourceEpoch = useRef(0), recoveryEpoch = useRef(0), navEpoch = useRef(0), navBusy = useRef(false), inFlight = useRef(false), readRecovery = useRef(false), phaseRef = useRef<CreditPhase>("idle"), valuesRef = useRef(values), sourceRef = useRef<{
        invoice: ReceivableInvoice;
        advances: ReceivableAdvance[];
    } | null>(null), initialValues = useRef<CreditValues | null>(null), operation = useRef<CreditOperation | null>(null), everUncertain = useRef(false), committed = useRef(false), confirmationSequence = useRef(0), activeConfirmation = useRef(0);
    const setPhase = (next: CreditPhase) => { phaseRef.current = next; activeConfirmation.current = 0; if (mounted.current)
        setPhaseState(next); };
    const dirty = mode === "apply" && phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(initialSnapshot || { advance_id: "", amount: "", application_date: values.application_date }));
    const navigation = useDocumentNavigationGuard(dirty, { enabled: mode === "apply", documentLabel: "credit application", isBusy: saving, pendingRef: inFlight, discardMessage: phase === "uncertain" ? "This customer-credit application may already be recorded. Leaving loses this tab’s retained operation key and original request. Verify the current company’s invoice and customer advance before recording a replacement; balance changes alone do not prove this operation. Leave anyway?" : undefined });
    const cursorBrowse = { search: browse.search, direction: "all" as const, source_type: `${browse.aging}|${browse.currency}`, date_from: "", date_to: "", size: 50, cursor: browse.cursor, page: browse.page };
    const scope = accountCursorHistoryScope(tenant?.organization.id || "", tenant?.membership_id || "", "receivables", cursorBrowse), position = JSON.stringify([scope, browse.page, browse.cursor]);
    const loadPage = useCallback(async () => { if (!canView || mode !== "register")
        return; const e = ++pageEpoch.current; setPageState({ key: pageUrl, data: null, loading: true, error: null }); try {
        const body = await read(pageUrl);
        if (!isReceivablePage(body))
            throw new Error("Receivable balances, summaries or cursor could not be verified.");
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, data: body, loading: false, error: null });
    }
    catch (reason) {
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, data: null, loading: false, error: reason instanceof Error ? reason.message : "Receivables unavailable." });
    } }, [canView, mode, pageUrl]);
    const loadSource = useCallback(async () => {
        if (!mounted.current || !canView || mode !== "apply" || !invoiceId || inFlight.current || phaseRef.current !== "idle")
            return;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        const e = ++sourceEpoch.current;
        sourceRef.current = null;
        setInvoice(null);
        setAdvances([]);
        setSourceLoading(true);
        setSourceError(null);
        try {
            const found = await read(`/api/finance/invoices/${encodeURIComponent(invoiceId)}`);
            if (!isReceivableInvoice(found) || found.id !== invoiceId)
                throw new Error("Invoice identity could not be verified.");
            const rows = await read(`/api/finance/receivable-advances?${new URLSearchParams({ client_id: found.client_id, currency: found.currency })}`);
            if (!Array.isArray(rows) || !rows.every(x => isReceivableAdvance(x) && x.currency === found.currency))
                throw new Error("Matching customer credit could not be verified.");
            if (!mounted.current || e !== sourceEpoch.current)
                return;
            sourceRef.current = { invoice: found, advances: rows };
            setInvoice(found);
            setAdvances(rows);
            if (initialValues.current === null) {
                const first = rows[0] || null, initial = { ...valuesRef.current, advance_id: first?.id || "", amount: creditMaximum(found, first) };
                valuesRef.current = initial;
                initialValues.current = initial;
                setInitialSnapshot(initial);
                setValues(initial);
            }
        }
        catch (reason) {
            if (mounted.current && e === sourceEpoch.current)
                setSourceError(reason instanceof Error ? reason.message : "Invoice or customer credit unavailable.");
        }
        finally {
            if (mounted.current && e === sourceEpoch.current)
                setSourceLoading(false);
        }
    }, [canView, mode, invoiceId]);
    useEffect(() => { mounted.current = true; const epochs = [pageEpoch, sourceEpoch, recoveryEpoch, navEpoch]; return () => { mounted.current = false; epochs.forEach(epoch => ++epoch.current); activeConfirmation.current = 0; }; }, []);
    useEffect(() => { const epoch = pageEpoch, timer = window.setTimeout(() => void loadPage(), browse.search ? 200 : 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadPage, browse.search]);
    useEffect(() => { const epoch = sourceEpoch, timer = window.setTimeout(() => void loadSource(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadSource]);
    useEffect(() => { ++navEpoch.current; navBusy.current = false; }, [pageUrl, rawQuery]);
    useEffect(() => { if (mode !== "register")
        return; let active = true; void readPreviousAccountCursor(scope, { search: "", direction: "all", source_type: "", date_from: "", date_to: "", size: 50, page: browse.page, cursor: browse.cursor }).then(cursor => { if (active)
        setPrevious({ key: position, cursor }); }); return () => { active = false; }; }, [mode, scope, position, browse.page, browse.cursor]);
    const page = pageState.key === pageUrl ? pageState.data : null, pageLoading = pageState.key !== pageUrl || pageState.loading, pageError = pageState.key === pageUrl ? pageState.error : null, nextCursor = page?.next_cursor || null;
    useEffect(() => { if (mode === "register" && browse.focus && page)
        window.document.getElementById(`receivable-row-${browse.focus}`)?.focus(); }, [mode, browse.focus, page]);
    const hasPrevious = browse.page > 1 && previous?.key === position && previous.cursor !== undefined, historyLoading = browse.page > 1 && previous?.key !== position;
    function changeFilters(next: Partial<Pick<ReceivableBrowse, "search" | "aging" | "currency">>) { ++navEpoch.current; navBusy.current = false; setPagingState({ source: pageIdentity, pending: false }); router.push(receivablesListHref({ ...browse, ...next, cursor: "", page: 1, focus: "" })); }
    async function nextPage() { if (!nextCursor || pageLoading || navBusy.current || !mounted.current)
        return; navBusy.current = true; setPagingState({ source: pageIdentity, pending: true }); const e = ++navEpoch.current; try {
        await rememberAccountCursorStep(scope, cursorBrowse, nextCursor);
        if (mounted.current && e === navEpoch.current)
            router.push(receivablesListHref({ ...browse, cursor: nextCursor, page: browse.page + 1, focus: "" }));
    }
    catch {
        if (mounted.current && e === navEpoch.current) {
            navBusy.current = false;
            setPagingState({ source: pageIdentity, pending: false });
        }
    } }
    function previousPage() { if (!hasPrevious || pageLoading || navBusy.current)
        return; navBusy.current = true; setPagingState({ source: pageIdentity, pending: true }); router.push(receivablesListHref({ ...browse, cursor: previous!.cursor!, page: browse.page - 1, focus: "" })); }
    function change<K extends keyof CreditValues>(key: K, value: CreditValues[K]) { if (!mounted.current || !canView || !canManage || mode !== "apply" || inFlight.current || committed.current || everUncertain.current)
        return; activeConfirmation.current = 0; setConfirmOpen(false); operation.current = null; setOperationState(null); setWriteError(null); const next = { ...valuesRef.current, [key]: value }; if (key === "advance_id")
        next.amount = creditMaximum(sourceRef.current?.invoice || null, sourceRef.current?.advances.find(a => a.id === value) || null); valuesRef.current = next; setValues(next); }
    const selectedAdvance = advances.find(a => a.id === values.advance_id) || null, maximum = creditMaximum(invoice, selectedAdvance), formError = creditValidation(values, invoice, selectedAdvance), locked = saving || phase !== "idle", canContinue = canView && canManage && mode === "apply" && !saving && phase !== "confirmed" && (phase === "uncertain" ? Boolean(operationState) : !sourceLoading && !sourceError && !formError);
    function review() {
        if (!mounted.current || !canView || !canManage || mode !== "apply" || inFlight.current || readRecovery.current || committed.current)
            return;
        if (!everUncertain.current) {
            const source = sourceRef.current, current = valuesRef.current, selected = source?.advances.find(a => a.id === current.advance_id) || null, error = creditValidation(current, source?.invoice || null, selected);
            if (error || !source || !selected) {
                setWriteError(error);
                return;
            }
            const payload = creditPayload(current, source.invoice.id)!;
            const body = JSON.stringify(payload);
            if (!operation.current || operation.current.body !== body || operation.current.advanceId !== selected.id)
                operation.current = { key: window.crypto.randomUUID(), body, advanceId: selected.id, invoiceId: source.invoice.id, clientId: source.invoice.client_id, currency: source.invoice.currency, invoiceNumber: source.invoice.invoice_number, clientName: source.invoice.client_name, amount: creditAmount(current.amount)!.text, applicationDate: current.application_date, advanceDate: selected.advance_date };
        }
        if (!operation.current)
            return;
        setOperationState(operation.current);
        setWriteError(null);
        activeConfirmation.current = ++confirmationSequence.current;
        setConfirmationVersion(activeConfirmation.current);
        setConfirmOpen(true);
    }
    function cancelReview() { if (!inFlight.current && activeConfirmation.current === confirmationVersion) {
        activeConfirmation.current = 0;
        setConfirmOpen(false);
    } }
    async function postApply() {
        if (!mounted.current || !canView || !canManage || mode !== "apply" || inFlight.current || committed.current || !confirmOpen || !confirmationVersion || activeConfirmation.current !== confirmationVersion || !operation.current)
            return;
        activeConfirmation.current = 0;
        inFlight.current = true;
        const op = operation.current;
        setSaving(true);
        setWriteError(null);
        try {
            const response = await fetch(`/api/accounting/customer-advances/${encodeURIComponent(op.advanceId)}/apply`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": op.key }, body: op.body });
            if (response.ok) {
                committed.current = true;
                setPhase("confirmed");
                const body: unknown = await response.json().catch(() => null);
                if (!mounted.current)
                    return;
                if (isCurrentAdvance(body) && body.id === op.advanceId && body.client_id === op.clientId && body.currency === op.currency)
                    setCurrentAdvance(body);
                else
                    setRecoveryError("The server confirmed the application, but its current advance record could not be verified. Do not submit again.");
            }
            else {
                const body: unknown = await response.json().catch(() => null);
                const definitive = [400, 401, 403, 404, 422].includes(response.status);
                if (!definitive || everUncertain.current) {
                    everUncertain.current = true;
                    setPhase("uncertain");
                }
                if (mounted.current)
                    setWriteError(getApiErrorMessage(body, "The credit application could not be confirmed.") + (everUncertain.current ? " The outcome remains uncertain. Retain the original request and key; a later rejection does not prove the earlier attempt failed." : " Your inputs remain available."));
            }
        }
        catch (reason) {
            everUncertain.current = true;
            setPhase("uncertain");
            if (mounted.current)
                setWriteError(`${reason instanceof Error ? reason.message : "Response unavailable."} The application may already be recorded. Verify before any replacement; retry only the retained operation.`);
        }
        finally {
            inFlight.current = false;
            if (mounted.current) {
                setSaving(false);
                setConfirmOpen(false);
            }
        }
    }
    async function refreshCurrentDocuments() {
        const op = operation.current;
        if (!mounted.current || !canView || !op || inFlight.current || readRecovery.current || phaseRef.current === "idle")
            return;
        readRecovery.current = true;
        const e = ++recoveryEpoch.current;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        setRecoveryLoading(true);
        setRecoveryError(null);
        setCurrentAdvance(null);
        setRecoveryInvoice(null);
        try {
            const [inv, advance] = await Promise.all([read(`/api/finance/invoices/${encodeURIComponent(op.invoiceId)}`), read(`/api/accounting/customer-advances/${encodeURIComponent(op.advanceId)}`)]);
            if (!isReceivableInvoice(inv) || inv.id !== op.invoiceId || inv.client_id !== op.clientId || inv.currency !== op.currency || !isCurrentAdvance(advance) || advance.id !== op.advanceId || advance.client_id !== op.clientId || advance.currency !== op.currency)
                throw new Error("Current document identities could not be verified.");
            if (mounted.current && e === recoveryEpoch.current) {
                setRecoveryInvoice(inv);
                setCurrentAdvance(advance);
            }
        }
        catch (reason) {
            if (mounted.current && e === recoveryEpoch.current)
                setRecoveryError(reason instanceof Error ? reason.message : "Current documents unavailable.");
        }
        finally {
            readRecovery.current = false;
            if (mounted.current && e === recoveryEpoch.current)
                setRecoveryLoading(false);
        }
    }
    return { mode, canView, canManage, browse, listHref, returnHref, page, pageLoading, pageError, nextCursor, paging, hasPrevious, historyLoading, loadPage, nextPage, previousPage, changeFilters, resetFilters: () => changeFilters({ search: "", aging: "all", currency: "" }), invoice, advances, sourceLoading, sourceError, loadSource, values, change, selectedAdvance, maximum, formError, phase, saving, confirmOpen, review, cancelReview, postApply, writeError, operation: operationState, currentAdvance, recoveryInvoice, recoveryLoading, recoveryError, refreshCurrentDocuments, canContinue, locked, back: () => navigation.navigate(returnHref), applyHref: (row: ReceivableRow) => creditApplyHref(row.id, receivablesListHref({ ...browse, focus: row.id })), invoiceHref: receivableInvoiceHref, collectHref: receivableCollectHref };
}
export type ReceivablesState = ReturnType<typeof useReceivablesWorkspace>;
