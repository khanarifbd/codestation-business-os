export type ClientPortalProject = {
  id: string;
  project_number: string;
  client_id: string;
  name: string;
  status: string;
  progress_percent: number;
  planned_start_date: string | null;
  due_date: string | null;
  currency: string;
  contract_value: string | number;
  description: string | null;
  actual_started_at: string | null;
  completed_at: string | null;
};

export type ClientPortalInvoice = {
  id: string;
  invoice_number: string;
  client_id: string;
  project_id: string | null;
  quotation_id: string | null;
  status: string;
  subject: string | null;
  issue_date: string;
  due_date: string | null;
  currency: string;
  total: string | number;
  amount_paid: string | number;
  balance_due: string | number;
};

export type ClientPortalInvoiceDetail = ClientPortalInvoice & {
  seller_name: string;
  seller_email: string | null;
  seller_address: string | null;
  client_name: string;
  client_contact: string | null;
  client_email: string | null;
  client_address: string | null;
  payment_method: string | null;
  payment_account_name: string | null;
  payment_provider: string | null;
  payment_account_holder: string | null;
  payment_account_reference: string | null;
  payment_currency: string | null;
  payment_url: string | null;
  payment_instructions: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  notes: string | null;
  terms_conditions: string | null;
  items: Array<{
    id: string;
    item_name: string;
    description: string;
    quantity: string | number;
    unit: string;
    unit_price: string | number;
    discount_percent: string | number;
    tax_rate: string | number;
    line_total: string | number;
  }>;
  payments: Array<{
    id: string;
    payment_date: string;
    invoice_currency: string;
    invoice_amount: string | number;
    method: string;
    reference: string | null;
  }>;
};

export type ClientPortalQuotation = {
  id: string;
  quotation_number: string;
  client_id: string;
  status: string;
  subject: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  total: string | number;
};

export type ClientPortalQuotationDetail = ClientPortalQuotation & {
  seller_name: string;
  seller_email: string | null;
  seller_address: string | null;
  client_name: string;
  client_contact: string | null;
  client_email: string | null;
  client_address: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  notes: string | null;
  terms_conditions: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  items: Array<{
    id: string;
    item_name: string;
    description: string;
    quantity: string | number;
    unit: string;
    unit_price: string | number;
    discount_percent: string | number;
    tax_rate: string | number;
    line_total: string | number;
  }>;
};
