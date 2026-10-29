"use client";
import { useRef, useState } from "react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { assetPayload, assetMatchesPayload, assetMoney, assetCents, assetCentsText, isAsset, isAssetMeta, depreciationPayload, depreciationMatchesPayload, isDepreciationRun } from "@/components/accounting-assets/asset-model";
import { blankAsset } from "@/components/accounting-assets/asset-types";
import type { AssetForm } from "@/components/accounting-assets/asset-types";
import { assetDetailHref, safeAssetReturn } from "@/lib/asset-navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { useAssetAction } from "./use-asset-action";
export function useAssetCreate(returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), { tenant } = useDashboardSession(), backHref = safeAssetReturn(returnHref);
  const meta = useAdvancedResource("/api/accounting/assets/meta", canView && canManage, isAssetMeta);
  const [baseline] = useState(() => blankAsset("", tenant?.organization.currency || "")), [form, setForm] = useState<AssetForm>(baseline), values = useRef(form), [error, setError] = useState<string | null>(null);
  const action = useAssetAction(canView && canManage, JSON.stringify(form) !== JSON.stringify(baseline), backHref);
  const readiness = Boolean(meta.value && !meta.loading);
  function change<K extends keyof AssetForm>(key: K, value: AssetForm[K]) {
    if (!action.canEdit()) return;
    action.close(); action.clearError(); setError(null);
    const next = { ...values.current, [key]: value };
    if (key === "purchase_account_id") { const account = meta.value?.accounts.find(row => row.id === value); if (account) next.currency = account.currency; }
    values.current = next; setForm(next);
  }
  function review() {
    if (!readiness || !canView || !canManage) return;
    const checked = assetPayload(values.current, meta.value); setError(checked.error); if (!checked.body) return;
    const body = checked.body, opening = body.record_mode === "opening", account = meta.value?.accounts.find(row => row.id === body.purchase_account_id);
    const book = assetCentsText(assetCents(body.acquisition_cost)! - assetCents(body.opening_accumulated_depreciation)!);
    action.arm({ url: "/api/accounting/assets", body,
      confirmation: { title: opening ? "Record this opening asset?" : "Record this asset purchase?", description: opening ? "This immediately posts gross asset cost, opening accumulated depreciation and net opening equity. It does not move cash." : "This immediately records the fixed asset and decreases the selected cash/bank account by the acquisition cost. It is not a draft or ordinary expense.", warning: "This operation has no request-key replay contract. If its outcome is uncertain, inspect saved records before any new posting. The server rechecks account authority, balance, exchange rate and accounting periods.", confirmLabel: opening ? "Record opening asset" : "Record asset purchase", details: [
        { label: "Asset", value: `${body.asset_code} · ${body.name}` }, { label: "Acquisition cost", value: assetMoney(body.acquisition_cost, body.currency), emphasis: !opening }, { label: "Salvage value", value: assetMoney(body.salvage_value, body.currency) },
        ...(opening ? [{ label: "Opening depreciation", value: assetMoney(body.opening_accumulated_depreciation, body.currency) }, { label: "Opening book value", value: assetMoney(book, body.currency), emphasis: true }, { label: "Opening posting date", value: body.opening_balance_date! }] : [{ label: "Pay from", value: account?.name || body.purchase_account_id! }, { label: "Purchase posting date", value: body.acquisition_date }]),
        { label: "Acquisition date / FX basis", value: body.acquisition_date }, { label: "In service", value: body.in_service_date }, { label: "Useful life", value: `${body.useful_life_months} months · straight line` }, { label: "Reference", value: body.reference || "—" } ] },
      validate: value => assetMatchesPayload(value, body), resultHref: value => isAsset(value) ? assetDetailHref(value.id, backHref) : null });
  }
  return { canView, canManage, meta, form, change, preview: assetPayload(form, meta.value).body, error, action, review, cancel: action.cancel, backHref, readiness, refresh: () => { action.close(); return meta.refresh(); } };
}
export function useAssetDepreciation(returnHref: string) {
  const { canView, canManage } = useAdvancedPermissions(), backHref = safeAssetReturn(returnHref);
  const [periodDate, setPeriodDate] = useState(""), value = useRef(periodDate), [error, setError] = useState<string | null>(null);
  const action = useAssetAction(canView && canManage, periodDate !== "", backHref);
  function changeDate(next: string) { if (!action.canEdit()) return; action.close(); action.clearError(); setError(null); value.current = next; setPeriodDate(next); }
  function review() {
    if (!canView || !canManage) return;
    const checked = depreciationPayload(value.current); setError(checked.error); if (!checked.body) return;
    const body = checked.body;
    action.arm({ url: "/api/accounting/assets/depreciation", body, confirmation: { title: "Post companywide depreciation?", description: "Posts one straight-line monthly amount for each eligible active asset across this company. This is a non-cash accounting posting, not a preview or an action for one selected asset.", warning: "The server checks existing/later posted periods and accounting dates. There is no catch-up or daily proration; the opening month is excluded. Amounts and skipped assets are confirmed only by the returned result. An uncertain response must not be repeated.", confirmLabel: "Post depreciation", details: [{ label: "Depreciation month", value: body.period_date.slice(0, 7) }, { label: "Journal posting date", value: body.period_date, emphasis: true }, { label: "Scope", value: "All eligible active company assets" }, { label: "Cash movement", value: "None" }] }, validate: result => depreciationMatchesPayload(result, body) });
  }
  return { canView, canManage, periodDate, changeDate, error, action, review, cancel: action.cancel, backHref, result: isDepreciationRun(action.result) ? action.result : null };
}
export type AssetCreateState = ReturnType<typeof useAssetCreate>;
export type AssetDepreciationState = ReturnType<typeof useAssetDepreciation>;
