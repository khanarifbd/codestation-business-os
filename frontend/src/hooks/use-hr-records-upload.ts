"use client";

import { verifiedHRRejectionBody } from "@/lib/hr-rejection-body";

import { useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useHRAccess } from "@/components/hr-access-context";
import { isHRTimeMeta, record, timeError, timeId, validHRAccess } from "@/components/hr-time/hr-time-model";
import { useDocumentNavigationGuard } from "@/hooks/use-document-navigation-guard";
import { useHRTimeLifetime, useHRTimeResource } from "@/hooks/use-hr-time-resource";

type Phase = "idle" | "pending" | "rejected" | "acknowledged" | "confirmed" | "unknown";
type Dialog = { owner: object; generation: number };
type Token = { owner: object; dialog: Dialog };
type Receipt = { id: string; file_url: string };
const UNKNOWN = "The upload outcome is unknown. The document may already exist. Do not upload it again; neither a matching nor a missing later record proves this request's result.";
const ACK = "The server acknowledged the upload, but its document receipt is not verified. Do not upload it again.";
const UNKNOWN_LEAVE = "This upload may already have completed. Closing this dialog keeps its lock on this page, but reloading or leaving can lose this memory-only result. Do not repeat the upload without reviewing its outcome. Close this dialog?";
const knownRejection = (status: number, body: unknown) => [400, 401, 403, 404, 413, 422].includes(status) && verifiedHRRejectionBody(body, status === 422);
function isReceipt(body: unknown): body is Receipt {
  return record(body) && timeId(body.id) && encodeURIComponent(body.id) === body.id
    && body.file_url === `/api/hr-documents/${body.id}/file`;
}

