/** Existing Controls API DTO subsets. No account references or unrelated expense metadata. */
export const controlTabs = ["recurring", "automation", "periods"] as const;
export type ControlTab = typeof controlTabs[number];
export const controlFrequencies = ["weekly", "monthly", "quarterly", "yearly"] as const;
export const controlPaymentMethods = ["bank_transfer", "cash", "card", "payoneer", "wise", "stripe", "paypal", "fiverr", "other"] as const;
export type ControlFrequency = typeof controlFrequencies[number];
export type ControlPaymentMethod = typeof controlPaymentMethods[number];
export type ControlMoney = string | number;

export type ControlRecurring = {
  id: string; name: string; description: string;
  vendor_id: string | null; vendor_name: string | null;
  category_id: string; category_name: string;
  account_id: string; account_name: string; account_currency: string;
  client_id: string | null; client_name: string | null;
  project_id: string | null; project_name: string | null;
  expense_currency: string; expense_amount: ControlMoney;
  frequency: string; interval_count: number; next_due_date: string; end_date: string | null;
  tax_amount: ControlMoney; payment_method: string; reference: string | null; notes: string | null;
  is_active: boolean; auto_post: boolean;
  auto_post_last_attempt_at: string | null; auto_post_last_error: string | null;
  last_posted_expense_id: string | null; last_posted_at: string | null;
  created_at: string; updated_at: string;
};
export type ControlAutomation = {
  id: string; name: string; description: string; category_name: string; vendor_name: string | null;
  account_name: string; account_currency: string; expense_currency: string; expense_amount: ControlMoney;
  frequency: string; interval_count: number; next_due_date: string;
  is_active: boolean; auto_post: boolean; eligible: boolean; eligibility_reason: string | null;
  retryable: boolean; last_attempt_at: string | null; last_error: string | null;
};
export type ControlPeriod = {
  id: string; name: string; start_date: string; end_date: string; status: string;
  close_notes: string | null; closed_by_user_id: string | null; closed_at: string | null;
  reopened_by_user_id: string | null; reopened_at: string | null; reopen_reason: string | null;
  created_at: string; updated_at: string;
};
export type ControlAccount = {
  id: string; name: string; account_type: string; currency: string;
  current_balance: ControlMoney; is_active: boolean;
};
export type ControlMeta = {
  vendors: { id: string; name: string; is_active: boolean }[];
  categories: { id: string; name: string; cost_type: string; is_active: boolean }[];
  accounts: { id: string; name: string; currency: string; current_balance: ControlMoney; is_active: boolean }[];
  clients: { id: string; name: string; currency: string | null }[];
  projects: { id: string; number: string; name: string; client_id: string; currency: string; status: string }[];
};
export type RecurringForm = {
  name: string; description: string; category_id: string; account_id: string; vendor_id: string;
  client_id: string; project_id: string; expense_currency: string; expense_amount: string;
  frequency: string; interval_count: string; next_due_date: string; end_date: string; tax_amount: string;
  payment_method: string; reference: string; notes: string;
};
export type RecurringCreateBody = {
  name: string; description: string; category_id: string; account_id: string; vendor_id: string | null;
  client_id: string | null; project_id: string | null; expense_currency: string; expense_amount: string;
  frequency: ControlFrequency; interval_count: number; next_due_date: string; end_date: string | null;
  tax_amount: string; payment_method: ControlPaymentMethod; reference: string | null; notes: string | null;
};
export type PeriodForm = { name: string; start_date: string; end_date: string };
export type PeriodCreateBody = PeriodForm;
export type ControlBrowse = { tab: ControlTab; search: string; status: string; page: number; focus: string };
export type ControlPayload<T> = { body: T | null; error: string | null; warning?: string | null };
