"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { getApiErrorMessage } from "@/lib/api-error";
import { transferCents } from "@/components/accounting-transfers/transfer-model";
import { billPayload, billValidation, centsText, effectiveTax, initialBillValues, initialPaymentValues, isAccounts, isBill, isCategories, isPayment, isPayablesPage, isTaxCodes, isVendors, payableBillPreview, paymentPayload, paymentValidation, record, type Bill, type BillValues, type Payment, type PaymentValues, type PayablesBrowse, type PayablesMeta, type PayablesOperation, type PayablesPage } from "@/components/accounting-payables/payables-model";
import { payableCreateHref, payableDetailHref, payablePayHref, payablesBrowse, payablesListHref, payablesReadApi, safePayablesReturn } from "@/lib/payables-navigation";
type Phase = "idle" | "uncertain" | "confirmed";
async function read(path: string): Promise<unknown> { const response = await fetch(path, { cache: "no-store" }), body: unknown = await response.json().catch(() => null); if (!response.ok)
    throw new Error(getApiErrorMessage(body, "Payables information is unavailable.")); return body; }
const clean = (value: unknown) => typeof value === "string" ? value.trim() || null : null;
function matchesCreatedBill(bill: Bill, op: PayablesOperation) { const p = JSON.parse(op.body) as ReturnType<typeof billPayload>, a = op.preview; if (!p || !a)
    return false; return !bill.purchase_receipt_id && bill.supplier_name === p.supplier_name.trim() && bill.bill_date === p.bill_date && bill.due_date === p.due_date && bill.currency === op.currency && bill.expense_ledger_account_id === p.expense_ledger_account_id && bill.description === p.description.trim() && bill.tax_code_id === p.tax_code_id && bill.withholding_tax_code_id === p.withholding_tax_code_id && clean(bill.reference) === clean(p.reference) && clean(bill.notes) === clean(p.notes) && [[bill.subtotal_amount, a.subtotal], [bill.input_tax_amount, a.inputTax], [bill.recoverable_tax_amount, a.recoverableTax], [bill.withholding_tax_amount, a.withholdingTax], [bill.original_amount, a.grossBill], [bill.net_payable_amount, a.netPayable]].every(([x, y]) => transferCents(x) === transferCents(y)); }
