import type {
  ClientPortalInvoice, ClientPortalInvoiceDetail,
  ClientPortalOrder, ClientPortalOrderDetail,
  ClientPortalProject, ClientPortalProjectDetail,
  ClientPortalQuotation, ClientPortalQuotationDetail,
} from "@/lib/client-portal-types";

export type {
  ClientPortalInvoice, ClientPortalInvoiceDetail,
  ClientPortalOrder, ClientPortalOrderDetail,
  ClientPortalProject, ClientPortalProjectDetail,
  ClientPortalQuotation, ClientPortalQuotationDetail,
  ClientPortalMilestone,
} from "@/lib/client-portal-types";

export const portalKinds = ["projects", "orders", "quotations", "invoices"] as const;
export type PortalKind = typeof portalKinds[number];
export type PortalAmount = string | number;
export type PortalRecordMap = {
  projects: ClientPortalProject;
  orders: ClientPortalOrder;
  quotations: ClientPortalQuotation;
  invoices: ClientPortalInvoice;
};
export type PortalDetailMap = {
  projects: ClientPortalProjectDetail;
  orders: ClientPortalOrderDetail;
  quotations: ClientPortalQuotationDetail;
  invoices: ClientPortalInvoiceDetail;
};
export type PortalClient = {
  id: string;
  client_code: string;
  display_name: string;
  client_type: string;
  email: string | null;
  phone: string | null;
  currency: string | null;
  is_primary_contact: boolean;
};
export type PortalFinancial = {
  currency: string;
  invoice_count: number;
  invoiced_total: PortalAmount;
  balance_due: PortalAmount;
};
export type PortalContext = {
  organization_id: string;
  organization_name: string;
  membership_id: string;
  clients: PortalClient[];
  project_count: number;
  order_count: number;
  quotation_count: number;
  financials: PortalFinancial[];
};
