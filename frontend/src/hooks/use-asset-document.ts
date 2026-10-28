"use client";
import { useCallback } from "react";
import { assetId, isAssetHistory } from "@/components/accounting-assets/asset-model";
import type { AssetHistory } from "@/components/accounting-assets/asset-types";
import { safeAssetReturn } from "@/lib/asset-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
export function useAssetDocument(id: string, returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), valid = assetId(id);
  const validate = useCallback((payload: unknown): payload is AssetHistory => isAssetHistory(payload) && payload.asset.id === id, [id]);
  const resource = useAdvancedResource(`/api/accounting/assets/${encodeURIComponent(id)}/depreciation`, canView && valid, validate);
  return { canView, canManage, invalidId: !valid, resource, asset: resource.value?.asset ?? null, entries: resource.value?.entries ?? [], backHref: safeAssetReturn(returnHref), refresh: () => resource.refresh() };
}
export type AssetDocumentState = ReturnType<typeof useAssetDocument>;
