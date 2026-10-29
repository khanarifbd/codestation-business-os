import { formatMoneyExact } from "@/lib/sales-money-preview";
export type TransferAccount = { id: string; name: string; account_type: string; provider_name: string | null; currency: string; current_balance: string | number; is_active: boolean };
export type Transfer = {
  id: string; transfer_number: string; from_account_id: string; from_account_name: string; to_account_id: string; to_account_name: string;
  transfer_date: string; source_currency: string; destination_currency: string; source_amount: string | number; fee_amount: string | number;
  net_source_amount: string | number; destination_amount: string | number; exchange_rate: string | number; reference: string | null; notes: string | null; status: string; created_at: string;
};
export type TransferPage = { items: Transfer[]; next_cursor: string | null };
export type TransferValues = { from_account_id: string; to_account_id: string; transfer_date: string; source_amount: string; fee_amount: string; destination_amount: string; reference: string; notes: string };
export type TransferBrowse = { search: string; currency: string; account_id: string; size: number; cursor: string; page: number; focus: string };
export const initialTransferValues = (): TransferValues => ({ from_account_id: "", to_account_id: "", transfer_date: "", source_amount: "", fee_amount: "0", destination_amount: "", reference: "", notes: "" });
const record = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === "object" && !Array.isArray(x));
const nullableString = (x: unknown) => x === null || typeof x === "string";
/** Decimal strings are sent unchanged by the existing transfer contract. No Number/EPSILON arithmetic. */
function ratio(value: string | number): { n: bigint; d: bigint } | null {
  const raw = String(value).trim();
  if (!raw || raw.length > 100) return null;
  const m = /^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(raw);
  if (!m) return null;
  const exponent = Number(m[4] || 0) - (m[3]?.length || 0);
  if (!Number.isInteger(exponent) || Math.abs(exponent) > 400) return null;
  const n = BigInt(`${m[1] === "-" ? "-" : ""}${m[2]}${m[3] || ""}`);
  return exponent < 0 ? { n, d: BigInt("1" + "0".repeat(-exponent)) } : { n: n * BigInt("1" + "0".repeat(exponent)), d: BigInt(1) };
}
const halfUp = (n: bigint, d: bigint) => { const sign = n < BigInt(0) ? -BigInt(1) : BigInt(1), a = n * sign; return sign * (a / d + (a % d * BigInt(2) >= d ? BigInt(1) : BigInt(0))); };
const scaledText = (n: bigint, digits: number) => { const sign = n < BigInt(0) ? "-" : "", a = n < BigInt(0) ? -n : n, scale = BigInt(10) ** BigInt(digits); return `${sign}${a / scale}.${String(a % scale).padStart(digits, "0")}`; };
export function transferCents(value: string | number): bigint | null { const r = ratio(value); return r ? halfUp(r.n * BigInt(100), r.d) : null; }
const amount = (x: unknown) => (typeof x === "string" || typeof x === "number") && ratio(x) !== null;
export function isTransferAccountList(value: unknown): value is TransferAccount[] {
  return Array.isArray(value) && value.every(x => record(x) && ["id", "name", "account_type", "currency"].every(k => typeof x[k] === "string") && nullableString(x.provider_name) && amount(x.current_balance) && typeof x.is_active === "boolean");
}
export function isTransfer(value: unknown): value is Transfer {
  return record(value) && ["id", "transfer_number", "from_account_id", "from_account_name", "to_account_id", "to_account_name", "transfer_date", "source_currency", "destination_currency", "status", "created_at"].every(k => typeof value[k] === "string" && value[k] !== "") && ["source_amount", "fee_amount", "net_source_amount", "destination_amount", "exchange_rate"].every(k => amount(value[k])) && nullableString(value.reference) && nullableString(value.notes);
}
export function isTransferPage(value: unknown): value is TransferPage { return record(value) && nullableString(value.next_cursor) && Array.isArray(value.items) && value.items.every(isTransfer); }
export const eligibleTransferAccount = (account: TransferAccount) => account.is_active && account.account_type !== "credit_card";
export function transferPreview(values: TransferValues, source: TransferAccount | null, destination: TransferAccount | null) {
  if (!source || !destination) return { error: "Choose the source and destination accounts.", amounts: null };
  if (!eligibleTransferAccount(source) || !eligibleTransferAccount(destination) || source.id === destination.id) return { error: "Choose two different active non-card accounts.", amounts: null };
  const s = ratio(values.source_amount), f = ratio(values.fee_amount || "0"), d = ratio(values.destination_amount);
  const max = BigInt("1000000000000"), zero = BigInt(0);
  if (!s || s.n <= zero || s.n > max * s.d || !f || f.n < zero || f.n > max * f.d) return { error: "Enter a valid positive deduction and a non-negative fee (up to 1,000,000,000,000).", amounts: null };
  const sourceCents = halfUp(s.n * BigInt(100), s.d), feeCents = halfUp(f.n * BigInt(100), f.d), netCents = sourceCents - feeCents;
  if (netCents <= zero) return { error: "The rounded fee must be lower than the rounded total deduction.", amounts: null };
  const balance = transferCents(source.current_balance);
  if (balance === null) return { error: "The source balance could not be verified. Reload accounts.", amounts: null };
  if (sourceCents > balance) return { error: `The deduction exceeds the last loaded balance of ${formatMoneyExact(source.current_balance, source.currency)}.`, amounts: null };
  const sameCurrency = source.currency === destination.currency;
  if (!sameCurrency && (!d || d.n <= zero || d.n > BigInt("1000000000000000") * d.d)) return { error: "Enter the actual amount received in the destination currency (up to 1,000,000,000,000,000).", amounts: null };
  const receivedCents = sameCurrency ? netCents : halfUp(d!.n * BigInt(100), d!.d);
  // A sub-cent amount that rounds to zero cannot describe an actual receipt.
  if (receivedCents <= zero) return { error: "The actual received amount must round to at least 0.01.", amounts: null };
  const rate = sameCurrency ? BigInt(100000000) : halfUp(receivedCents * BigInt(100000000), netCents);
  if (rate > BigInt("999999999999999999")) return { error: "This exchange rate exceeds the stored transfer precision.", amounts: null };
  if (values.reference.length > 180) return { error: "Reference must be 180 characters or fewer.", amounts: null };
  return { error: null, amounts: { source: scaledText(sourceCents, 2), fee: scaledText(feeCents, 2), net: scaledText(netCents, 2), received: scaledText(receivedCents, 2), rate: scaledText(rate, 8), sameCurrency } };
}
export function transferPayload(values: TransferValues, sameCurrency: boolean) {
  return { from_account_id: values.from_account_id, to_account_id: values.to_account_id, transfer_date: values.transfer_date || null, source_amount: values.source_amount, fee_amount: values.fee_amount || "0", destination_amount: sameCurrency ? null : values.destination_amount, reference: values.reference || null, notes: values.notes || null };
}
export const transferMoney = formatMoneyExact;
export function transferRate(value: string | number) { const r = ratio(value); return r ? scaledText(halfUp(r.n * BigInt(100000000), r.d), 8) : "—"; }
