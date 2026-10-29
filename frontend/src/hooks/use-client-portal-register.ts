"use client";
import { useCallback, useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePortalContext, usePortalResource, usePortalScope } from "./use-client-portal-resource";
import { isPortalList } from "@/components/client-portal/portal-model";
import type { PortalKind, PortalRecordMap } from "@/components/client-portal/portal-types";
import { parsePortalBrowse, portalBrowseHref, portalDocumentHref, portalPageRows, type PortalBrowse } from "@/lib/client-portal-navigation";

export function usePortalRegister<K extends PortalKind>(kind: K) {
  const scope = usePortalScope(), context = usePortalContext(), router = useRouter(), query = useSearchParams();
  const serialized = query.toString();
  const browse = useMemo(() => parsePortalBrowse(new URLSearchParams(serialized)), [serialized]);
  const clients = context.value?.clients;
  const validate = useCallback((value: unknown): value is PortalRecordMap[K][] => isPortalList(kind, value) && value.every(row => clients?.some(client => client.id === row.client_id)), [kind, clients]);
  const records = usePortalResource(`/api/client-portal/${kind}`, Boolean(context.value), validate, String(context.version));
  const filtered = useMemo(() => {
    const needle = browse.search.toLocaleLowerCase();
    return (records.value || []).filter(row => {
      const values = row as unknown as Record<string, unknown>;
      const client = clients?.find(item => item.id === row.client_id)?.display_name || "";
      const searchable = [values.project_number, values.order_number, values.quotation_number, values.invoice_number, values.name, values.subject, client].filter(value => typeof value === "string").join(" ").toLocaleLowerCase();
      return (!needle || searchable.includes(needle)) && (browse.status === "all" || row.status === browse.status) && (!browse.client || row.client_id === browse.client);
    });
  }, [records.value, browse.search, browse.status, browse.client, clients]);
  const page = portalPageRows(filtered, browse.page);
  const statuses = [...new Set([...(records.value || []).map(row => row.status), ...(browse.status !== "all" ? [browse.status] : [])])].sort();
  function change(patch: Partial<PortalBrowse>) {
    router.push(portalBrowseHref(kind, { ...browse, ...patch, page: patch.page ?? 1, focus: "" }), { scroll: false });
  }
  useEffect(() => {
    if (!browse.focus || !records.value) return;
    let active = true;
    queueMicrotask(() => { if (active) document.getElementById(`portal-row-${browse.focus}`)?.focus({ preventScroll: true }); });
    return () => { active = false; };
  }, [browse.focus, records.value]);
  function refresh() { if (context.error || !context.value) void context.refresh(); else void records.refresh(); }
  return { scope, context, records, browse, page, statuses, change, refresh, clientName: (id: string) => clients?.find(client => client.id === id)?.display_name || "Linked client", detailHref: (id: string) => portalDocumentHref(kind, id, { ...browse, page: page.page }) };
}
