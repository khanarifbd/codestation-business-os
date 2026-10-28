export type TaxDecimal = string | number;
export const taxKinds = ["sales", "purchase", "withholding"] as const;
export type TaxKind = typeof taxKinds[number];
export const settlementTypes = ["indirect_tax_payment", "withholding_tax_payment", "input_tax_refund", "input_tax_offset"] as const;
export type SettlementType = typeof settlementTypes[number];
export const settlementLabels: Record<SettlementType, string> = { indirect_tax_payment: "Indirect tax payment", withholding_tax_payment: "Withholding tax payment", input_tax_refund: "Input tax refund", input_tax_offset: "Input tax offset" };
export type TaxCode = { id: string; code: string; name: string; tax_kind: TaxKind; rate: TaxDecimal; recoverable_percent: TaxDecimal; country_code: string | null; jurisdiction: string | null; effective_from: string | null; effective_to: string | null; is_active: boolean; notes: string | null };
export type TaxCodeForm = { code: string; name: string; tax_kind: TaxKind; rate: string; recoverable_percent: string; country_code: string; jurisdiction: string; effective_from: string; effective_to: string; notes: string; is_active: boolean };
export type TaxCodeCreateBody = { code: string; name: string; tax_kind: TaxKind; rate: string; recoverable_percent: string; country_code: string | null; jurisdiction: string | null; effective_from: string | null; effective_to: string | null; notes: string | null };
export type TaxCodePatch = Partial<Pick<TaxCodeCreateBody, "name" | "rate" | "recoverable_percent" | "jurisdiction" | "effective_from" | "effective_to" | "notes">> & { is_active?: boolean };
export type TaxReportRow = { currency: string; output_tax: TaxDecimal; input_tax: TaxDecimal; recoverable_input_tax: TaxDecimal; withholding_tax: TaxDecimal; net_indirect_tax_payable: TaxDecimal };
export type TaxReport = { date_from: string; date_to: string; rows: TaxReportRow[] };
/** Metadata already limits accounts to active, same-functional-currency, non-credit-card accounts. */
export type SettlementMeta = { currency: string; accounts: Array<{ id: string; name: string; balance: TaxDecimal }> };
/** Original record only: the existing endpoint provides no reversal/status/journal field. */
export type TaxSettlement = { id: string; settlement_type: SettlementType; settlement_date: string; currency: string; amount: TaxDecimal; account_id: string | null; reference: string | null; notes: string | null; created_at: string };
export type SettlementForm = { settlement_type: SettlementType; settlement_date: string; amount: string; account_id: string; reference: string; notes: string };
export type SettlementBody = { settlement_type: SettlementType; settlement_date: string; amount: string; account_id: string | null; reference: string | null; notes: string | null };
export type TaxReportBrowse = { date_from: string; date_to: string };
export type TaxCodeBrowse = { search: string; kind: "all" | TaxKind; active: "all" | "active" | "inactive"; page: number; focus: string };
export type SettlementBrowse = { search: string; type: "all" | SettlementType; currency: string; page: number; focus: string };
export const blankTaxCode = (): TaxCodeForm => ({ code: "", name: "", tax_kind: "sales", rate: "0", recoverable_percent: "100", country_code: "", jurisdiction: "", effective_from: "", effective_to: "", notes: "", is_active: true });
export const blankSettlement = (date: string): SettlementForm => ({ settlement_type: "indirect_tax_payment", settlement_date: date, amount: "", account_id: "", reference: "", notes: "" });
