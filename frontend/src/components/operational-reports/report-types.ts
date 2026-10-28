export type ReportAmount = string | number;
export type ReportFinancial = {
  currency: string;
  invoiced_revenue: ReportAmount;
  direct_income: ReportAmount;
  collected_revenue: ReportAmount;
  receivables: ReportAmount;
  expenses: ReportAmount;
  platform_fees: ReportAmount;
  transfer_fees: ReportAmount;
  net_profit: ReportAmount;
};
export type ReportTrend = Pick<ReportFinancial, "currency" | "invoiced_revenue" | "direct_income" | "collected_revenue" | "expenses" | "transfer_fees" | "net_profit"> & { period: string };
export type ReportAccount = { account_id: string; account_name: string; account_type: string; currency: string; balance: ReportAmount };
export type ReportClient = {
  client_id: string;
  client_name: string;
  currency: string;
  invoiced_revenue: ReportAmount;
  collected_revenue: ReportAmount;
  direct_expenses: ReportAmount;
  estimated_profit: ReportAmount;
  margin_percent: ReportAmount | null;
};
export type ReportProject = Omit<ReportClient, "client_id"> & {
  project_id: string;
  project_number: string;
  project_name: string;
  contract_value: ReportAmount;
};
export const operationKeys = ["active_clients", "open_orders", "active_projects", "overdue_tasks", "due_followups", "open_invoices"] as const;
export type ReportsOverview = {
  reporting_basis: "operational";
  date_from: string;
  date_to: string;
  financials: ReportFinancial[];
  trend: ReportTrend[];
  accounts: ReportAccount[];
  operations: Record<typeof operationKeys[number], number>;
  projects: ReportProject[];
  clients: ReportClient[];
};
export type ReportOption = { id: string; label: string };
export type ReportsMeta = { currencies: string[]; clients: ReportOption[]; projects: ReportOption[] };
export type ReportFilters = { date_from: string; date_to: string; currency: string; client_id: string; project_id: string };
export const reportSections = ["performance", "position", "projects", "clients"] as const;
export type ReportSection = typeof reportSections[number];
export type ReportBrowse = ReportFilters & { section: ReportSection };
export const trendSeries = [
  { key: "invoiced_revenue", label: "Invoiced", tone: "invoiced" },
  { key: "direct_income", label: "Direct income", tone: "direct" },
  { key: "collected_revenue", label: "Collected", tone: "collected" },
  { key: "expenses", label: "Expenses", tone: "expenses" },
] as const;
