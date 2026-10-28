import type { AccountLedgerBrowse } from "@/components/accounting-accounts/account-model";
import { statementDate, statementId } from "@/components/accounting-statements/statement-model";
export const STATEMENTS_PATH = "/dashboard/accounting/reports";
export const ACCOUNT_STATEMENT_PATH = STATEMENTS_PATH + "/account-statement";
export const STATEMENT_SECTIONS = ["profit-loss", "balance-sheet", "cash-flow"] as const;
export type StatementSection = typeof STATEMENT_SECTIONS[number];
export type StatementPeriod = { from: string; to: string; section: StatementSection; invalid: boolean };
export function statementPeriod(raw: string | URLSearchParams): StatementPeriod {
  const p = new URLSearchParams(raw), from = p.get("date_from") || "", to = p.get("date_to") || "", section = p.get("section");
  return { from, to, section: STATEMENT_SECTIONS.includes(section as StatementSection) ? section as StatementSection : "profit-loss", invalid: Boolean(from && !statementDate(from) || to && !statementDate(to)) };
}
export function statementsHref(value: Pick<StatementPeriod, "from" | "to" | "section">) {
  const p = new URLSearchParams();
  if (value.from) p.set("date_from", value.from);
  if (value.to) p.set("date_to", value.to);
  if (value.section !== "profit-loss") p.set("section", value.section);
  return STATEMENTS_PATH + (p.size ? `?${p}` : "");
}
export function statementsApi(value: Pick<StatementPeriod, "from" | "to">) {
  const p = new URLSearchParams();
  if (value.from) p.set("date_from", value.from);
  if (value.to) p.set("date_to", value.to);
  return "/api/accounting/reports/financial-statements" + (p.size ? `?${p}` : "");
}
export function safeStatementsReturn(raw: string | null) {
  if (!raw || raw.includes("#") || raw !== STATEMENTS_PATH && !raw.startsWith(STATEMENTS_PATH + "?")) return STATEMENTS_PATH;
  const period = statementPeriod(raw.slice(STATEMENTS_PATH.length + 1));
  return period.invalid ? STATEMENTS_PATH : statementsHref(period);
}
export type StatementBrowse = AccountLedgerBrowse & { account: string; invalid: boolean; returnTo: string };
export function statementBrowse(raw: string | URLSearchParams): StatementBrowse {
  const p = new URLSearchParams(raw), account = p.get("account") || p.get("account_id") || "", from = p.get("date_from") || "", to = p.get("date_to") || "";
  const cursor = p.get("cursor") || "", direction = p.get("direction"), page = Number(p.get("page"));
  return { account, invalid: Boolean(account && !statementId(account) || from && !statementDate(from) || to && !statementDate(to) || cursor.length >= 4096),
    search: (p.get("search") || "").slice(0, 500), source_type: (p.get("source_type") || "").slice(0, 80), direction: direction === "credit" || direction === "debit" ? direction : "all",
    date_from: from, date_to: to, size: 50, cursor, page: cursor ? Number.isSafeInteger(page) && page > 1 ? page : 2 : 1, returnTo: safeStatementsReturn(p.get("returnTo")) };
}
export function statementAccountHref(value: Partial<StatementBrowse> = {}) {
  const p = new URLSearchParams();
  for (const key of ["account", "search", "source_type", "date_from", "date_to"] as const) if (value[key]) p.set(key, value[key]!);
  if (value.direction && value.direction !== "all") p.set("direction", value.direction);
  if (value.cursor) { p.set("cursor", value.cursor); p.set("page", String(value.page || 2)); }
  if (value.returnTo) p.set("returnTo", safeStatementsReturn(value.returnTo));
  return ACCOUNT_STATEMENT_PATH + (p.size ? `?${p}` : "");
}