function matchesPayment(payment: Payment, op: PayablesOperation) { const p = JSON.parse(op.body) as ReturnType<typeof paymentPayload>; return Boolean(p && payment.bill_id === op.billId && payment.financial_account_id === p.financial_account_id && payment.currency === op.currency && payment.payment_date === p.payment_date && transferCents(payment.amount) === transferCents(op.amount) && clean(payment.reference) === clean(p.reference) && clean(payment.notes) === clean(p.notes)); }
export function usePayablesWorkspace() {
    const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), query = useSearchParams(), params = useParams<{
        billId?: string;
    }>();
    const defaultCurrency = tenant?.organization.currency || "";
    const mode = pathname.endsWith("/new") ? "create" : pathname.endsWith("/pay") ? "pay" : params.billId ? "document" : "register", billId = params.billId || "", rawQuery = query.toString();
    const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage")), editing = mode === "create" || mode === "pay";
    const browse = useMemo(() => payablesBrowse(rawQuery), [rawQuery]), listHref = payablesListHref(browse), returnHref = safePayablesReturn(query.get("returnTo")), pageUrl = payablesReadApi(browse), pageIdentity = JSON.stringify([pageUrl, rawQuery]);
    const [pageState, setPageState] = useState<{
        key: string;
        data: PayablesPage | null;
        loading: boolean;
        error: string | null;
    }>({ key: "", data: null, loading: true, error: null });
    const [bill, setBill] = useState<Bill | null>(null), [documentLoading, setDocumentLoading] = useState(true), [documentError, setDocumentError] = useState<string | null>(null), [payments, setPayments] = useState<Payment[] | null>(null), [paymentsLoading, setPaymentsLoading] = useState(true), [paymentsError, setPaymentsError] = useState<string | null>(null);
    const [vendorWarning, setVendorWarning] = useState<string | null>(null);
    const [meta, setMeta] = useState<PayablesMeta | null>(null), [metaLoading, setMetaLoading] = useState(true), [metaError, setMetaError] = useState<string | null>(null), [billValues, setBillValues] = useState<BillValues>(initialBillValues), [paymentValues, setPaymentValues] = useState<PaymentValues>(initialPaymentValues), [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
    const [phase, setPhaseState] = useState<Phase>("idle"), [saving, setSaving] = useState(false), [confirmOpen, setConfirmOpen] = useState(false), [confirmationVersion, setConfirmationVersion] = useState(0), [operationState, setOperationState] = useState<PayablesOperation | null>(null), [writeError, setWriteError] = useState<string | null>(null);
    const [billIdentityVerified, setBillIdentityVerified] = useState(false);
    const [knownBillId, setKnownBillId] = useState(""), [knownPaymentId, setKnownPaymentId] = useState(""), [confirmedBill, setConfirmedBill] = useState<Bill | null>(null), [confirmedPayment, setConfirmedPayment] = useState<Payment | null>(null), [recoveryLoading, setRecoveryLoading] = useState(false), [recoveryError, setRecoveryError] = useState<string | null>(null);
    const [previous, setPrevious] = useState<{
        key: string;
        cursor: string | undefined;
    } | null>(null), [pagingState, setPagingState] = useState({ source: pageIdentity, pending: false });
    if (pagingState.source !== pageIdentity)
        setPagingState({ source: pageIdentity, pending: false });
    const mounted = useRef(true), pageEpoch = useRef(0), documentEpoch = useRef(0), paymentsEpoch = useRef(0), metaEpoch = useRef(0), recoveryEpoch = useRef(0), navEpoch = useRef(0), navBusy = useRef(false), inFlight = useRef(false), readRecovery = useRef(false), phaseRef = useRef<Phase>("idle"), initialised = useRef(false), dataRef = useRef<{
        bill: Bill | null;
        meta: PayablesMeta | null;
    }>({ bill: null, meta: null }), billRef = useRef(billValues), paymentRef = useRef(paymentValues), operation = useRef<PayablesOperation | null>(null), everUncertain = useRef(false), committed = useRef(false), confirmationSequence = useRef(0), activeConfirmation = useRef(0), knownBill = useRef(""), verifiedBill = useRef(""), knownPayment = useRef("");
    const setPhase = (next: Phase) => { phaseRef.current = next; activeConfirmation.current = 0; if (mounted.current)
        setPhaseState(next); };
    const values = mode === "create" ? billValues : paymentValues, blank = mode === "create" ? initialBillValues() : initialPaymentValues(), dirty = editing && phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== (initialSnapshot || JSON.stringify(blank)));
    const navigation = useDocumentNavigationGuard(dirty, { enabled: editing, documentLabel: "payable", isBusy: saving, pendingRef: inFlight, discardMessage: phase === "uncertain" ? mode === "create" ? "This vendor bill may already be recorded. Bill creation has no replay key; do not create a replacement until the current company’s records are verified. Leaving loses this tab’s original request. Leave anyway?" : "This supplier payment may already be recorded. Leaving loses the original body and retry key. Verify the current company’s bill payment history before recording any replacement. Leave anyway?" : undefined });
    const cursorBrowse = { search: browse.search, direction: "all" as const, source_type: `${browse.status}|${browse.currency}`, date_from: "", date_to: "", size: 50, cursor: browse.cursor, page: browse.page }, scope = accountCursorHistoryScope(tenant?.organization.id || "", tenant?.membership_id || "", "payables", cursorBrowse), position = JSON.stringify([scope, browse.page, browse.cursor]);
    const loadPage = useCallback(async () => { if (!canView || mode !== "register")
        return; const e = ++pageEpoch.current; setPageState({ key: pageUrl, data: null, loading: true, error: null }); try {
        const p = await read(pageUrl);
        if (!isPayablesPage(p))
            throw new Error("Payables balances, dates, summaries or cursor could not be verified.");
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, data: p, loading: false, error: null });
    }
    catch (reason) {
        if (mounted.current && e === pageEpoch.current)
            setPageState({ key: pageUrl, data: null, loading: false, error: reason instanceof Error ? reason.message : "Payables unavailable." });
    } }, [canView, mode, pageUrl]);
    const loadDocument = useCallback(async () => { if (!mounted.current || !canView || mode !== "document" || !billId)
        return; const e = ++documentEpoch.current; setBill(null); setDocumentLoading(true); setDocumentError(null); try {
        const b = await read(`/api/accounting/payables/${encodeURIComponent(billId)}`);
        if (!isBill(b) || b.id !== billId)
            throw new Error("Bill identity could not be verified.");
        if (mounted.current && e === documentEpoch.current)
            setBill(b);
    }
    catch (reason) {
        if (mounted.current && e === documentEpoch.current)
            setDocumentError(reason instanceof Error ? reason.message : "Bill unavailable.");
    }
    finally {
        if (mounted.current && e === documentEpoch.current)
            setDocumentLoading(false);
    } }, [canView, mode, billId]);
    const loadPayments = useCallback(async () => { if (!mounted.current || !canView || mode !== "document" || !billId)
        return; const e = ++paymentsEpoch.current; setPayments(null); setPaymentsLoading(true); setPaymentsError(null); try {
        const p = await read(`/api/accounting/payables/${encodeURIComponent(billId)}/payments`);
        if (!Array.isArray(p) || !p.every(x => isPayment(x) && x.bill_id === billId))
            throw new Error("Complete bill payment history could not be verified.");
        if (mounted.current && e === paymentsEpoch.current)
            setPayments(p);
    }
    catch (reason) {
        if (mounted.current && e === paymentsEpoch.current)
            setPaymentsError(reason instanceof Error ? reason.message : "Payment history unavailable.");
    }
    finally {
        if (mounted.current && e === paymentsEpoch.current)
            setPaymentsLoading(false);
    } }, [canView, mode, billId]);
    const loadMeta = useCallback(async () => {
        if (!mounted.current || !canView || !editing || inFlight.current || phaseRef.current !== "idle")
            return;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        const e = ++metaEpoch.current;
        dataRef.current = { bill: null, meta: null };
        setMeta(null);
        setMetaLoading(true);
        setMetaError(null);
        setVendorWarning(null);
        if (mode === "pay") {
            setBill(null);
            setDocumentLoading(true);
            setDocumentError(null);
        }
        try {
            const day = await read("/api/accounting/payables/workspace?limit=1&status=open");
            if (!isPayablesPage(day))
                throw new Error("The company business date could not be verified.");
            let loaded: PayablesMeta = { categories: [], accounts: [], vendors: [], taxes: [], businessDate: day.business_date, currency: defaultCurrency }, found: Bill | null = null;
            if (mode === "create") {
                const [categories, taxes, vendors] = await Promise.all([read("/api/accounting/chart-of-accounts"), read("/api/accounting/tax/codes"), read("/api/finance/expense-meta-lite").catch(() => null)]);
                if (!isCategories(categories) || !isTaxCodes(taxes))
                    throw new Error("Bill categories or tax codes could not be verified.");
                const suggestions = record(vendors) && isVendors(vendors.vendors) ? vendors.vendors : null;
                if (!suggestions && mounted.current && e === metaEpoch.current)
                    setVendorWarning("Supplier suggestions are unavailable. Enter the supplier name directly; no vendor record is created or linked by this bill.");
                loaded = { ...loaded, categories: categories.filter(c => c.is_active && c.category === "expense"), taxes, vendors: (suggestions || []).filter(v => v.is_active) };
            }
            else {
                const [accounts, b] = await Promise.all([read("/api/finance/accounts"), read(`/api/accounting/payables/${encodeURIComponent(billId)}`)]);
                if (!isAccounts(accounts) || !isBill(b) || b.id !== billId)
                    throw new Error("Bill or financial account identities could not be verified.");
                loaded = { ...loaded, accounts };
                found = b;
            }
            if (!mounted.current || e !== metaEpoch.current)
                return;
            dataRef.current = { bill: found, meta: loaded };
            setMeta(loaded);
            if (found)
                setBill(found);
            if (!initialised.current) {
                initialised.current = true;
                if (mode === "create") {
                    const next = { ...billRef.current, bill_date: loaded.businessDate, currency: loaded.currency };
                    billRef.current = next;
                    setBillValues(next);
                    setInitialSnapshot(JSON.stringify(next));
                }
                else {
                    const next = { ...paymentRef.current, payment_date: loaded.businessDate, amount: found ? String(found.balance_due) : "" };
                    paymentRef.current = next;
                    setPaymentValues(next);
                    setInitialSnapshot(JSON.stringify(next));
                }
            }
        }
        catch (reason) {
            if (mounted.current && e === metaEpoch.current) {
                setMetaError(reason instanceof Error ? reason.message : "Payables setup unavailable.");
                if (mode === "pay")
                    setDocumentError("Bill and account setup are unavailable.");
            }
        }
        finally {
            if (mounted.current && e === metaEpoch.current) {
                setMetaLoading(false);
                if (mode === "pay")
                    setDocumentLoading(false);
            }
        }
    }, [canView, editing, mode, billId, defaultCurrency]);
    useEffect(() => { mounted.current = true; const epochs = [pageEpoch, documentEpoch, paymentsEpoch, metaEpoch, recoveryEpoch, navEpoch]; return () => { mounted.current = false; epochs.forEach(e => ++e.current); activeConfirmation.current = 0; }; }, []);
    useEffect(() => { const epoch = pageEpoch, timer = window.setTimeout(() => void loadPage(), browse.search ? 200 : 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadPage, browse.search]);
    useEffect(() => { const epoch = documentEpoch, timer = window.setTimeout(() => void loadDocument(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadDocument]);
    useEffect(() => { const epoch = paymentsEpoch, timer = window.setTimeout(() => void loadPayments(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadPayments]);
    useEffect(() => { const epoch = metaEpoch, timer = window.setTimeout(() => void loadMeta(), 0); return () => { window.clearTimeout(timer); ++epoch.current; }; }, [loadMeta]);
    useEffect(() => { ++navEpoch.current; navBusy.current = false; }, [pageUrl, rawQuery]);
    useEffect(() => { if (mode !== "register")
        return; let active = true; void readPreviousAccountCursor(scope, { search: "", direction: "all", source_type: "", date_from: "", date_to: "", size: 50, page: browse.page, cursor: browse.cursor }).then(cursor => { if (active)
        setPrevious({ key: position, cursor }); }); return () => { active = false; }; }, [mode, scope, position, browse.page, browse.cursor]);
    const page = pageState.key === pageUrl ? pageState.data : null, pageLoading = pageState.key !== pageUrl || pageState.loading, pageError = pageState.key === pageUrl ? pageState.error : null, nextCursor = page?.next_cursor || null, paging = pagingState.source === pageIdentity && pagingState.pending, hasPrevious = browse.page > 1 && previous?.key === position && previous.cursor !== undefined, historyLoading = browse.page > 1 && previous?.key !== position;
    useEffect(() => { if (mode === "register" && browse.focus && page)
        window.document.getElementById(`payable-row-${browse.focus}`)?.focus(); }, [mode, browse.focus, page]);
    function changeFilters(next: Partial<Pick<PayablesBrowse, "search" | "status" | "currency">>) { ++navEpoch.current; navBusy.current = false; setPagingState({ source: pageIdentity, pending: false }); router.push(payablesListHref({ ...browse, ...next, cursor: "", page: 1, focus: "" })); }
    async function nextPage() { if (!nextCursor || pageLoading || navBusy.current || !mounted.current)
        return; navBusy.current = true; setPagingState({ source: pageIdentity, pending: true }); const e = ++navEpoch.current; try {
        await rememberAccountCursorStep(scope, cursorBrowse, nextCursor);
        if (mounted.current && e === navEpoch.current)
            router.push(payablesListHref({ ...browse, cursor: nextCursor, page: browse.page + 1, focus: "" }));
    }
    catch {
        if (mounted.current && e === navEpoch.current) {
            navBusy.current = false;
            setPagingState({ source: pageIdentity, pending: false });
        }
    } }
    function previousPage() { if (!hasPrevious || pageLoading || navBusy.current)
        return; navBusy.current = true; setPagingState({ source: pageIdentity, pending: true }); router.push(payablesListHref({ ...browse, cursor: previous!.cursor!, page: browse.page - 1, focus: "" })); }
    function editable() { return mounted.current && canView && canManage && editing && !inFlight.current && !committed.current && !everUncertain.current; }
    function invalidateConfirmation() { activeConfirmation.current = 0; setConfirmOpen(false); operation.current = null; setOperationState(null); setWriteError(null); }
    function changeBill<K extends keyof BillValues>(key: K, value: BillValues[K]) { if (!editable() || mode !== "create")
        return; invalidateConfirmation(); const next = { ...billRef.current, [key]: value }; if (key === "bill_date") {
        if (next.due_date && next.due_date < value)
            next.due_date = "";
        if (!effectiveTax(dataRef.current.meta?.taxes.find(t => t.id === next.tax_code_id), value))
            next.tax_code_id = "";
        if (!effectiveTax(dataRef.current.meta?.taxes.find(t => t.id === next.withholding_tax_code_id), value))
            next.withholding_tax_code_id = "";
    } billRef.current = next; setBillValues(next); }
    function changePayment<K extends keyof PaymentValues>(key: K, value: PaymentValues[K]) { if (!editable() || mode !== "pay")
        return; invalidateConfirmation(); const next = { ...paymentRef.current, [key]: value }; paymentRef.current = next; setPaymentValues(next); }
    const selectedCategory = meta?.categories.find(c => c.id === billValues.expense_ledger_account_id) || null, selectedPurchaseTax = meta?.taxes.find(t => t.id === billValues.tax_code_id) || null, selectedWithholdingTax = meta?.taxes.find(t => t.id === billValues.withholding_tax_code_id) || null, selectedAccount = meta?.accounts.find(a => a.id === paymentValues.financial_account_id) || null, compatibleAccounts = (meta?.accounts || []).filter(a => a.is_active && a.currency === bill?.currency), purchaseTaxes = (meta?.taxes || []).filter(t => t.tax_kind === "purchase" && effectiveTax(t, billValues.bill_date)), withholdingTaxes = (meta?.taxes || []).filter(t => t.tax_kind === "withholding" && effectiveTax(t, billValues.bill_date)), preview = payableBillPreview(billValues, meta?.taxes || []), formError = mode === "create" ? billValidation(billValues, meta) : paymentValidation(paymentValues, bill, selectedAccount), locked = saving || phase !== "idle", canContinue = canView && canManage && editing && !saving && phase !== "confirmed" && (phase === "uncertain" ? mode === "pay" && Boolean(operationState) : !metaLoading && !metaError && !formError);
    function review() {
        if (!mounted.current || !canView || !canManage || !editing || inFlight.current || readRecovery.current || committed.current || everUncertain.current && mode === "create")
            return;
        if (!everUncertain.current) {
            const data = dataRef.current;
            if (mode === "create") {
                const v = billRef.current, error = billValidation(v, data.meta), p = billPayload(v), a = payableBillPreview(v, data.meta?.taxes || []).amounts;
                if (error || !p || !a) {
                    setWriteError(error || "Bill amounts could not be verified.");
                    return;
                }
                operation.current = { kind: "bill", key: null, body: JSON.stringify(p), currency: v.currency, amount: a.netPayable, billId: "", billNumber: "New vendor bill", supplierName: v.supplier_name, accountName: "", accountType: "", categoryName: data.meta!.categories.find(c => c.id === v.expense_ledger_account_id)!.name, date: v.bill_date, dueDate: v.due_date, reference: v.reference, notes: v.notes, preview: a, beforeBalance: "0", beforeAccountBalance: "0" };
            }
            else {
                const v = paymentRef.current, account = data.meta?.accounts.find(a => a.id === v.financial_account_id) || null, error = paymentValidation(v, data.bill, account), p = paymentPayload(v);
                if (error || !p || !data.bill || !account) {
                    setWriteError(error);
                    return;
                }
                const body = JSON.stringify(p);
                if (!operation.current || operation.current.body !== body)
                    operation.current = { kind: "payment", key: window.crypto.randomUUID(), body, currency: data.bill.currency, amount: centsText(transferCents(p.amount)!), billId: data.bill.id, billNumber: data.bill.bill_number, supplierName: data.bill.supplier_name, accountName: account.name, accountType: account.account_type, categoryName: data.bill.expense_ledger_account_name, date: v.payment_date, dueDate: "", reference: v.reference, notes: v.notes, preview: null, beforeBalance: data.bill.balance_due, beforeAccountBalance: account.current_balance };
            }
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
    async function postOperation() {
        if (!mounted.current || !canView || !canManage || !editing || inFlight.current || committed.current || !confirmOpen || !confirmationVersion || activeConfirmation.current !== confirmationVersion || !operation.current || everUncertain.current && mode === "create")
            return;
        activeConfirmation.current = 0;
        inFlight.current = true;
        const op = operation.current;
        setSaving(true);
        setWriteError(null);
        try {
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (op.key)
                headers["Idempotency-Key"] = op.key;
            const response = await fetch(op.kind === "bill" ? "/api/accounting/payables" : `/api/accounting/payables/${encodeURIComponent(op.billId)}/payments`, { method: "POST", headers, body: op.body });
            if (response.ok) {
                committed.current = true;
                setPhase("confirmed");
                const body: unknown = await response.json().catch(() => null);
                if (!mounted.current)
                    return;
                if (op.kind === "bill") {
                    if (record(body) && typeof body.id === "string" && body.id && body.id.length < 300) {
                        knownBill.current = body.id;
                        setKnownBillId(body.id);
                    }
                    if (isBill(body) && matchesCreatedBill(body, op)) {
                        verifiedBill.current = body.id;
                        setBillIdentityVerified(true);
                        setConfirmedBill(body);
                    }
                    else
                        setRecoveryError("Bill creation was confirmed, but the returned bill could not be verified. Do not create it again.");
                }
                else {
                    knownBill.current = op.billId;
                    verifiedBill.current = op.billId;
                    setKnownBillId(op.billId);
                    setBillIdentityVerified(true);
                    if (isPayment(body) && matchesPayment(body, op)) {
                        knownPayment.current = body.id;
                        setKnownPaymentId(body.id);
                    }
                    else
                        setRecoveryError("Payment was confirmed, but its identity could not be verified. Inspect the complete current bill history; do not submit again.");
                }
            }
            else {
                const body: unknown = await response.json().catch(() => null), definitive = [400, 401, 403, 404, 422].includes(response.status);
                if (!definitive || everUncertain.current) {
                    everUncertain.current = true;
                    setPhase("uncertain");
                }
                if (mounted.current)
                    setWriteError(getApiErrorMessage(body, "The posting could not be confirmed.") + (everUncertain.current ? op.kind === "bill" ? " This unkeyed bill request may already be recorded. Do not repeat it; verify the company register before any replacement." : " The outcome remains uncertain; keep the original body/key even after a later rejection." : " Inputs remain available for correction."));
            }
        }
        catch (reason) {
            everUncertain.current = true;
            setPhase("uncertain");
            if (mounted.current)
                setWriteError(`${reason instanceof Error ? reason.message : "Response unavailable."} ${op.kind === "bill" ? "This bill may already be recorded. Creation has no replay key and will not be repeated here." : "This supplier payment may already be recorded. Verify before a replacement; only the retained operation can be retried."}`);
        }
        finally {
            inFlight.current = false;
            if (mounted.current) {
                setSaving(false);
                setConfirmOpen(false);
            }
        }
    }
    async function refreshCurrentRecords() {
        const op = operation.current, id = knownBill.current || op?.billId;
        if (!mounted.current || !canView || !op || !id || inFlight.current || readRecovery.current || phaseRef.current === "idle")
            return;
        activeConfirmation.current = 0;
        setConfirmOpen(false);
        readRecovery.current = true;
        const e = ++recoveryEpoch.current;
        setRecoveryLoading(true);
        setRecoveryError(null);
        setConfirmedBill(null);
        setConfirmedPayment(null);
        setPayments(null);
        try {
            const [b, p] = await Promise.all([read(`/api/accounting/payables/${encodeURIComponent(id)}`), read(`/api/accounting/payables/${encodeURIComponent(id)}/payments`)]);
            if (!isBill(b) || b.id !== id || b.currency !== op.currency || op.kind === "bill" && !matchesCreatedBill(b, op) || !Array.isArray(p) || !p.every(x => isPayment(x) && x.bill_id === id))
                throw new Error("Current bill or complete payment history could not be verified.");
            const matched = knownPayment.current ? p.find(x => x.id === knownPayment.current) : null;
            if (matched && !matchesPayment(matched, op))
                throw new Error("The known payment does not match the original request.");
            if (!mounted.current || e !== recoveryEpoch.current)
                return;
            verifiedBill.current = b.id;
            setBillIdentityVerified(true);
            setConfirmedBill(b);
            setPayments(p);
            if (matched)
                setConfirmedPayment(matched);
            else if (op.kind === "payment" && knownPayment.current)
                setRecoveryError("The known payment is absent from the returned complete history. Its current status is not verified; do not repost.");
        }
        catch (reason) {
            if (mounted.current && e === recoveryEpoch.current)
                setRecoveryError(reason instanceof Error ? reason.message : "Current records unavailable.");
        }
        finally {
            readRecovery.current = false;
            if (mounted.current && e === recoveryEpoch.current)
                setRecoveryLoading(false);
        }
    }
    return { verificationHref: payablesListHref({ status: "all", search: operationState?.reference || operationState?.supplierName || "", currency: operationState?.currency || "" }), mode, canView, canManage, browse, listHref, returnHref, page, pageLoading, pageError, nextCursor, paging, hasPrevious, historyLoading, loadPage, nextPage, previousPage, changeFilters, resetFilters: () => changeFilters({ search: "", status: "open", currency: "" }), bill, documentLoading, documentError, loadDocument, payments, paymentsLoading, paymentsError, loadPayments, meta, metaLoading, metaError, vendorWarning, loadMeta, billValues, changeBill, paymentValues, changePayment, preview, selectedCategory, selectedPurchaseTax, selectedWithholdingTax, selectedAccount, compatibleAccounts, purchaseTaxes, withholdingTaxes, formError, phase, saving, locked, canContinue, confirmOpen, review, cancelReview, postOperation, operation: operationState, writeError, knownBillId, billIdentityVerified, knownPaymentId, confirmedBill, confirmedPayment, recoveryLoading, recoveryError, refreshCurrentRecords, openKnownBill: () => { if (knownBill.current && verifiedBill.current === knownBill.current && committed.current)
            navigation.navigate(payableDetailHref(knownBill.current, returnHref), { discard: true, replace: true }); }, back: () => navigation.navigate(returnHref), detailHref: (b: Bill) => payableDetailHref(b.id, mode === "register" ? payablesListHref({ ...browse, focus: b.id }) : returnHref), createHref: payableCreateHref(listHref), payHref: (b: Bill) => payablePayHref(b.id, mode === "register" ? payablesListHref({ ...browse, focus: b.id }) : returnHref) };
}
export type PayablesState = ReturnType<typeof usePayablesWorkspace>;
