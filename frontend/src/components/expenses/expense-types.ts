// Existing expense API contracts, extracted from the verified register.
export type Tab = "expenses" | "vendors" | "categories" | "profitability";
export type Vendor = { id:string; vendor_code:string; name:string; contact_name:string|null; email:string|null; phone:string|null; website:string|null; tax_identifier:string|null; country_code:string|null; currency:string|null; notes:string|null; is_active:boolean; created_at:string; updated_at:string };
export type Category = { id:string; name:string; slug:string; cost_type:string; is_active:boolean; sort_order:number; created_at:string; updated_at:string };
export type Account = { id:string; name:string; currency:string; current_balance:string|number; is_active:boolean };
export type Client = { id:string; code:string; name:string; currency:string|null };
export type Project = { id:string; number:string; name:string; order_id:string; client_id:string; client_name:string; currency:string; status:string };
export type Order = { id:string; number:string; client_id:string; client_name:string; currency:string; total:string|number; status:string };
export type Invoice = { id:string; number:string; client_id:string; client_name:string; order_id:string|null; project_id:string|null; currency:string; total:string|number; status:string };
export type Payment = { id:string; number:string; invoice_id:string; invoice_number:string; client_id:string; client_name:string; invoice_currency:string; invoice_amount:string|number; payment_date:string; status:string };
// Context rows resolve ancestors of suggestions; they are not additional choices.
// Optional for compatibility with older servers. Missing ancestors fail closed.
export type RelationshipContext = { invoices:Invoice[]; projects:Project[]; orders:Order[] };
export type Meta = { vendors:Vendor[]; categories:Category[]; accounts:Account[]; clients:Client[]; projects:Project[]; orders:Order[]; invoices:Invoice[]; payments:Payment[]; relationship_context?:RelationshipContext };
export type CurrencySummary = { currency:string; posted_expenses:string|number; transfer_fees:string|number; stripe_processing_fees?:string|number };
export type Summary = { expense_count:number; posted_count:number; voided_count:number; vendor_count:number; receipt_count:number; project_expense_count:number; by_currency:CurrencySummary[] };
export type ExpenseDoc = { id:string; expense_id:string; title:string; document_type:string; original_filename:string; content_type:string|null; size_bytes:number; notes:string|null; uploaded_by_user_id:string; created_at:string };
export type ExpenseRow = { id:string; expense_number:string; description:string; expense_date:string; vendor_id:string|null; vendor_name:string|null; category_id:string; category_name:string; cost_type:string; account_id:string; account_name:string; client_id:string|null; client_name:string|null; project_id:string|null; project_number:string|null; project_name:string|null; order_id:string|null; order_number:string|null; invoice_id:string|null; invoice_number:string|null; payment_id:string|null; payment_number:string|null; expense_currency:string; expense_amount:string|number; account_currency:string; account_amount:string|number; exchange_rate:string|number; profitability_currency:string; profitability_amount:string|number; tax_amount:string|number; payment_method:string; reference:string|null; status:string; document_count:number; created_at:string };
export type ExpenseDetail = ExpenseRow & { profitability_exchange_rate:string|number; notes:string|null; voided_at:string|null; documents:ExpenseDoc[] };
export type Pnl = { currency:string; invoice_revenue:string|number; operating_expenses:string|number; transfer_fees:string|number; stripe_processing_fees?:string|number; net_profit:string|number };
export type ProjectProfit = { project_id:string; project_number:string; project_name:string; client_name:string; currency:string; contract_value:string|number; invoiced_revenue:string|number; collected_revenue:string|number; direct_expenses:string|number; estimated_profit:string|number; margin_percent:string|number|null };
export type ClientProfit = { client_id:string; client_name:string; currency:string; invoiced_revenue:string|number; collected_revenue:string|number; direct_expenses:string|number; estimated_profit:string|number; margin_percent:string|number|null };
export type Profitability = { profit_loss_by_currency:Pnl[]; projects:ProjectProfit[]; clients:ClientProfit[] };
export type ExpensePage = { items:ExpenseRow[]; next_cursor:string|null };

export type ExpenseForm = {
  description:string; category_id:string; account_id:string; vendor_id:string; client_id:string; project_id:string; order_id:string; invoice_id:string; payment_id:string;
  expense_date:string; expense_currency:string; expense_amount:string; account_amount:string; profitability_amount:string;
  tax_amount:string; payment_method:string; reference:string; notes:string;
};

