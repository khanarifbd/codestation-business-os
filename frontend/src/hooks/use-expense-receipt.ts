"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getApiErrorMessage } from "@/lib/api-error";
import { expenseDocumentHref } from "@/lib/expense-navigation";
import { useExpenseDocument } from "./use-expense-document";
import { useDocumentNavigationGuard } from "./use-document-navigation-guard";

export function useExpenseReceipt(expenseId: string, returnHref: string) {
  const { resource, canView, canManage } = useExpenseDocument(expenseId), router = useRouter();
  const [file, setFile] = useState<File | null>(null), [title, setTitle] = useState("");
  const [phase, setPhase] = useState<"idle" | "uncertain" | "confirmed">("idle"), [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null);
  const mounted = useRef(true), inFlight = useRef(false), committed = useRef(false), uncertain = useRef(false), fileRef = useRef<File | null>(null), titleRef = useRef("");
  const backHref = expenseDocumentHref(expenseId, returnHref);
  const navigation = useDocumentNavigationGuard(phase !== "confirmed" && Boolean(file || title || phase === "uncertain"), { documentLabel: "expense", isBusy: saving, pendingRef: inFlight,
    discardMessage: phase === "uncertain" ? "This upload may already have completed. It has no replay key. Verify the expense’s current documents before uploading a duplicate. Leave anyway?" : undefined });
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; fileRef.current = null; }; }, []);
  function changeFile(next: File | null) { if (!mounted.current || !canManage || inFlight.current || committed.current || uncertain.current) return; fileRef.current = next; setFile(next); setError(null); }
  function changeTitle(next: string) { if (!mounted.current || !canManage || inFlight.current || committed.current || uncertain.current) return; titleRef.current = next; setTitle(next); setError(null); }
  const effectiveTitle = title.trim() || file?.name || "", validation = !file ? "Choose a file to attach." : !effectiveTitle || effectiveTitle.length > 180 ? "Enter a document title of 1–180 characters." : null;
  async function upload() {
    if (!mounted.current || !canView || !canManage || !resource.value || resource.value.id !== expenseId || inFlight.current || committed.current || uncertain.current || !fileRef.current) return;
    const label = titleRef.current.trim() || fileRef.current.name;
    if (!label || label.length > 180) { setError("Enter a document title of 1–180 characters."); return; }
    const body = new FormData(); body.append("file", fileRef.current); body.append("title", label); body.append("document_type", "receipt");
    inFlight.current = true; setSaving(true); setError(null);
    let classified = false;
    try {
      const response = await fetch(`/api/expense-documents/${encodeURIComponent(expenseId)}/upload`, { method: "POST", body });
      if (response.ok) committed.current = true;
      const payload: unknown = await response.json().catch(() => null);
      if (!mounted.current) return;
      if (response.status === 401) router.replace("/login");
      if (!response.ok) { classified = response.status < 500; throw new Error(getApiErrorMessage(payload, "Upload could not be confirmed.")); }
      setPhase("confirmed"); navigation.markClean(); fileRef.current = null; setFile(null);
    } catch (reason) {
      if (!mounted.current) return;
      if (committed.current) { setPhase("confirmed"); navigation.markClean(); }
      else if (!classified) { uncertain.current = true; setPhase("uncertain"); }
      setError(reason instanceof Error ? reason.message : "Upload outcome is uncertain.");
    } finally { inFlight.current = false; if (mounted.current) setSaving(false); }
  }
  return { canView, canManage, resource, file, title, changeFile, changeTitle, phase, saving, error, validation, upload, locked: saving || phase !== "idle", backHref, back: () => navigation.navigate(backHref, { replace: phase === "confirmed" }) };
}
