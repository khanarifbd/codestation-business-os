export type AssetDecimal = string | number;
export type AssetMode = "purchase" | "opening";
export const assetStatuses = ["active", "fully_depreciated", "reversed"] as const;
export type AssetStatus = typeof assetStatuses[number];
export type Asset = {
  id: string; asset_code: string; name: string; category: string; currency: string;
  acquisition_cost: AssetDecimal; salvage_value: AssetDecimal; accumulated_depreciation: AssetDecimal; opening_accumulated_depreciation: AssetDecimal;
  record_mode: string; opening_balance_date: string | null; book_value: AssetDecimal; depreciable_amount: AssetDecimal;
  acquisition_date: string; in_service_date: string; useful_life_months: number; depreciation_method: string;
  purchase_account_id: string | null; reference: string | null; status: string; notes: string | null;
};
/** The existing metadata endpoint supplies active accounts; it does not return an is_active field. */
export type AssetAccount = { id: string; name: string; currency: string; account_type: string; balance: AssetDecimal };
export type AssetMeta = { accounts: AssetAccount[]; base_currency: string };
export type AssetSummary = { rows: Array<{ currency: string; cost: AssetDecimal; accumulated_depreciation: AssetDecimal; book_value: AssetDecimal }>; active_assets: number };
export type AssetHistoryEntry = { id: string; period_date: string; amount: AssetDecimal; status: string; journal_entry_id: string };
export type AssetHistory = { asset: Asset; entries: AssetHistoryEntry[] };
export type DepreciationRun = { period_date: string; posting_date: string; posted: Array<{ asset_id: string; asset_code: string; amount: AssetDecimal; currency: string; book_value: AssetDecimal }>; skipped: Array<{ asset_id: string; reason: string }> };
export type AssetForm = { asset_code: string; name: string; category: string; currency: string; acquisition_cost: string; salvage_value: string; acquisition_date: string; in_service_date: string; useful_life_months: string; record_mode: AssetMode; purchase_account_id: string; opening_accumulated_depreciation: string; opening_balance_date: string; reference: string; notes: string };
export type AssetCreateBody = { asset_code: string; name: string; category: string; currency: string; acquisition_cost: string; salvage_value: string; acquisition_date: string; in_service_date: string; useful_life_months: number; depreciation_method: "straight_line"; record_mode: AssetMode; purchase_account_id: string | null; opening_accumulated_depreciation: string; opening_balance_date: string | null; reference: string | null; notes: string | null };
export type AssetBrowse = { search: string; status: "all" | AssetStatus; currency: string; page: number; focus: string };
export const blankAsset = (date: string, currency: string): AssetForm => ({ asset_code: "", name: "", category: "equipment", currency, acquisition_cost: "", salvage_value: "0", acquisition_date: date, in_service_date: date, useful_life_months: "36", record_mode: "purchase", purchase_account_id: "", opening_accumulated_depreciation: "0", opening_balance_date: "", reference: "", notes: "" });
