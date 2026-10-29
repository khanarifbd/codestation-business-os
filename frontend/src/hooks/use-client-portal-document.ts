"use client";
import { useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { usePortalContext, usePortalResource, usePortalScope } from "./use-client-portal-resource";
import { isPortalDocument, portalId } from "@/components/client-portal/portal-model";
import type { PortalDetailMap, PortalKind } from "@/components/client-portal/portal-types";
import { portalBackHref } from "@/lib/client-portal-navigation";

export function usePortalDocument<K extends PortalKind>(kind: K, id: string) {
  const scope = usePortalScope(), context = usePortalContext(), query = useSearchParams();
  const clients = context.value?.clients, validId = portalId(id);
  const validate = useCallback((value: unknown): value is PortalDetailMap[K] => isPortalDocument(kind, value) && value.id === id && Boolean(clients?.some(client => client.id === value.client_id)), [kind, id, clients]);
  const resource = usePortalResource(`/api/client-portal/${kind}/${encodeURIComponent(id)}`, validId && Boolean(context.value), validate, String(context.version));
  // A context refresh invalidates captured action handlers synchronously, before React rerenders.
  const record = { ...resource, isCurrent: () => context.isCurrent() && resource.isCurrent() };
  const backHref = portalBackHref(kind, query.get("return_to"));
  const detailHref = `/dashboard/client/${kind}/${encodeURIComponent(id)}?return_to=${encodeURIComponent(backHref)}`;
  function refresh() { if (context.error || !context.value) void context.refresh(); else void record.refresh(); }
  return { scope, context, record, validId, backHref, detailHref, refresh, clientName: (clientId: string) => clients?.find(client => client.id === clientId)?.display_name || "Linked client" };
}
