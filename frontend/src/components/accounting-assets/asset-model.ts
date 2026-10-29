import { centsText, decimalInput } from "@/components/accounting-money-out/money-out-model";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import type { Asset, AssetCreateBody, AssetForm, AssetHistory, AssetMeta, AssetSummary, DepreciationRun } from "./asset-types";
export const assetMoney = formatMoneyExact, assetCentsText = centsText;
export const ASSET_PAGE_SIZE = 20;
const MAX_MONEY = BigInt("999999999999999999");
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const text = (value: unknown): value is string => typeof value === "string";
const present = (value: unknown): value is string => text(value) && value.trim().length > 0;
const nullable = (value: unknown) => value === null || text(value);
const currency = (value: unknown): value is string => text(value) && /^[A-Z]{3}$/.test(value);
const characters = (value: string) => Array.from(value).length;
export const assetId = (value: unknown): value is string => text(value) && /^[A-Za-z0-9_-]{1,200}$/.test(value) && !["new", "depreciation"].includes(value);
const nullableId = (value: unknown) => value === null || assetId(value);
export const pretty = (value: string | null | undefined) => value ? value.replaceAll("_", " ").replace(/\b\w/g, s => s.toUpperCase()) : "—";
export function assetDate(value: unknown): value is string { if (!text(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000-")) return false; const date = new Date(value + "T00:00:00Z"); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value; }
/** Exact representability: trailing zeroes are harmless; nonzero sub-cent input is not silently rounded. */
export function assetCents(value: unknown): bigint | null {
  if (!text(value) && (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) return null;
  const raw = String(value).trim(), negative = raw.startsWith("-"), canonical = decimalInput(negative ? raw.slice(1) : raw);
  if (canonical === null || negative && raw[1] === "+") return null;
  const [whole, fraction = ""] = canonical.split("."); if (fraction.length > 2) return null;
  return (negative ? -BigInt(1) : BigInt(1)) * (BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0") || "0"));
}
function amount(value: unknown, { signed = false, stored = false, positive = false } = {}) { const n = assetCents(value); return n !== null && (signed || n >= BigInt(0)) && (!positive || n > BigInt(0)) && (!stored || n <= MAX_MONEY && n >= -MAX_MONEY); }
const unique = <T,>(rows: T[], key: (row: T) => string) => new Set(rows.map(key)).size === rows.length;
const period = (value: unknown): value is string => assetDate(value) && value.endsWith("-01");
export function isAsset(value: unknown): value is Asset {
  if (!record(value) || !assetId(value.id) || !present(value.asset_code) || !present(value.name) || !present(value.category) || !currency(value.currency)
    || !["acquisition_cost", "salvage_value", "accumulated_depreciation", "opening_accumulated_depreciation"].every(key => amount(value[key], { stored: true }))
    || !amount(value.book_value, { stored: true, signed: true }) || !amount(value.depreciable_amount, { stored: true, signed: true })
    || !present(value.record_mode) || !(value.opening_balance_date === null || assetDate(value.opening_balance_date))
    || !assetDate(value.acquisition_date) || !assetDate(value.in_service_date) || !Number.isSafeInteger(value.useful_life_months) || Number(value.useful_life_months) < 1 || Number(value.useful_life_months) > 1200
    || !present(value.depreciation_method) || !nullableId(value.purchase_account_id) || !nullable(value.reference) || !nullable(value.notes) || !present(value.status)) return false;
  // Validate returned identities/formulas, without inventing a monthly policy or hiding unknown statuses.
  return assetCents(value.book_value) === assetCents(value.acquisition_cost)! - assetCents(value.accumulated_depreciation)!
    && assetCents(value.depreciable_amount) === assetCents(value.acquisition_cost)! - assetCents(value.salvage_value)!;
}
export function isAssetList(value: unknown): value is Asset[] { return Array.isArray(value) && value.every(isAsset) && unique(value, row => row.id); }
export function isAssetMeta(value: unknown): value is AssetMeta { return record(value) && currency(value.base_currency) && Array.isArray(value.accounts) && value.accounts.every(row => record(row) && assetId(row.id) && present(row.name) && currency(row.currency) && present(row.account_type) && amount(row.balance, { signed: true })) && unique(value.accounts, row => row.id); }
export function isAssetSummary(value: unknown): value is AssetSummary { return record(value) && Number.isSafeInteger(value.active_assets) && Number(value.active_assets) >= 0 && Array.isArray(value.rows) && value.rows.every(row => record(row) && currency(row.currency) && amount(row.cost) && amount(row.accumulated_depreciation) && amount(row.book_value, { signed: true }) && assetCents(row.book_value) === assetCents(row.cost)! - assetCents(row.accumulated_depreciation)!) && unique(value.rows, row => row.currency); }
export function isAssetHistory(value: unknown): value is AssetHistory { return record(value) && isAsset(value.asset) && Array.isArray(value.entries) && value.entries.every(row => record(row) && assetId(row.id) && period(row.period_date) && amount(row.amount, { stored: true }) && present(row.status) && assetId(row.journal_entry_id)) && unique(value.entries, row => row.id); }
export function isDepreciationRun(value: unknown): value is DepreciationRun {
  if (!record(value) || !period(value.period_date) || !assetDate(value.posting_date) || value.period_date.slice(0, 7) !== value.posting_date.slice(0, 7) || !Array.isArray(value.posted) || !Array.isArray(value.skipped)) return false;
  if (!value.posted.every(row => record(row) && assetId(row.asset_id) && present(row.asset_code) && amount(row.amount, { stored: true, positive: true }) && currency(row.currency) && amount(row.book_value, { stored: true, signed: true }))
    || !value.skipped.every(row => record(row) && assetId(row.asset_id) && present(row.reason)) || !unique(value.posted, row => row.asset_id) || !unique(value.skipped, row => row.asset_id)) return false;
  const posted = new Set(value.posted.map(row => row.asset_id)); return !value.skipped.some(row => posted.has(row.asset_id));
}
const clean = (value: string) => value.trim() || null;
export function assetPayload(form: AssetForm, meta: AssetMeta | null): { error: string | null; body: AssetCreateBody | null } {
  const code = form.asset_code.trim().toUpperCase(), name = form.name.trim(), category = form.category.trim().toLowerCase().replaceAll(" ", "_"), reference = clean(form.reference);
  const cost = assetCents(form.acquisition_cost), salvage = assetCents(form.salvage_value), opening = form.record_mode === "opening" ? assetCents(form.opening_accumulated_depreciation) : BigInt(0), life = Number(form.useful_life_months);
  const account = meta?.accounts.find(row => row.id === form.purchase_account_id);
  let error: string | null = null;
  if (!meta || !isAssetMeta(meta)) error = "Load verified asset metadata before reviewing this record.";
  else if (characters(code) < 1 || characters(code) > 50 || characters(name) < 2 || characters(name) > 220 || characters(category) < 2 || characters(category) > 80) error = "Enter a code (1–50 characters), name (2–220) and category (2–80) after trimming.";
  else if (!currency(form.currency) || !["purchase", "opening"].includes(form.record_mode)) error = "Choose a valid currency and purchase/opening mode.";
  else if (![form.acquisition_cost, form.salvage_value, ...(form.record_mode === "opening" ? [form.opening_accumulated_depreciation] : [])].every(value => amount(value, { stored: true })) || cost === null || salvage === null || opening === null || cost <= BigInt(0) || salvage >= cost) error = "Use exact amounts with at most 2 nonzero decimal places, within 16 whole digits; cost must be positive and salvage lower than cost.";
  else if (!assetDate(form.acquisition_date) || !assetDate(form.in_service_date) || form.in_service_date < form.acquisition_date) error = "Choose valid acquisition and in-service dates; service cannot precede acquisition.";
  else if (!Number.isSafeInteger(life) || life < 1 || life > 1200) error = "Useful life must be a whole number from 1 to 1200 months.";
  else if (form.record_mode === "opening" && (!assetDate(form.opening_balance_date) || form.opening_balance_date < form.in_service_date || opening > cost - salvage)) error = "Opening date must be on/after service, and opening depreciation cannot exceed cost less salvage.";
  else if (form.record_mode === "purchase" && (!account || account.account_type === "credit_card" || account.currency !== form.currency)) error = "Choose an active metadata account in the asset currency, excluding credit cards.";
  else if (form.record_mode === "purchase" && cost > assetCents(account!.balance)!) error = "The purchase account does not have enough available balance.";
  else if (reference && characters(reference) > 180) error = "Keep the reference within 180 characters.";
  if (error || cost === null || salvage === null || opening === null) return { error: error || "Verify the entered asset amounts.", body: null };
  return { error: null, body: { asset_code: code, name, category, currency: form.currency, acquisition_cost: centsText(cost), salvage_value: centsText(salvage), acquisition_date: form.acquisition_date, in_service_date: form.in_service_date, useful_life_months: life, depreciation_method: "straight_line", record_mode: form.record_mode, purchase_account_id: form.record_mode === "purchase" ? form.purchase_account_id : null, opening_accumulated_depreciation: centsText(opening), opening_balance_date: form.record_mode === "opening" ? form.opening_balance_date : null, reference, notes: clean(form.notes) } };
}
export function assetMatchesPayload(value: unknown, body: AssetCreateBody): value is Asset {
  if (!isAsset(value)) return false;
  const opening = assetCents(body.opening_accumulated_depreciation)!, maximum = assetCents(body.acquisition_cost)! - assetCents(body.salvage_value)!;
  return value.asset_code === body.asset_code && value.name === body.name && value.category === body.category && value.currency === body.currency
    && assetCents(value.acquisition_cost) === assetCents(body.acquisition_cost) && assetCents(value.salvage_value) === assetCents(body.salvage_value)
    && assetCents(value.opening_accumulated_depreciation) === opening && assetCents(value.accumulated_depreciation) === opening
    && value.record_mode === body.record_mode && value.opening_balance_date === body.opening_balance_date && value.acquisition_date === body.acquisition_date && value.in_service_date === body.in_service_date
    && value.useful_life_months === body.useful_life_months && value.depreciation_method === body.depreciation_method && value.purchase_account_id === body.purchase_account_id
    && value.reference === body.reference && value.notes === body.notes && value.status === (opening >= maximum ? "fully_depreciated" : "active");
}
export function depreciationPayload(date: string): { error: string | null; body: { period_date: string } | null } { return assetDate(date) ? { error: null, body: { period_date: date } } : { error: "Choose a valid posting date for the depreciation run.", body: null }; }
export function depreciationMatchesPayload(value: unknown, body: { period_date: string }): value is DepreciationRun { return isDepreciationRun(value) && value.posting_date === body.period_date && value.period_date === body.period_date.slice(0, 7) + "-01"; }
export function pageRows<T>(rows: T[], page: number) { const pages = Math.max(1, Math.ceil(rows.length / ASSET_PAGE_SIZE)), current = Math.min(Number.isSafeInteger(page) && page > 0 ? page : 1, pages); return { rows: rows.slice((current - 1) * ASSET_PAGE_SIZE, current * ASSET_PAGE_SIZE), page: current, pages, total: rows.length }; }
