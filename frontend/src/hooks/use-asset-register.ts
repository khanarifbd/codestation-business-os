"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isAssetList, isAssetSummary, pageRows } from "@/components/accounting-assets/asset-model";
import { assetBrowse, assetListHref, assetDetailHref, assetCreateHref, assetDepreciationHref } from "@/lib/asset-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
export function useAssetRegister() {
  const { canView, canManage } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams();
  const browse = assetBrowse(query.toString());
  const resource = useAdvancedResource("/api/accounting/assets", canView, isAssetList);
  const summary = useAdvancedResource("/api/accounting/assets/summary", canView, isAssetSummary);
  const needle = browse.search.toLowerCase();
  const filtered = (resource.value || []).filter(asset => (browse.status === "all" || asset.status === browse.status) && (!browse.currency || asset.currency === browse.currency) && `${asset.asset_code} ${asset.name} ${asset.category} ${asset.reference || ""}`.toLowerCase().includes(needle));
  const paged = pageRows(filtered, browse.page), listHref = assetListHref({ ...browse, page: paged.page });
  useEffect(() => { if (!browse.focus || !resource.value) return; const timer = window.setTimeout(() => document.getElementById(`asset-row-${browse.focus}`)?.focus(), 0); return () => window.clearTimeout(timer); }, [browse.focus, resource.value]);
  return { canView, canManage, resource, summary, browse, rows: paged.rows, filteredCount: paged.total, total: resource.value?.length ?? 0, page: paged.page, pageCount: paged.pages, listHref,
    createHref: assetCreateHref(listHref), depreciationHref: assetDepreciationHref(listHref), viewHref: (id: string) => assetDetailHref(id, assetListHref({ ...browse, page: paged.page, focus: id })),
    applyFilters: (next: { search: string; status: string; currency: string }) => router.push(assetListHref({ ...assetBrowse(new URLSearchParams(next)), page: 1, focus: "" })),
    goPage: (page: number) => router.push(assetListHref({ ...browse, page: pageRows(filtered, page).page, focus: "" })),
    refresh: () => Promise.all([resource.refresh(), summary.refresh()]) };
}
export type AssetRegisterState = ReturnType<typeof useAssetRegister>;
