"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { getApiErrorMessage } from "@/lib/api-error";
import { accountCursorHistoryScope, readPreviousAccountCursor, rememberAccountCursorStep } from "@/lib/account-cursor-history";
import { initialTransferValues, isTransfer, isTransferAccountList, isTransferPage, eligibleTransferAccount, transferPreview, transferPayload, type Transfer, type TransferAccount, type TransferPage, type TransferValues, type TransferBrowse } from "@/components/accounting-transfers/transfer-model";
import { TRANSFERS_PATH, transferBrowse, transferListHref, safeTransferReturn, transferCreateHref, transferViewHref, transferPageApi, transferCursorBrowse } from "@/lib/transfer-navigation";
class TransferRequestError extends Error { constructor(message: string, public status: number) { super(message); } }
async function readTransferData(path: string): Promise<unknown> {
  const response = await fetch(path, { cache: "no-store" });
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new TransferRequestError(getApiErrorMessage(data, "Transfer information could not be loaded."), response.status);
  return data;
}
type WritePhase = "idle" | "uncertain" | "confirmed";
type Operation = { key: string; body: string };
export function useAccountingTransfers() {
  const { tenant } = useDashboardSession(), router = useRouter(), pathname = usePathname(), query = useSearchParams(), route = useParams<{ transferId?: string }>();
  const transferId = route.transferId ?? "", mode = pathname.endsWith("/new") ? "create" : transferId ? "view" : "register";
  const canView = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.view")), canManage = Boolean(tenant?.permissions.some(p => p === "*" || p === "finance.manage"));
  const pageUrl = transferPageApi(transferBrowse(query.toString()));
  const browse = transferBrowse(query.toString()), returnHref = safeTransferReturn(query.get("returnTo")), listHref = transferListHref(browse);
  const cursorBrowse = transferCursorBrowse(browse), historyScope = accountCursorHistoryScope(tenant?.organization.id ?? "", tenant?.membership_id ?? "", "transfer-register", cursorBrowse), historyPosition = JSON.stringify([historyScope, browse.page, browse.cursor]);
  const [accounts, setAccounts] = useState<TransferAccount[] | null>(null), [accountError, setAccountError] = useState<string | null>(null), [accountsLoading, setAccountsLoading] = useState(false);
  const [pageState, setPageState] = useState<{ key: string; data: TransferPage | null; loading: boolean; error: string | null }>({ key: "", data: null, loading: true, error: null });
  const [document, setDocument] = useState<Transfer | null>(null), [documentLoading, setDocumentLoading] = useState(true), [documentError, setDocumentError] = useState<string | null>(null);
  const [pendingNavigationUrl, setPendingNavigationUrl] = useState<string | null>(null);
  const pageNavigating = pendingNavigationUrl === pageUrl;
  const [revision, setRevision] = useState(0), [previous, setPrevious] = useState<{ key: string; cursor: string | undefined } | null>(null);
  const [queryDraft, setQueryDraft] = useState<{ key: string; value: string } | null>(null);
  const [values, setValues] = useState<TransferValues>(initialTransferValues), [saving, setSaving] = useState(false), [phase, setPhase] = useState<WritePhase>("idle"), [writeError, setWriteError] = useState<string | null>(null), [confirmOpen, setConfirmOpen] = useState(false), [receipt, setReceipt] = useState<Transfer | null>(null);
  const pageNavigationPending = useRef(false), navigationSequence = useRef(0);
  const mounted = useRef(true), accountEpoch = useRef(0), pageEpoch = useRef(0), documentEpoch = useRef(0), inFlight = useRef(false), committed = useRef(false), operation = useRef<Operation | null>(null), uncertain = useRef(false);
  const source = accounts?.find(a => a.id === values.from_account_id) ?? null, destination = accounts?.find(a => a.id === values.to_account_id) ?? null;
  const preview = transferPreview(values, source, destination);
  const dirty = mode === "create" && phase !== "confirmed" && (phase === "uncertain" || JSON.stringify(values) !== JSON.stringify(initialTransferValues()));
  const navigation = useDocumentNavigationGuard(dirty, { enabled: mode === "create", isBusy: saving, pendingRef: inFlight, documentLabel: "transfer", discardMessage: phase === "uncertain" ? "This transfer may already be recorded. Leaving loses this tab’s retained retry key. Verify the current company’s transfer register before recording any replacement. Leave anyway?" : undefined });
  const loadAccounts = useCallback(async () => {
    if (!canView || mode === "view" || inFlight.current || committed.current || uncertain.current) return;
    const current = ++accountEpoch.current;
    setAccountsLoading(true); setAccountError(null);
    try {
      const result = await readTransferData("/api/finance/accounts");
      if (!mounted.current || current !== accountEpoch.current) return;
      if (!isTransferAccountList(result)) throw new Error("Account response could not be verified.");
      setAccounts(result);
    } catch (reason) {
      if (!mounted.current || current !== accountEpoch.current) return;
      setAccounts(null); setAccountError(reason instanceof Error ? reason.message : "Accounts unavailable.");
      if (reason instanceof TransferRequestError && reason.status === 401) router.replace("/login");
    } finally { if (mounted.current && current === accountEpoch.current) setAccountsLoading(false); }
  }, [canView, mode, router]);
  const loadPage = useCallback(async () => {
    if (!canView || mode !== "register") return;
    const current = ++pageEpoch.current;
    setPageState({ key: pageUrl, data: null, loading: true, error: null });
    try {
      const result = await readTransferData(pageUrl);
      if (!mounted.current || current !== pageEpoch.current) return;
      if (!isTransferPage(result)) throw new Error("Transfer register response could not be verified.");
      setPageState({ key: pageUrl, data: result, loading: false, error: null });
    } catch (reason) {
      if (!mounted.current || current !== pageEpoch.current) return;
      setPageState({ key: pageUrl, data: null, loading: false, error: reason instanceof Error ? reason.message : "Transfers unavailable." });
      if (reason instanceof TransferRequestError && reason.status === 401) router.replace("/login");
    }
  }, [canView, mode, pageUrl, router]);
  const loadDocument = useCallback(async () => {
    if (!canView || mode !== "view") return;
    const current = ++documentEpoch.current;
    setDocumentLoading(true); setDocumentError(null); setDocument(null);
    try {
      const result = await readTransferData(`/api/finance/transfers/${encodeURIComponent(transferId)}`);
      if (!mounted.current || current !== documentEpoch.current) return;
      if (!isTransfer(result) || result.id !== transferId) throw new Error("The returned transfer identity could not be verified.");
      setDocument(result);
    } catch (reason) {
      if (!mounted.current || current !== documentEpoch.current) return;
      setDocumentError(reason instanceof Error ? reason.message : "Transfer unavailable.");
      if (reason instanceof TransferRequestError && reason.status === 401) router.replace("/login");
    } finally { if (mounted.current && current === documentEpoch.current) setDocumentLoading(false); }
  }, [canView, mode, transferId, router]);
  useEffect(() => {
    mounted.current = true;
    const accountsLifetime = accountEpoch, pagesLifetime = pageEpoch, documentLifetime = documentEpoch;
    const timer = window.setTimeout(() => { void loadAccounts(); void loadDocument(); }, 0);
    return () => { window.clearTimeout(timer); mounted.current = false; ++accountsLifetime.current; ++pagesLifetime.current; ++documentLifetime.current; };
  }, [loadAccounts, loadDocument]);
  useEffect(() => { pageNavigationPending.current = false; }, [pageUrl]);
  useEffect(() => { const lifetime = pageEpoch, timer = window.setTimeout(() => void loadPage(), 200); return () => { window.clearTimeout(timer); ++lifetime.current; }; }, [loadPage, revision]);
  useEffect(() => {
    if (mode !== "register") return;
    let active = true;
    void readPreviousAccountCursor(historyScope, { search: "", direction: "all", source_type: "", date_from: "", date_to: "", size: 20, page: browse.page, cursor: browse.cursor }).then(cursor => { if (active) setPrevious({ key: historyPosition, cursor }); });
    return () => { active = false; };
  }, [mode, historyScope, historyPosition, browse.page, browse.cursor]);
  useEffect(() => {
    if (mode !== "register" || !browse.focus || pageState.key !== pageUrl || !pageState.data) return;
    window.document.getElementById(`transfer-row-${browse.focus}`)?.focus();
  }, [mode, browse.focus, pageState.key, pageState.data, pageUrl]);
  const page = pageState.key === pageUrl ? pageState.data : null, pageLoading = pageState.key !== pageUrl || pageState.loading, pageError = pageState.key === pageUrl ? pageState.error : null;
  const hasPrevious = browse.page > 1 && previous?.key === historyPosition && previous.cursor !== undefined;
  function changeBrowse(patch: Partial<TransferBrowse>, paging = false) { if (!paging) { ++navigationSequence.current; pageNavigationPending.current = false; setPendingNavigationUrl(null); } router.push(transferListHref({ ...browse, ...patch, focus: "", ...(paging ? {} : { cursor: "", page: 1 }) })); }
  async function nextPage() {
    if (!page?.next_cursor || pageLoading || pageNavigationPending.current) return;
    pageNavigationPending.current = true; setPendingNavigationUrl(pageUrl);
    const epoch = pageEpoch.current, sequence = ++navigationSequence.current;
    try {
      await rememberAccountCursorStep(historyScope, cursorBrowse, page.next_cursor);
      if (mounted.current && epoch === pageEpoch.current && sequence === navigationSequence.current) changeBrowse({ cursor: page.next_cursor, page: browse.page + 1 }, true);
    } catch {
      if (sequence === navigationSequence.current && mounted.current) {
        pageNavigationPending.current = false; setPendingNavigationUrl(null);
        setPageState({ key: pageUrl, data: null, loading: false, error: "Page navigation could not be completed. Retry the register." });
      }
    }
    // Keep the same-event navigation latch until the URL changes, not just until crypto resolves.
  }
  function previousPage() { if (hasPrevious && !pageLoading && !pageNavigationPending.current) changeBrowse({ cursor: previous!.cursor!, page: browse.page - 1 }, true); }
  function change<K extends keyof TransferValues>(key: K, value: TransferValues[K]) {
    if (!canManage || mode !== "create" || inFlight.current || committed.current || uncertain.current) return;
    setValues(old => ({ ...old, [key]: value })); setWriteError(null); operation.current = null;
  }
  function review() {
    if (!canManage || !canView || mode !== "create" || inFlight.current || committed.current || (!uncertain.current && !preview.amounts)) return;
    setWriteError(null); setConfirmOpen(true);
  }
  function cancelReview() { if (!inFlight.current) setConfirmOpen(false); }
  async function postTransfer() {
    if (!canManage || !canView || mode !== "create" || !confirmOpen || inFlight.current || committed.current || (!uncertain.current && !preview.amounts)) return;
    inFlight.current = true; setSaving(true); setWriteError(null);
    let authenticatedFailure = false, responseClassified = false;
    try {
      if (!operation.current) {
        const key = window.crypto.randomUUID();
        operation.current = { key, body: JSON.stringify(transferPayload(values, preview.amounts!.sameCurrency)) };
      }
      const response = await fetch("/api/finance/transfers", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": operation.current.key }, body: operation.current.body });
      responseClassified = true;
      // An HTTP success is a known write even if parsing, rendering or navigation fails afterward.
      if (response.ok) committed.current = true;
      const body: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (!response.ok) {
        authenticatedFailure = response.status === 401;
        // A later rejection cannot prove that an earlier ambiguous attempt did not post.
        // The proxy synthetic parse-failure message is not a backend rejection either.
        const definiteRejection = response.status >= 400 && response.status < 500
          && response.status !== 408 && response.status !== 409
          && getApiErrorMessage(body, "").trim().length > 0 && getApiErrorMessage(body, "").trim() !== "Unexpected upstream response";
        uncertain.current = uncertain.current || !definiteRejection;
        setPhase(uncertain.current ? "uncertain" : "idle");
        throw new Error(getApiErrorMessage(body, "The transfer was not confirmed.") + (uncertain.current ? " The outcome remains uncertain. Keep the original transfer request and retry key; a later rejection does not prove the earlier attempt failed." : ""));
      }
      uncertain.current = false; setPhase("confirmed"); setConfirmOpen(false); navigation.markClean();
      const sent = JSON.parse(operation.current.body) as ReturnType<typeof transferPayload>;
      if (isTransfer(body) && body.from_account_id === sent.from_account_id && body.to_account_id === sent.to_account_id) setReceipt(body);
      else setWriteError("The server confirmed the transfer, but its receipt could not be verified. Open the register to check it; do not record it again.");
    } catch (reason) {
      if (!mounted.current) return;
      if (committed.current) { setPhase("confirmed"); navigation.markClean(); }
      // A network interruption is uncertain. Keep the original operation body and key for an explicit identical retry.
      else if (operation.current && !(reason instanceof Error && authenticatedFailure)) {
        // HTTP rejection classification was set above; only fetch/parse exceptions not classified there become uncertain.
        if (!responseClassified) { uncertain.current = true; setPhase("uncertain"); }
      }
      setWriteError(reason instanceof Error ? reason.message : "The transfer outcome could not be confirmed.");
      setConfirmOpen(false);
      if (authenticatedFailure) router.replace("/login");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  // No automatic retry, optimistic balance update, or navigation/readback is part of posting.
  function openReceipt() {
    if (!committed.current) return;
    navigation.navigate(receipt ? transferViewHref(receipt.id, returnHref) : returnHref, { discard: true, replace: true });
  }
  return { mode, canView, canManage, pageNavigating, browse, returnHref, listHref, accounts, accountError, accountsLoading, loadAccounts, page, pageLoading, pageError, loadPage, document, documentLoading, documentError, loadDocument, values, change, source, destination, preview, dirty, saving, phase, writeError, receipt, confirmOpen, review, cancelReview, postTransfer, openReceipt, hasPrevious, historyLoading: browse.page > 1 && previous?.key !== historyPosition, previousPage, nextPage, changeBrowse, refresh: () => { ++navigationSequence.current; pageNavigationPending.current = false; setPendingNavigationUrl(null); setRevision(n => n + 1); }, queryDraft: queryDraft?.key === pageUrl ? queryDraft.value : browse.search, setQueryDraft: (value: string) => setQueryDraft({ key: pageUrl, value }), createHref: transferCreateHref(listHref), viewHref: (id: string) => transferViewHref(id, transferListHref({ ...browse, focus: id })), back: () => mode === "create" ? navigation.navigate(returnHref) : router.push(returnHref), eligibleAccounts: (accounts ?? []).filter(eligibleTransferAccount), verificationHref: TRANSFERS_PATH };
}
export type AccountingTransfersState = ReturnType<typeof useAccountingTransfers>;
