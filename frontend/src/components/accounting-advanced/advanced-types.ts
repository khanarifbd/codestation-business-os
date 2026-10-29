export type Category = "asset" | "liability" | "equity" | "income" | "expense";
export type LedgerAccount = {
  id: string;
  code: string;
  name: string;
  category: Category;
  subtype: string | null;
  normal_balance: "debit" | "credit";
  parent_id: string | null;
  system_key: string | null;
  is_system: boolean;
  is_active: boolean;
  allow_manual_posting: boolean;
  notes: string | null;
};
export type TrialBalance = {
  as_of: string | null;
  accounting_currency: string;
  functional_period_start: string;
  total_debit: string | number;
  total_credit: string | number;
  rows: Array<{
    ledger_account_id: string;
    code: string;
    name: string;
    category: Category;
    debit: string | number;
    credit: string | number;
    balance: string | number;
  }>;
};
export type Journal = {
  id: string;
  entry_number: string;
  entry_date: string;
  functional_currency: string;
  status: string;
  source_type: string;
  source_id: string | null;
  reference: string | null;
  memo: string | null;
  total_debit: string | number;
  total_credit: string | number;
  created_at: string;
  posted_at: string;
  lines: Array<{
    id: string;
    ledger_account_id: string;
    account_code: string;
    account_name: string;
    description: string | null;
    currency: string;
    exchange_rate_to_base: string | number;
    debit: string | number;
    credit: string | number;
    original_amount: string | number;
  }>;
};
export type JournalFilter = "all" | "manual" | "operational" | "reversal";
export type AccountStatusFilter = "all" | "active" | "inactive";

export type AccountForm = {
  code: string;
  name: string;
  category: Category;
  subtype: string;
  normal_balance: "debit" | "credit";
  parent_id: string;
  allow_manual_posting: boolean;
  notes: string;
};

export const categories: Category[] = ["asset", "liability", "equity", "income", "expense"];
export const blankLedger: AccountForm = {
  code: "",
  name: "",
  category: "asset",
  subtype: "",
  normal_balance: "debit",
  parent_id: "",
  allow_manual_posting: true,
  notes: "",
};

export type CorrectionType = "payment" | "expense" | "transfer" | "money_entry" | "customer_advance" | "customer_advance_application" | "payable_payment" | "loan_disbursement" | "loan_repayment" | "fixed_asset" | "asset_depreciation" | "tax_settlement" | "payroll_withholding_payment" | "payroll_run" | "owner_equity";
export type Candidate = {
  source_type: CorrectionType;
  source_id: string;
  number: string;
  date: string;
  amount: string | number;
  currency: string;
  title: string;
  subtitle: string;
};
export type CorrectionHistory = {
  id: string;
  source_type: string;
  source_id: string | null;
  action: string;
  message: string | null;
  reason: string | null;
  reversal_date: string | null;
  reversal_journal_id: string | null;
  status: string;
  actor_user_id: string | null;
  created_at: string;
};
export type TypeOption = { value: CorrectionType; title: string; help: string };

export const correctionTypes: TypeOption[] = [
  { value: "payment", title: "Customer payment", help: "Invoice collection recorded in Money In" },
  { value: "expense", title: "Expense", help: "Posted company, project or client expense" },
  { value: "transfer", title: "Account transfer", help: "Transfer between your own financial accounts" },
  { value: "money_entry", title: "Direct Money In/Out", help: "Direct income or expense posted from the accounting money workspace" },
  { value: "customer_advance", title: "Customer advance", help: "Customer funds received before an invoice" },
  { value: "customer_advance_application", title: "Advance application", help: "Customer credit applied against an invoice" },
  { value: "payable_payment", title: "Supplier payment", help: "Payment made against a supplier bill" },
  { value: "loan_disbursement", title: "Loan received", help: "Loan principal disbursed into a business account" },
  { value: "loan_repayment", title: "Loan repayment", help: "Principal, interest or fee paid to a lender" },
  { value: "fixed_asset", title: "Fixed asset", help: "Asset purchase or opening balance posting" },
  { value: "asset_depreciation", title: "Asset depreciation", help: "Posted monthly depreciation entry" },
  { value: "tax_settlement", title: "Tax settlement", help: "Tax payment, refund or input-tax offset" },
  { value: "payroll_withholding_payment", title: "Payroll withholding", help: "Employee deduction or payroll-tax remittance" },
  { value: "payroll_run", title: "Payroll run", help: "Approved accrual or paid payroll" },
  { value: "owner_equity", title: "Owner equity", help: "Owner contribution or drawing" },
];


export type AdvancedBrowse = { tab: "trial" | "journals" | "chart"; search: string; asOf: string; source: JournalFilter; category: "all" | Category; status: AccountStatusFilter; page: number; focus: string };
export type CorrectionBrowse = { tab: "candidates" | "history"; type: CorrectionType | "all"; search: string; page: number; focus: string };
export type AdjustmentForm = { entry_date: string; debit_account_id: string; credit_account_id: string; amount: string; currency: string; reference: string; memo: string };
export const blankAdjustment: AdjustmentForm = { entry_date: "", debit_account_id: "", credit_account_id: "", amount: "", currency: "", reference: "", memo: "" };
export type CorrectionResult = { source_type: CorrectionType; source_id: string; number: string; reversal_date: string; reversal_journal_id: string | null; accounting_note: string };
