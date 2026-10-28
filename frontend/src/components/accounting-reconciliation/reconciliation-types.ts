export type ReconciliationAccount = {
  id: string; name: string; account_type: string; currency: string;
  last_reconciled_date: string | null; last_statement_balance: string | number | null;
};
export type ReconciliationMeta = { accounts: ReconciliationAccount[] };
export type ReconciliationSession = {
  id: string; account_id: string; account_name: string; currency: string;
  statement_start_date: string | null; statement_end_date: string;
  statement_ending_balance: string | number; cleared_book_balance: string | number; difference: string | number;
  status: "draft" | "finalized"; matched_transactions: number; notes: string | null;
  finalized_at: string | null; created_at: string;
};
export type ReconciliationTransaction = {
  id: string; transaction_date: string; direction: "credit" | "debit"; amount: string | number;
  currency: string; source_type: string; reference: string | null; description: string | null; selected: boolean;
};
export type ReconciliationDetail = ReconciliationSession & { transactions: ReconciliationTransaction[]; unmatched_count: number };
export type ReconciliationValues = { account_id: string; statement_end_date: string; statement_ending_balance: string; notes: string };
export type ReconciliationBrowse = { search: string; status: "" | "draft" | "finalized"; account: string; page: number; focus: string };
export type ReconciliationSelection = { search: string; filter: "all" | "matched" | "unmatched"; page: number };
export type ReconciliationOperation = {
  sessionId: string; kind: "match" | "unmatch" | "finalize" | "discard"; transactionId?: string;
  label: string; currency: string; amount: string | number; account: string; statementEnd: string;
};