/** One page-owned upload intent. Closing the modal never clears an uncertain result. */
export function useHRRecordsUpload() {
  const session = useDashboardSession(), capability = useHRAccess(), router = useRouter();
  const access = validHRAccess(capability.access) ? capability.access : null;
  const scope = JSON.stringify([session.tenant?.organization.id, session.tenant?.membership_id, session.tenant?.role_id, session.tenant?.status, session.tenant?.permissions, session.profile?.email, session.loading, capability.loading, access]);
  const { owner, current } = useHRTimeLifetime(scope);
  const enabled = Boolean(session.tenant) && !session.loading && !capability.loading && access?.can_manage === true;
  const pending = useRef(false), operation = useRef<Token | null>(null), activeDialog = useRef<Dialog | null>(null), generation = useRef(0), lock = useRef<Phase>("idle"), dirtyRef = useRef(false);
  const [dialogState, setDialog] = useState<Dialog | null>(null);
  const [flight, setFlight] = useState({ owner, value: false });
  const [dirtyState, setDirty] = useState({ owner, value: false });
  const [state, setState] = useState<{ owner: object; phase: Phase; message: string | null; receipt: Receipt | null }>({ owner, phase: "idle", message: null, receipt: null });
  useLayoutEffect(() => {
    pending.current = false; operation.current = null; activeDialog.current = null; lock.current = "idle"; dirtyRef.current = false;
    return () => { pending.current = false; operation.current = null; activeDialog.current = null; };
  }, [owner]);
  const dialog = dialogState?.owner === owner ? dialogState : null;
  const phase = state.owner === owner ? state.phase : "idle", busy = flight.owner === owner && flight.value;
  const unresolved = phase === "unknown" || phase === "acknowledged";
  const dirty = dirtyState.owner === owner && dirtyState.value;
  const meta = useHRTimeResource(`${scope}:${dialog?.generation ?? "closed"}`, "/api/hr/meta", enabled && Boolean(dialog), isHRTimeMeta);
  const navigation = useDocumentNavigationGuard((phase !== "confirmed" && dirty) || unresolved, {
    enabled: Boolean(dialog) || unresolved || busy, pendingRef: pending, isBusy: busy,
    discardMessage: unresolved ? "The document upload may already have completed. Leaving can lose this memory-only outcome; do not repeat it based only on a later list. Leave this page?" : "Discard the employee document details selected here?",
  });
  const ownsDialog = () => current() && Boolean(dialog) && activeDialog.current === dialog;
  const belongs = (token: Token) => current() && token.owner === owner && operation.current === token;
  const canEdit = () => ownsDialog() && enabled && !pending.current && ["idle", "rejected"].includes(lock.current) && meta.isReady(meta.receipt);
  function open() {
    if (!current() || !enabled || pending.current || activeDialog.current) return false;
    const next = { owner, generation: ++generation.current };
    activeDialog.current = next; setDialog(next);
    dirtyRef.current = false; setDirty({ owner, value: false });
    if (["idle", "rejected", "confirmed"].includes(lock.current)) {
      operation.current = null; lock.current = "idle";
      setState({ owner, phase: "idle", message: null, receipt: null });
      navigation.markClean();
    }
    return true;
  }
  function close() {
    if (!current() || pending.current) return false;
    if (!dialog) return activeDialog.current === null;
    if (activeDialog.current !== dialog) return false;
    const uncertain = ["unknown", "acknowledged"].includes(lock.current);
    if ((uncertain || dirtyRef.current && lock.current !== "confirmed") && !window.confirm(uncertain ? UNKNOWN_LEAVE : "Discard the employee document details selected here?")) return false;
    activeDialog.current = null; setDialog(null);
    dirtyRef.current = false; setDirty({ owner, value: false });
    if (!uncertain) navigation.markClean();
    return true;
  }
  function changed() {
    if (!canEdit()) return;
    dirtyRef.current = true; setDirty({ owner, value: true });
  }
  function settle(token: Token, next: Phase, message: string, receipt: Receipt | null = null) {
    if (!belongs(token)) return;
    lock.current = next; setState({ owner, phase: next, message, receipt });
  }
  async function submit(form: HTMLFormElement) {
    if (!canEdit() || !dialog) return null;
    const body = new FormData(form), employee = body.get("employee_id"), file = body.get("file");
    if (typeof employee !== "string" || !meta.value?.employees.some(item => item.id === employee) || !(file instanceof File) || !file.name) {
      lock.current = "rejected";
      setState({ owner, phase: "rejected", message: "Choose a current company employee and a document file before uploading.", receipt: null });
      return null;
    }
    const title = body.get("title"), reference = body.get("reference_number");
    // Code points match backend model widths; do not count UTF-16 halves of valid Unicode.
    if (typeof title !== "string" || Array.from(title.trim()).length > 180 ||
        reference !== null && (typeof reference !== "string" || Array.from(reference.trim()).length > 120)) {
      lock.current = "rejected";
      setState({ owner, phase: "rejected", message: "Document title must be at most 180 characters and reference number at most 120 characters.", receipt: null });
      return null;
    }
    const token = { owner, dialog };
    operation.current = token; pending.current = true; lock.current = "pending";
    setFlight({ owner, value: true }); setState({ owner, phase: "pending", message: "Uploading once. Keep this document open while the response settles.", receipt: null });
    try {
      const response = await fetch("/api/hr-documents/upload", { method: "POST", body });
      if (!belongs(token)) return null;
      settle(token, response.ok ? "acknowledged" : "unknown", response.ok ? ACK : UNKNOWN);
      if (response.status === 401) router.replace("/login");
      const payload: unknown = await response.json().catch(() => null);
      if (!belongs(token)) return null;
      if (response.ok) {
        if (!isReceipt(payload)) return null;
        settle(token, "confirmed", "Employee document uploaded securely. The server returned a verified document reference.", payload);
        dirtyRef.current = false; setDirty({ owner, value: false }); navigation.markClean();
        return { ...payload, current: () => belongs(token) };
      }
      if (knownRejection(response.status, payload)) settle(token, "rejected", timeError(payload, "The upload was rejected before completion. Review the input and try deliberately."));
      return null;
    } catch {
      if (belongs(token) && !["acknowledged", "confirmed"].includes(lock.current)) settle(token, "unknown", UNKNOWN);
      return null;
    } finally {
      if (belongs(token)) { pending.current = false; setFlight({ owner, value: false }); }
    }
  }
  return {
    open, close, submit, changed, canEdit, isOpen: Boolean(dialog), canOpen: enabled && !busy,
    phase, busy, unresolved, message: state.owner === owner ? state.message : null,
    receipt: state.owner === owner ? state.receipt : null,
    employees: meta.value?.employees ?? [], metaLoading: meta.loading, metaError: meta.error,
    refreshContext: () => ownsDialog() && !pending.current && ["idle", "rejected"].includes(lock.current) ? meta.refresh() : Promise.resolve(null),
  };
}
