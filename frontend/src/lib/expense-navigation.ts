import type { Tab } from "@/components/expenses/expense-types";

export const EXPENSES_PATH = "/dashboard/expenses";
export type ExpenseBrowse = {
  tab: Tab;
  search: string;
  status: "" | "posted" | "voided";
  category: string;
  cursor: string;
  page: number;
  focus: string;
};

export function expenseBrowse(raw: string | URLSearchParams): ExpenseBrowse {
  const query = new URLSearchParams(raw);
  const tab = query.get("tab");
  const status = query.get("status");
  const cursor = (query.get("cursor") || "").slice(0, 4095);
  const page = Number(query.get("page"));
  return {
    tab: tab === "vendors" || tab === "categories" || tab === "profitability" ? tab : "expenses",
    search: (query.get("search") || "").slice(0, 300),
    status: status === "posted" || status === "voided" ? status : "",
    category: (query.get("category") || "").slice(0, 200),
    cursor,
    page: cursor ? Number.isSafeInteger(page) && page >= 2 ? page : 2 : 1,
    focus: (query.get("focus") || "").slice(0, 200),
  };
}

export function expensesListHref(value: Partial<ExpenseBrowse> = {}) {
  const query = new URLSearchParams();
  if (value.tab && value.tab !== "expenses") query.set("tab", value.tab);
  if (value.search) query.set("search", value.search);
  if (value.status) query.set("status", value.status);
  if (value.category) query.set("category", value.category);
  if (value.cursor) {
    query.set("cursor", value.cursor);
    query.set("page", String(value.page || 2));
  }
  if (value.focus) query.set("focus", value.focus);
  return EXPENSES_PATH + (query.size ? `?${query}` : "");
}

export function safeExpenseReturn(raw?: string | null) {
  if (!raw || raw !== EXPENSES_PATH && !raw.startsWith(EXPENSES_PATH + "?")) return EXPENSES_PATH;
  return expensesListHref(expenseBrowse(raw.split("?").slice(1).join("?")));
}

export function expenseDocumentHref(id: string, back?: string | null) {
  return `${EXPENSES_PATH}/${encodeURIComponent(id)}?${new URLSearchParams({ returnTo: safeExpenseReturn(back) })}`;
}

export function expenseCreateHref(back?: string | null) {
  return `${EXPENSES_PATH}/new?${new URLSearchParams({ returnTo: safeExpenseReturn(back) })}`;
}

export function expenseReceiptHref(id: string, back?: string | null) {
  return `${EXPENSES_PATH}/${encodeURIComponent(id)}/receipts/new?${new URLSearchParams({ returnTo: safeExpenseReturn(back) })}`;
}

export function expenseSetupCreateHref(kind: "vendors" | "categories", back?: string | null) {
  return `${EXPENSES_PATH}/${kind}/new?${new URLSearchParams({ returnTo: safeExpenseReturn(back || expensesListHref({ tab: kind })) })}`;
}

export function expensesReadApi(value: ExpenseBrowse) {
  const query = new URLSearchParams({ limit: "50" });
  if (value.search.trim()) query.set("search", value.search.trim());
  if (value.status) query.set("status", value.status);
  if (value.category) query.set("category_id", value.category);
  if (value.cursor) query.set("cursor", value.cursor);
  return `/api/finance/expenses?${query}`;
}
