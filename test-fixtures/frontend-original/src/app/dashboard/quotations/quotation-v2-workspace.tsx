"use client";

import {
  Ban,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Loader2,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  WalletCards,
  XCircle,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";

type EmployeeOption = { id: string; employee_code: string; full_name: string };
type ClientOption = {
  id: string;
  client_code: string;
  display_name: string;
  currency: string | null;
  contact_name: string | null;
};
type Meta = {
  default_currency: string;
  default_tax_calculation_mode: string;
  default_tax_rate: string | number;
  default_validity_days: number;
  employees: EmployeeOption[];
};
type Summary = {
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  rejected: number;
  cancelled: number;
};
type QuotationRow = {
  id: string;
  quotation_number: string;
  client_id: string;
  client_name: string;
  status: string;
  subject: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  total: string | number;
  assigned_employee_id: string | null;
  assigned_employee_name: string | null;
  is_expired: boolean;
  created_at: string;
  updated_at: string;
};
type CoreItem = {
  id: string;
  product_id: string | null;
  lead_interest_id: string | null;
  sort_order: number;
  item_name_snapshot: string;
  sku_snapshot: string | null;
  item_type_snapshot: string;
  unit_snapshot: string;
  description: string;
  quantity: string | number;
  unit_price: string | number;
  discount_percent: string | number;
  tax_rate: string | number;
  line_subtotal: string | number;
  discount_amount: string | number;
  taxable_amount: string | number;
  tax_amount: string | number;
  line_total: string | number;
};
type CoreDetail = QuotationRow & {
  source_lead_id: string | null;
  tax_calculation_mode: string;
  seller_name_snapshot: string;
  seller_email_snapshot: string | null;
  seller_address_snapshot: string | null;
  seller_tax_identifier_snapshot: string | null;
  client_name_snapshot: string;
  client_contact_snapshot: string | null;
  client_email_snapshot: string | null;
  client_address_snapshot: string | null;
  client_tax_identifier_snapshot: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  notes: string | null;
  terms_conditions: string | null;
  internal_notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  items: CoreItem[];
};
type CatalogOption = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  item_type: string;
  unit: string;
  currency: string;
  selling_price: string | number;
  tax_rate: string | number | null;
};
type LeadSource = {
  lead_id: string;
  lead_code: string;
  client_id: string;
  client_name: string;
  currency: string;
  subject: string;
  interests: {
    id: string;
    product_id: string | null;
    item_name: string;
    description: string | null;
    item_type: string;
    unit: string;
    currency: string;
    quantity: string | number;
    estimated_unit_price: string | number | null;
  }[];
};
type CommercialSection = {
  id: string;
  section_type: string;
  title: string | null;
  content: string;
  sort_order: number;
  is_visible: boolean;
};
type DeliveryMilestone = {
  id: string;
  title: string;
  description: string | null;
  estimated_start_date: string | null;
  estimated_end_date: string | null;
  estimated_duration: string | null;
  acceptance_criteria: string | null;
  sort_order: number;
};
type PaymentMilestone = {
  id: string;
  quotation_milestone_id: string | null;
  title: string;
  description: string | null;
  payment_type: string;
  percentage: string | number | null;
  amount: string | number;
  due_condition: string | null;
  due_date: string | null;
  sort_order: number;
};
type CommercialDetail = {
  id: string;
  quotation_number: string;
  root_quotation_id: string | null;
  supersedes_quotation_id: string | null;
  revision_number: number;
  revision_reason: string | null;
  status: string;
  client_id: string;
  source_lead_id: string | null;
  assigned_employee_id: string | null;
  subject: string | null;
  project_title: string | null;
  executive_summary: string | null;
  issue_date: string;
  valid_until: string | null;
  estimated_start_date: string | null;
  estimated_end_date: string | null;
  estimated_duration: string | null;
  start_condition: string | null;
  currency: string;
  tax_calculation_mode: string;
  seller_name_snapshot: string;
  seller_email_snapshot: string | null;
  seller_phone_snapshot: string | null;
  seller_address_snapshot: string | null;
  seller_tax_identifier_snapshot: string | null;
  client_name_snapshot: string;
  client_contact_snapshot: string | null;
  client_email_snapshot: string | null;
  client_phone_snapshot: string | null;
  client_address_snapshot: string | null;
  client_tax_identifier_snapshot: string | null;
  prepared_by_name_snapshot: string | null;
  prepared_by_email_snapshot: string | null;
  prepared_by_designation_snapshot: string | null;
  subtotal: string | number;
  discount_total: string | number;
  tax_total: string | number;
  total: string | number;
  internal_notes: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  cancelled_at: string | null;
  items: CoreItem[];
  sections: CommercialSection[];
  milestones: DeliveryMilestone[];
  payment_milestones: PaymentMilestone[];
  created_at: string;
  updated_at: string;
};
type RevisionRow = {
  id: string;
  quotation_number: string;
  revision_number: number;
  revision_reason: string | null;
  status: string;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  total: string | number;
  created_at: string;
};
type DraftItem = {
  product_id: string | null;
  lead_interest_id: string | null;
  item_name: string;
  item_type: "service" | "non_stock_item";
  unit: string;
  description: string;
  quantity: number;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
};
type DraftSection = {
  section_type: string;
  title: string;
  content: string;
  is_visible: boolean;
};
type DraftMilestone = {
  source_id: string | null;
  title: string;
  description: string;
  estimated_start_date: string;
  estimated_end_date: string;
  estimated_duration: string;
  acceptance_criteria: string;
};
type DraftPayment = {
  title: string;
  description: string;
  payment_type: "percentage" | "fixed";
  percentage: number;
  amount: number;
  due_condition: string;
  due_date: string;
  milestone_index: number | null;
};
type EditorTab = "pricing" | "overview" | "sections" | "delivery" | "payments" | "review";

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500";
const textareaClass =
  "mt-2 min-h-28 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-neutral-500 disabled:cursor-not-allowed disabled:bg-neutral-50 disabled:text-neutral-500";

const SECTION_TYPES = [
  ["scope", "Scope of work"],
  ["deliverables", "Deliverables"],
  ["client_responsibilities", "Client responsibilities"],
  ["exclusions", "Exclusions"],
  ["third_party_costs", "Third-party costs"],
  ["support_warranty", "Support & warranty"],
  ["change_request_policy", "Change request policy"],
  ["ip_terms", "IP / source-code terms"],
  ["confidentiality", "Confidentiality"],
  ["terms_conditions", "Terms & conditions"],
  ["additional_notes", "Additional notes"],
] as const;

const STANDARD_SECTIONS: DraftSection[] = [
  { section_type: "scope", title: "Scope of work", content: "", is_visible: true },
  { section_type: "deliverables", title: "Deliverables", content: "", is_visible: true },
  {
    section_type: "client_responsibilities",
    title: "Client responsibilities",
    content: "",
    is_visible: true,
  },
  { section_type: "exclusions", title: "Exclusions", content: "", is_visible: true },
  { section_type: "support_warranty", title: "Support & warranty", content: "", is_visible: true },
  { section_type: "ip_terms", title: "IP / source-code terms", content: "", is_visible: true },
  { section_type: "terms_conditions", title: "Terms & conditions", content: "", is_visible: true },
];

function localDate(value = new Date()) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(text: string, days: number) {
  const [year, month, day] = text.split("-").map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + days);
  return localDate(value);
}

function money(value: string | number | null | undefined, currency: string) {
  return `${currency} ${Number(value || 0).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function errorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const detail = (payload as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const message = (item as { msg?: unknown }).msg;
        return typeof message === "string" ? message : null;
      })
      .filter(Boolean);
    if (messages.length) return messages.join(" ");
  }
  return fallback;
}

function previewLine(item: DraftItem, mode: string) {
  const subtotal = item.quantity * item.unit_price;
  const discount = (subtotal * item.discount_percent) / 100;
  const taxable = Math.max(0, subtotal - discount);
  const tax =
    item.tax_rate > 0
      ? mode === "inclusive"
        ? taxable - taxable / (1 + item.tax_rate / 100)
        : (taxable * item.tax_rate) / 100
      : 0;
  return { subtotal, discount, tax, total: mode === "inclusive" ? taxable : taxable + tax };
}

function blankItem(taxRate = 0): DraftItem {
  return {
    product_id: null,
    lead_interest_id: null,
    item_name: "",
    item_type: "service",
    unit: "unit",
    description: "",
    quantity: 1,
    unit_price: 0,
    discount_percent: 0,
    tax_rate: taxRate,
  };
}

function blankSection(): DraftSection {
  return { section_type: "scope", title: "Scope of work", content: "", is_visible: true };
}

function blankMilestone(): DraftMilestone {
  return {
    source_id: null,
    title: "",
    description: "",
    estimated_start_date: "",
    estimated_end_date: "",
    estimated_duration: "",
    acceptance_criteria: "",
  };
}

function blankPayment(): DraftPayment {
  return {
    title: "",
    description: "",
    payment_type: "percentage",
    percentage: 0,
    amount: 0,
    due_condition: "",
    due_date: "",
    milestone_index: null,
  };
}

export function QuotationV2Workspace() {
  const router = useRouter();
  const prefillHandled = useRef(false);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [core, setCore] = useState<CoreDetail | null>(null);
  const [proposal, setProposal] = useState<CommercialDetail | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [catalog, setCatalog] = useState<CatalogOption[]>([]);
  const [tab, setTab] = useState<EditorTab>("pricing");

  const [sourceLeadId, setSourceLeadId] = useState<string | null>(null);
  const [clientId, setClientId] = useState("");
  const [subject, setSubject] = useState("");
  const [issueDate, setIssueDate] = useState(localDate());
  const [validUntil, setValidUntil] = useState("");
  const [currency, setCurrency] = useState("");
  const [taxMode, setTaxMode] = useState("exclusive");
  const [assignedEmployeeId, setAssignedEmployeeId] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<DraftItem[]>([blankItem()]);

  const [projectTitle, setProjectTitle] = useState("");
  const [executiveSummary, setExecutiveSummary] = useState("");
  const [estimatedStartDate, setEstimatedStartDate] = useState("");
  const [estimatedEndDate, setEstimatedEndDate] = useState("");
  const [estimatedDuration, setEstimatedDuration] = useState("");
  const [startCondition, setStartCondition] = useState("");
  const [sections, setSections] = useState<DraftSection[]>([]);
  const [milestones, setMilestones] = useState<DraftMilestone[]>([]);
  const [payments, setPayments] = useState<DraftPayment[]>([]);

  const [revisionOpen, setRevisionOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionIssueDate, setRevisionIssueDate] = useState("");
  const [revisionValidUntil, setRevisionValidUntil] = useState("");

  const api = useCallback(
    async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api/sales${path}`, init);
      if (response.status === 401) {
        router.replace("/login");
        throw new Error("Authentication required");
      }
      const payload = await response.json().catch(() => null);
      if (response.status === 403) {
        throw new Error("Your company role does not have permission to manage quotations.");
      }
      if (!response.ok) throw new Error(errorMessage(payload, "Quotation request failed."));
      return payload;
    },
    [router],
  );

  const rowQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: "30" });
    if (search) params.set("search", search);
    if (statusFilter) params.set("status", statusFilter);
    return params.toString();
  }, [search, statusFilter]);

  const loadSummary = useCallback(async () => {
    setSummary((await api("/quotations/summary")) as Summary);
  }, [api]);

  const loadRows = useCallback(
    async (showLoader = true) => {
      if (showLoader) setLoadingRows(true);
      try {
        const page = (await api(`/quotations?${rowQuery}`)) as {
          items: QuotationRow[];
          next_cursor: string | null;
        };
        setRows(page.items);
        setNextCursor(page.next_cursor);
        setSelectedId((current) => current ?? page.items[0]?.id ?? null);
      } finally {
        if (showLoader) setLoadingRows(false);
      }
    },
    [api, rowQuery],
  );

  const applyCore = useCallback((detail: CoreDetail) => {
    setCore(detail);
    setSourceLeadId(detail.source_lead_id);
    setClientId(detail.client_id);
    setSubject(detail.subject ?? "");
    setIssueDate(detail.issue_date);
    setValidUntil(detail.valid_until ?? "");
    setCurrency(detail.currency);
    setTaxMode(detail.tax_calculation_mode);
    setAssignedEmployeeId(detail.assigned_employee_id ?? "");
    setInternalNotes(detail.internal_notes ?? "");
    setItems(
      detail.items.map((item) => ({
        product_id: item.product_id,
        lead_interest_id: item.lead_interest_id,
        item_name: item.item_name_snapshot,
        item_type: item.item_type_snapshot === "non_stock_item" ? "non_stock_item" : "service",
        unit: item.unit_snapshot || "unit",
        description: item.description,
        quantity: Number(item.quantity),
        unit_price: Number(item.unit_price),
        discount_percent: Number(item.discount_percent),
        tax_rate: Number(item.tax_rate),
      })),
    );
  }, []);

  const applyCommercial = useCallback((detail: CommercialDetail) => {
    setProposal(detail);
    setProjectTitle(detail.project_title ?? "");
    setExecutiveSummary(detail.executive_summary ?? "");
    setEstimatedStartDate(detail.estimated_start_date ?? "");
    setEstimatedEndDate(detail.estimated_end_date ?? "");
    setEstimatedDuration(detail.estimated_duration ?? "");
    setStartCondition(detail.start_condition ?? "");
    setSections(
      detail.sections.map((item) => ({
        section_type: item.section_type,
        title: item.title ?? "",
        content: item.content,
        is_visible: item.is_visible,
      })),
    );
    setMilestones(
      detail.milestones.map((item) => ({
        source_id: item.id,
        title: item.title,
        description: item.description ?? "",
        estimated_start_date: item.estimated_start_date ?? "",
        estimated_end_date: item.estimated_end_date ?? "",
        estimated_duration: item.estimated_duration ?? "",
        acceptance_criteria: item.acceptance_criteria ?? "",
      })),
    );
    setPayments(
      detail.payment_milestones.map((item) => ({
        title: item.title,
        description: item.description ?? "",
        payment_type: item.payment_type === "fixed" ? "fixed" : "percentage",
        percentage: item.percentage == null ? 0 : Number(item.percentage),
        amount: Number(item.amount || 0),
        due_condition: item.due_condition ?? "",
        due_date: item.due_date ?? "",
        milestone_index: item.quotation_milestone_id
          ? detail.milestones.findIndex((milestone) => milestone.id === item.quotation_milestone_id)
          : null,
      })),
    );
    setRevisionIssueDate(detail.issue_date);
    setRevisionValidUntil(detail.valid_until ?? "");
  }, []);

  const loadQuotation = useCallback(
    async (quotationId: string) => {
      setLoadingQuotation(true);
      setError(null);
      try {
        const [coreDetail, commercialDetail, history] = await Promise.all([
          api(`/quotations/${encodeURIComponent(quotationId)}`) as Promise<CoreDetail>,
          api(`/quotations/${encodeURIComponent(quotationId)}/commercial`) as Promise<CommercialDetail>,
          api(`/quotations/${encodeURIComponent(quotationId)}/revisions`) as Promise<RevisionRow[]>,
        ]);
        applyCore(coreDetail);
        applyCommercial(commercialDetail);
        setRevisions(history);
        setCreating(false);
      } catch (reason) {
        setCore(null);
        setProposal(null);
        setRevisions([]);
        setError(reason instanceof Error ? reason.message : "Unable to load quotation.");
      } finally {
        setLoadingQuotation(false);
      }
    },
    [api, applyCommercial, applyCore],
  );

  useEffect(() => {
    void Promise.all([api("/meta"), api("/quotations/summary")])
      .then(([metaValue, summaryValue]) => {
        const typed = metaValue as Meta;
        setMeta(typed);
        setSummary(summaryValue as Summary);
        setCurrency((current) => current || typed.default_currency);
        setTaxMode((current) => current || typed.default_tax_calculation_mode);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to load quotation setup."));
  }, [api]);

  useEffect(() => {
    if (creating) return;
    void loadRows().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Unable to load quotations."),
    );
  }, [creating, loadRows]);

  useEffect(() => {
    if (!selectedId || creating) return;
    void loadQuotation(selectedId);
  }, [creating, loadQuotation, selectedId]);

  useEffect(() => {
    if (!creating) return;
    void api("/client-options?limit=100")
      .then((value) => setClients(value as ClientOption[]))
      .catch(() => undefined);
  }, [api, creating]);

  useEffect(() => {
    if ((!creating && core?.status !== "draft") || !currency) return;
    void api(`/catalog-options?currency=${encodeURIComponent(currency)}&limit=200`)
      .then((value) => setCatalog(value as CatalogOption[]))
      .catch(() => setCatalog([]));
  }, [api, core?.status, creating, currency]);

  useEffect(() => {
    if (!meta || prefillHandled.current) return;
    prefillHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const quotationId = params.get("quotation_id");
    const leadId = params.get("lead_id");
    const preClient = params.get("client_id");
    if (quotationId) {
      setSelectedId(quotationId);
      return;
    }
    if (leadId) {
      void (async () => {
        try {
          const source = (await api(`/lead-quotation-source/${encodeURIComponent(leadId)}`)) as LeadSource;
          const clientRows = (await api(
            `/client-options?client_id=${encodeURIComponent(source.client_id)}&limit=1`,
          )) as ClientOption[];
          const client = clientRows[0];
          const today = localDate();
          setCreating(true);
          setSelectedId(null);
          setCore(null);
          setProposal(null);
          setRevisions([]);
          setClients(client ? [client] : []);
          setSourceLeadId(source.lead_id);
          setClientId(source.client_id);
          setSubject(source.subject);
          setIssueDate(today);
          setValidUntil(addDays(today, meta.default_validity_days));
          setCurrency(source.currency);
          setTaxMode(meta.default_tax_calculation_mode);
          setAssignedEmployeeId("");
          setInternalNotes("");
          setItems(
            source.interests.length
              ? source.interests.map((item) => ({
                  product_id: item.product_id,
                  lead_interest_id: item.id,
                  item_name: item.item_name,
                  item_type: item.item_type === "non_stock_item" ? "non_stock_item" : "service",
                  unit: item.unit || "unit",
                  description: item.description || item.item_name,
                  quantity: Number(item.quantity || 1),
                  unit_price: Number(item.estimated_unit_price || 0),
                  discount_percent: 0,
                  tax_rate: Number(meta.default_tax_rate),
                }))
              : [blankItem(Number(meta.default_tax_rate))],
          );
          resetCommercialDraft(source.subject);
          setTab("pricing");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "Unable to prepare quotation from lead.");
        }
      })();
      return;
    }
    if (preClient) {
      void api(`/client-options?client_id=${encodeURIComponent(preClient)}&limit=1`)
        .then((value) => {
          const client = (value as ClientOption[])[0];
          if (!client) return;
          startNew(client);
        })
        .catch(() => undefined);
    }
  }, [api, meta]);

  const editable = creating || core?.status === "draft";
  const preview = useMemo(() => {
    const lines = items.map((item) => previewLine(item, taxMode || "exclusive"));
    return {
      subtotal: lines.reduce((sum, line) => sum + line.subtotal, 0),
      discount: lines.reduce((sum, line) => sum + line.discount, 0),
      tax: lines.reduce((sum, line) => sum + line.tax, 0),
      total: lines.reduce((sum, line) => sum + line.total, 0),
    };
  }, [items, taxMode]);
  const documentTotal = editable ? preview.total : Number(core?.total || proposal?.total || 0);
  const scheduledTotal = useMemo(
    () =>
      payments.reduce((sum, item) => {
        if (item.payment_type === "percentage") {
          return sum + (documentTotal * Number(item.percentage || 0)) / 100;
        }
        return sum + Number(item.amount || 0);
      }, 0),
    [documentTotal, payments],
  );
  const scheduleDifference = documentTotal - scheduledTotal;

  function resetCommercialDraft(defaultTitle = "") {
    setProjectTitle(defaultTitle);
    setExecutiveSummary("");
    setEstimatedStartDate("");
    setEstimatedEndDate("");
    setEstimatedDuration("");
    setStartCondition("");
    setSections([]);
    setMilestones([]);
    setPayments([]);
    setRevisionReason("");
  }

  function startNew(client?: ClientOption) {
    if (!meta) return;
    const today = localDate();
    setCreating(true);
    setSelectedId(null);
    setCore(null);
    setProposal(null);
    setRevisions([]);
    setSourceLeadId(null);
    setClientId(client?.id ?? "");
    setSubject("");
    setIssueDate(today);
    setValidUntil(addDays(today, meta.default_validity_days));
    setCurrency(client?.currency || meta.default_currency);
    setTaxMode(meta.default_tax_calculation_mode);
    setAssignedEmployeeId("");
    setInternalNotes("");
    setItems([blankItem(Number(meta.default_tax_rate))]);
    resetCommercialDraft("");
    setTab("pricing");
    setError(null);
    setMessage(null);
    if (client) setClients([client]);
  }

  function cancelNew() {
    setCreating(false);
    setError(null);
    setMessage(null);
    const first = rows[0]?.id ?? null;
    setSelectedId(first);
    if (!first) {
      setCore(null);
      setProposal(null);
    }
  }

  function patchItem(index: number, patch: Partial<DraftItem>) {
    setItems((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function patchSection(index: number, patch: Partial<DraftSection>) {
    setSections((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function patchMilestone(index: number, patch: Partial<DraftMilestone>) {
    setMilestones((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function patchPayment(index: number, patch: Partial<DraftPayment>) {
    setPayments((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)));
  }

  function selectLineSource(index: number, value: string) {
    if (value === "custom:service") {
      patchItem(index, {
        product_id: null,
        lead_interest_id: null,
        item_type: "service",
        item_name: "",
        unit: "unit",
        description: "",
        unit_price: 0,
      });
      return;
    }
    if (value === "custom:non_stock_item") {
      patchItem(index, {
        product_id: null,
        lead_interest_id: null,
        item_type: "non_stock_item",
        item_name: "",
        unit: "unit",
        description: "",
        unit_price: 0,
      });
      return;
    }
    const id = value.replace("catalog:", "");
    const product = catalog.find((item) => item.id === id);
    if (!product) return;
    patchItem(index, {
      product_id: product.id,
      lead_interest_id: null,
      item_name: product.name,
      item_type: product.item_type === "non_stock_item" ? "non_stock_item" : "service",
      unit: product.unit,
      description: product.description || product.name,
      unit_price: Number(product.selling_price),
      tax_rate: product.tax_rate == null ? 0 : Number(product.tax_rate),
    });
  }

  function changeCurrency(next: string) {
    if (next === currency) return;
    const hasWork = items.some(
      (item) => item.product_id || item.item_name.trim() || item.description.trim() || item.unit_price > 0,
    );
    if (hasWork && !window.confirm("Changing currency will reset quotation line items. Continue?")) return;
    setCurrency(next);
    setSourceLeadId(null);
    setItems([blankItem(Number(meta?.default_tax_rate || 0))]);
  }

  function validateDraft() {
    if (!clientId) {
      setError("Select a client before saving the quotation.");
      setTab("pricing");
      return false;
    }
    if (validUntil && validUntil < issueDate) {
      setError("Valid-until date cannot be before issue date.");
      setTab("pricing");
      return false;
    }
    if (
      items.length === 0 ||
      items.some(
        (item) =>
          !(item.item_name || item.description).trim() ||
          !item.description.trim() ||
          item.quantity <= 0 ||
          item.unit_price < 0 ||
          item.discount_percent < 0 ||
          item.discount_percent > 100 ||
          item.tax_rate < 0 ||
          item.tax_rate > 100,
      )
    ) {
      setError("Complete every pricing line with valid quantity, price, discount, and tax values.");
      setTab("pricing");
      return false;
    }
    if (estimatedStartDate && estimatedEndDate && estimatedEndDate < estimatedStartDate) {
      setError("Estimated project end date cannot be before the start date.");
      setTab("overview");
      return false;
    }
    if (sections.some((item) => !item.content.trim())) {
      setError("Every proposal section must contain content, or remove the empty section.");
      setTab("sections");
      return false;
    }
    if (
      milestones.some(
        (item) =>
          !item.title.trim() ||
          (item.estimated_start_date &&
            item.estimated_end_date &&
            item.estimated_end_date < item.estimated_start_date),
      )
    ) {
      setError("Complete the delivery milestones and check their date ranges.");
      setTab("delivery");
      return false;
    }
    if (
      payments.some(
        (item) =>
          !item.title.trim() ||
          (item.payment_type === "percentage" && (item.percentage <= 0 || item.percentage > 100)) ||
          (item.payment_type === "fixed" && item.amount < 0),
      )
    ) {
      setError("Complete the payment schedule with valid percentage or fixed amounts.");
      setTab("payments");
      return false;
    }
    if (payments.length && Math.abs(scheduleDifference) > 0.011) {
      setError(
        `Payment schedule must equal the quotation total. Difference: ${money(scheduleDifference, currency)}.`,
      );
      setTab("payments");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    if (!meta || !editable || !validateDraft()) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    let savedId = core?.id ?? null;
    try {
      const corePayload = {
        subject: subject.trim() || null,
        issue_date: issueDate,
        valid_until: validUntil || null,
        currency,
        tax_calculation_mode: taxMode,
        assigned_employee_id: assignedEmployeeId || null,
        notes: null,
        terms_conditions: null,
        internal_notes: internalNotes.trim() || null,
        items: items.map((item) => ({
          product_id: item.product_id,
          lead_interest_id: item.lead_interest_id,
          item_name: item.item_name.trim() || null,
          item_type: item.item_type,
          unit: item.unit.trim() || "unit",
          description: item.description.trim(),
          quantity: item.quantity,
          unit_price: item.unit_price,
          discount_percent: item.discount_percent,
          tax_rate: item.tax_rate,
        })),
      };

      let savedCore: CoreDetail;
      if (creating) {
        savedCore = (await api("/quotations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: clientId, source_lead_id: sourceLeadId, ...corePayload }),
        })) as CoreDetail;
        savedId = savedCore.id;
        setCreating(false);
        setSelectedId(savedCore.id);
        applyCore(savedCore);
      } else {
        if (!core || core.status !== "draft") throw new Error("Only draft quotations can be edited.");
        savedCore = (await api(`/quotations/${core.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(corePayload),
        })) as CoreDetail;
        savedId = savedCore.id;
        applyCore(savedCore);
      }

      const commercialPayload = {
        project_title: projectTitle.trim() || subject.trim() || null,
        executive_summary: executiveSummary.trim() || null,
        estimated_start_date: estimatedStartDate || null,
        estimated_end_date: estimatedEndDate || null,
        estimated_duration: estimatedDuration.trim() || null,
        start_condition: startCondition.trim() || null,
        sections: sections.map((item, index) => ({
          section_type: item.section_type,
          title: item.title.trim() || null,
          content: item.content.trim(),
          sort_order: index,
          is_visible: item.is_visible,
        })),
        milestones: milestones.map((item, index) => ({
          title: item.title.trim(),
          description: item.description.trim() || null,
          estimated_start_date: item.estimated_start_date || null,
          estimated_end_date: item.estimated_end_date || null,
          estimated_duration: item.estimated_duration.trim() || null,
          acceptance_criteria: item.acceptance_criteria.trim() || null,
          sort_order: index,
        })),
        payment_milestones: payments.map((item, index) => ({
          quotation_milestone_index:
            item.milestone_index != null && item.milestone_index >= 0 ? item.milestone_index : null,
          title: item.title.trim(),
          description: item.description.trim() || null,
          payment_type: item.payment_type,
          percentage: item.payment_type === "percentage" ? Number(item.percentage) : null,
          amount: item.payment_type === "fixed" ? Number(item.amount) : null,
          due_condition: item.due_condition.trim() || null,
          due_date: item.due_date || null,
          sort_order: index,
        })),
      };

      const savedCommercial = (await api(`/quotations/${savedCore.id}/commercial`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(commercialPayload),
      })) as CommercialDetail;
      applyCommercial(savedCommercial);
      const history = (await api(`/quotations/${savedCore.id}/revisions`)) as RevisionRow[];
      setRevisions(history);
      await Promise.all([loadRows(false), loadSummary()]);
      setMessage(`Quotation ${savedCore.quotation_number} R${savedCommercial.revision_number} saved as draft.`);
    } catch (reason) {
      if (savedId) {
        setSelectedId(savedId);
        void loadQuotation(savedId).catch(() => undefined);
      }
      setError(reason instanceof Error ? reason.message : "Unable to save quotation.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(next: "sent" | "accepted" | "rejected" | "cancelled") {
    if (!core || creating) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      await api(`/quotations/${core.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      await Promise.all([loadQuotation(core.id), loadRows(false), loadSummary()]);
      setMessage(`Quotation ${core.quotation_number} marked ${next}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update quotation status.");
    } finally {
      setSaving(false);
    }
  }

  async function createRevision() {
    if (!proposal || creating) return;
    if (!revisionReason.trim()) {
      setError("Add a reason for this revision.");
      return;
    }
    if (revisionIssueDate && revisionValidUntil && revisionValidUntil < revisionIssueDate) {
      setError("Revision valid-until date cannot be before the issue date.");
      return;
    }
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const created = (await api(`/quotations/${proposal.id}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision_reason: revisionReason.trim(),
          issue_date: revisionIssueDate || null,
          valid_until: revisionValidUntil || null,
        }),
      })) as CommercialDetail;
      setRevisionOpen(false);
      setRevisionReason("");
      setSelectedId(created.id);
      setCreating(false);
      setTab("pricing");
      await Promise.all([loadQuotation(created.id), loadRows(false), loadSummary()]);
      setMessage(`Revision R${created.revision_number} created as a new editable draft.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create quotation revision.");
    } finally {
      setSaving(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams(rowQuery);
      params.set("cursor", nextCursor);
      const page = (await api(`/quotations?${params.toString()}`)) as {
        items: QuotationRow[];
        next_cursor: string | null;
      };
      setRows((current) => [...current, ...page.items]);
      setNextCursor(page.next_cursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load more quotations.");
    } finally {
      setLoadingMore(false);
    }
  }

  const clientOptions = [
    { value: "", label: "Select client..." },
    ...clients.map((client) => ({
      value: client.id,
      label: `${client.client_code} · ${client.display_name}`,
      keywords: `${client.contact_name ?? ""} ${client.currency ?? ""}`,
    })),
  ];
  const employeeOptions = [
    { value: "", label: "Unassigned" },
    ...(meta?.employees ?? []).map((employee) => ({
      value: employee.id,
      label: `${employee.full_name} · ${employee.employee_code}`,
    })),
  ];
  const baseLineSourceOptions = [
    { value: "custom:service", label: "+ Custom service" },
    { value: "custom:non_stock_item", label: "+ Custom non-stock item" },
    ...catalog.map((product) => ({
      value: `catalog:${product.id}`,
      label: `${product.sku} · ${product.name}`,
      keywords: `${product.item_type} ${product.unit} ${product.currency}`,
    })),
  ];
  const tabs: { id: EditorTab; label: string }[] = [
    { id: "pricing", label: "Details & pricing" },
    { id: "overview", label: "Proposal overview" },
    { id: "sections", label: `Scope & terms (${sections.length})` },
    { id: "delivery", label: `Delivery (${milestones.length})` },
    { id: "payments", label: `Payments (${payments.length})` },
    { id: "review", label: "Review" },
  ];

  return (
    <main className="min-h-screen bg-neutral-100 p-4 sm:p-8 lg:p-10">
      <div className="mx-auto max-w-[1600px]">
        <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Sales · Commercial documents</p>
            <h1 className="mt-1 text-3xl font-semibold">Quotations</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-500">
              One complete quotation workflow for pricing, scope, milestones, payment terms, revisions, approval, and order conversion.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void Promise.all([loadRows(), loadSummary()])}
              disabled={loadingRows}
              className="flex h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold disabled:opacity-50"
            >
              <RefreshCw className={`size-4 ${loadingRows ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button
              type="button"
              onClick={() => startNew()}
              disabled={!meta || saving}
              className="flex h-11 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Plus className="size-4" /> New quotation
            </button>
          </div>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Stat label="Total" value={summary?.total ?? 0} icon={FileText} />
          <Stat label="Draft" value={summary?.draft ?? 0} icon={Clock3} />
          <Stat label="Sent" value={summary?.sent ?? 0} icon={Send} />
          <Stat label="Accepted" value={summary?.accepted ?? 0} icon={CheckCircle2} />
          <Stat label="Rejected" value={summary?.rejected ?? 0} icon={XCircle} />
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <div className="mt-5 grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="h-fit overflow-hidden rounded-2xl border bg-white shadow-sm xl:sticky xl:top-4">
            <div className="border-b p-4">
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(searchDraft.trim());
                  if (creating) setCreating(false);
                }}
                className="relative"
              >
                <Search className="absolute left-3 top-3.5 size-4 text-neutral-400" />
                <input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Search quotation, client or project..."
                  className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500"
                />
              </form>
              <div className="mt-3 flex gap-2">
                <select
                  value={statusFilter}
                  onChange={(event) => {
                    setStatusFilter(event.target.value);
                    if (creating) setCreating(false);
                  }}
                  className="h-11 min-w-0 flex-1 rounded-xl border bg-white px-3 text-sm"
                >
                  <option value="">All statuses</option>
                  {["draft", "sent", "accepted", "rejected", "cancelled"].map((status) => (
                    <option key={status} value={status}>
                      {status[0].toUpperCase() + status.slice(1)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => {
                    setSearchDraft("");
                    setSearch("");
                    setStatusFilter("");
                  }}
                  className="h-11 rounded-xl border px-3 text-xs font-semibold"
                >
                  Reset
                </button>
              </div>
            </div>

            {creating ? (
              <div className="border-b p-2">
                <button
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl bg-neutral-950 px-3 py-3 text-left text-white"
                >
                  <div className="flex size-9 items-center justify-center rounded-lg bg-white/10">
                    <Plus className="size-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">New quotation</p>
                    <p className="mt-1 text-xs text-neutral-300">Unsaved draft</p>
                  </div>
                </button>
              </div>
            ) : null}

            <div className="max-h-[65vh] overflow-y-auto p-2">
              {loadingRows ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : rows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-neutral-500">No quotations found.</div>
              ) : (
                rows.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => {
                      setCreating(false);
                      setSelectedId(row.id);
                      setTab("pricing");
                      setMessage(null);
                      setError(null);
                    }}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                      !creating && selectedId === row.id ? "bg-neutral-950 text-white" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{row.quotation_number}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                            !creating && selectedId === row.id
                              ? "bg-white/15 text-white"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>
                      <p
                        className={`mt-1 truncate text-xs ${
                          !creating && selectedId === row.id ? "text-neutral-300" : "text-neutral-500"
                        }`}
                      >
                        {row.client_name}
                      </p>
                      <p
                        className={`mt-1 truncate text-xs ${
                          !creating && selectedId === row.id ? "text-neutral-400" : "text-neutral-400"
                        }`}
                      >
                        {money(row.total, row.currency)} · {row.subject || "No project title"}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 opacity-60" />
                  </button>
                ))
              )}
              {nextCursor && !loadingRows ? (
                <button
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={loadingMore}
                  className="mt-2 h-10 w-full rounded-xl border text-xs font-semibold disabled:opacity-50"
                >
                  {loadingMore ? "Loading…" : "Load more"}
                </button>
              ) : null}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm">
            {loadingQuotation && !creating ? (
              <div className="flex min-h-[680px] items-center justify-center">
                <Loader2 className="size-7 animate-spin" />
              </div>
            ) : !creating && !core ? (
              <div className="flex min-h-[680px] items-center justify-center px-6 text-center">
                <div>
                  <FileText className="mx-auto size-9 text-neutral-300" />
                  <h2 className="mt-4 text-lg font-semibold">Create or select a quotation</h2>
                  <p className="mt-1 text-sm text-neutral-500">
                    The new quotation workspace contains pricing, proposal content, delivery, payments, and revisions in one place.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold">
                          {creating ? "New quotation" : core?.quotation_number ?? "Quotation"}
                        </h2>
                        {!creating && proposal ? (
                          <span className="rounded-full border bg-neutral-50 px-2.5 py-1 text-xs font-semibold">
                            R{proposal.revision_number}
                          </span>
                        ) : null}
                        {!creating && core ? <StatusBadge status={core.status} expired={core.is_expired} /> : null}
                        {creating ? (
                          <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs font-semibold text-neutral-600">
                            Unsaved draft
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-neutral-500">
                        {creating
                          ? clients.find((client) => client.id === clientId)?.display_name || "Select a client"
                          : `${core?.client_name_snapshot ?? ""} · ${money(core?.total, core?.currency ?? currency)}`}
                      </p>
                      {!creating && proposal?.revision_reason ? (
                        <p className="mt-2 text-xs text-neutral-400">Revision reason: {proposal.revision_reason}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {!creating && core ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.open(
                              `/print/quotations/${encodeURIComponent(core.id)}`,
                              "_blank",
                              "noopener,noreferrer",
                            )
                          }
                          className="flex h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold"
                        >
                          <Printer className="size-4" /> Print / PDF
                        </button>
                      ) : null}

                      {editable ? (
                        <button
                          type="button"
                          onClick={() => void saveDraft()}
                          disabled={saving}
                          className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          {creating ? "Create draft" : "Save draft"}
                        </button>
                      ) : null}

                      {creating ? (
                        <button
                          type="button"
                          onClick={cancelNew}
                          disabled={saving}
                          className="h-10 rounded-xl border px-3 text-xs font-semibold disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      ) : null}

                      {!creating && core?.status === "draft" ? (
                        <>
                          <Action
                            label="Mark sent"
                            icon={Send}
                            primary
                            disabled={saving}
                            onClick={() => void changeStatus("sent")}
                          />
                          <Action
                            label="Cancel"
                            icon={Ban}
                            disabled={saving}
                            onClick={() => void changeStatus("cancelled")}
                          />
                        </>
                      ) : null}

                      {!creating && core?.status === "sent" ? (
                        <>
                          <Action
                            label="Accept"
                            icon={CheckCircle2}
                            primary
                            disabled={saving}
                            onClick={() => void changeStatus("accepted")}
                          />
                          <Action
                            label="Reject"
                            icon={XCircle}
                            disabled={saving}
                            onClick={() => void changeStatus("rejected")}
                          />
                          <Action
                            label="Cancel"
                            icon={Ban}
                            disabled={saving}
                            onClick={() => void changeStatus("cancelled")}
                          />
                        </>
                      ) : null}

                      {!creating && core && ["sent", "rejected", "cancelled"].includes(core.status) ? (
                        <Action
                          label="Create revision"
                          icon={History}
                          disabled={saving}
                          onClick={() => {
                            setRevisionIssueDate(core.issue_date);
                            setRevisionValidUntil(core.valid_until ?? "");
                            setRevisionOpen(true);
                          }}
                        />
                      ) : null}

                      {!creating && core?.status === "accepted" ? (
                        <Action
                          label="Create / view order"
                          icon={ShoppingCart}
                          primary
                          onClick={() => router.push(`/dashboard/orders?quotation_id=${encodeURIComponent(core.id)}`)}
                        />
                      ) : null}
                    </div>
                  </div>

                  {!creating && core?.status !== "draft" ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      This revision is immutable. Pricing and commercial terms are read-only. Create a new revision when the client requests changes.
                    </div>
                  ) : null}

                  {!creating && revisions.length ? (
                    <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                      {revisions.map((revision) => (
                        <button
                          type="button"
                          key={revision.id}
                          onClick={() => {
                            setSelectedId(revision.id);
                            setTab("pricing");
                          }}
                          className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${
                            revision.id === core?.id
                              ? "border-neutral-950 bg-neutral-950 text-white"
                              : "bg-white text-neutral-600 hover:bg-neutral-50"
                          }`}
                        >
                          <span className="font-semibold">R{revision.revision_number}</span>
                          <span className="ml-2 capitalize opacity-70">{revision.status}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="border-b px-4 sm:px-6">
                  <div className="flex gap-1 overflow-x-auto">
                    {tabs.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`shrink-0 border-b-2 px-3 py-4 text-sm font-semibold ${
                          tab === item.id
                            ? "border-neutral-950 text-neutral-950"
                            : "border-transparent text-neutral-400 hover:text-neutral-700"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-5 sm:p-6">
                  {tab === "pricing" ? (
                    <PricingTab
                      creating={creating}
                      disabled={!editable}
                      meta={meta}
                      clients={clients}
                      clientOptions={clientOptions}
                      clientId={clientId}
                      setClientId={(value) => {
                        setClientId(value);
                        const client = clients.find((item) => item.id === value);
                        if (client?.currency && !items.some((item) => item.item_name.trim() || item.description.trim())) {
                          setCurrency(client.currency);
                        }
                        setSourceLeadId(null);
                      }}
                      existingClientName={core?.client_name_snapshot ?? ""}
                      subject={subject}
                      setSubject={setSubject}
                      issueDate={issueDate}
                      setIssueDate={(value) => {
                        setIssueDate(value);
                        if (creating && meta) setValidUntil(addDays(value, meta.default_validity_days));
                      }}
                      validUntil={validUntil}
                      setValidUntil={setValidUntil}
                      currency={currency}
                      setCurrency={changeCurrency}
                      taxMode={taxMode}
                      setTaxMode={setTaxMode}
                      assignedEmployeeId={assignedEmployeeId}
                      setAssignedEmployeeId={setAssignedEmployeeId}
                      employeeOptions={employeeOptions}
                      items={items}
                      setItems={setItems}
                      patchItem={patchItem}
                      selectLineSource={selectLineSource}
                      baseLineSourceOptions={baseLineSourceOptions}
                      internalNotes={internalNotes}
                      setInternalNotes={setInternalNotes}
                      preview={preview}
                      sourceLeadId={sourceLeadId}
                    />
                  ) : null}

                  {tab === "overview" ? (
                    <OverviewTab
                      disabled={!editable}
                      projectTitle={projectTitle}
                      setProjectTitle={setProjectTitle}
                      executiveSummary={executiveSummary}
                      setExecutiveSummary={setExecutiveSummary}
                      estimatedStartDate={estimatedStartDate}
                      setEstimatedStartDate={setEstimatedStartDate}
                      estimatedEndDate={estimatedEndDate}
                      setEstimatedEndDate={setEstimatedEndDate}
                      estimatedDuration={estimatedDuration}
                      setEstimatedDuration={setEstimatedDuration}
                      startCondition={startCondition}
                      setStartCondition={setStartCondition}
                    />
                  ) : null}

                  {tab === "sections" ? (
                    <SectionsTab
                      disabled={!editable}
                      sections={sections}
                      onPatch={patchSection}
                      onAdd={() => setSections((current) => [...current, blankSection()])}
                      onAddStandard={() => {
                        const existingTypes = new Set(sections.map((item) => item.section_type));
                        const missing = STANDARD_SECTIONS.filter((item) => !existingTypes.has(item.section_type)).map((item) => ({ ...item }));
                        setSections((current) => [...current, ...missing]);
                      }}
                      onRemove={(index) => setSections((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    />
                  ) : null}

                  {tab === "delivery" ? (
                    <DeliveryTab
                      disabled={!editable}
                      milestones={milestones}
                      onPatch={patchMilestone}
                      onAdd={() => setMilestones((current) => [...current, blankMilestone()])}
                      onRemove={(index) => {
                        setMilestones((current) => current.filter((_, itemIndex) => itemIndex !== index));
                        setPayments((current) =>
                          current.map((payment) => {
                            if (payment.milestone_index == null) return payment;
                            if (payment.milestone_index === index) return { ...payment, milestone_index: null };
                            if (payment.milestone_index > index) {
                              return { ...payment, milestone_index: payment.milestone_index - 1 };
                            }
                            return payment;
                          }),
                        );
                      }}
                    />
                  ) : null}

                  {tab === "payments" ? (
                    <PaymentsTab
                      disabled={!editable}
                      currency={currency || core?.currency || ""}
                      total={documentTotal}
                      scheduledTotal={scheduledTotal}
                      difference={scheduleDifference}
                      milestones={milestones}
                      payments={payments}
                      onPatch={patchPayment}
                      onAdd={() => setPayments((current) => [...current, blankPayment()])}
                      onRemove={(index) => setPayments((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    />
                  ) : null}

                  {tab === "review" ? (
                    <ReviewTab
                      creating={creating}
                      core={core}
                      proposal={proposal}
                      clientName={
                        creating
                          ? clients.find((client) => client.id === clientId)?.display_name || "Client not selected"
                          : core?.client_name_snapshot || ""
                      }
                      subject={subject}
                      projectTitle={projectTitle}
                      executiveSummary={executiveSummary}
                      currency={currency || core?.currency || ""}
                      preview={preview}
                      items={items}
                      sections={sections}
                      milestones={milestones}
                      payments={payments}
                      issueDate={issueDate}
                      validUntil={validUntil}
                      estimatedDuration={estimatedDuration}
                    />
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {revisionOpen && proposal && core ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setRevisionOpen(false);
          }}
        >
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
            <div className="border-b px-6 py-5">
              <h2 className="text-xl font-semibold">Create quotation revision</h2>
              <p className="mt-1 text-sm text-neutral-500">
                {core.quotation_number} R{proposal.revision_number} will be cloned into a new editable draft. The current revision remains unchanged.
              </p>
            </div>
            <div className="space-y-4 p-6">
              <TextArea
                label="Revision reason"
                value={revisionReason}
                onChange={setRevisionReason}
                placeholder="Example: Client requested revised scope, timeline, and payment terms."
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Issue date" type="date" value={revisionIssueDate} onChange={setRevisionIssueDate} />
                <Field label="Valid until" type="date" value={revisionValidUntil} onChange={setRevisionValidUntil} />
              </div>
              <div className="flex justify-end gap-2 border-t pt-5">
                <button
                  type="button"
                  onClick={() => setRevisionOpen(false)}
                  className="h-11 rounded-xl border px-4 text-sm font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void createRevision()}
                  disabled={saving}
                  className="h-11 rounded-xl bg-neutral-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {saving ? "Creating…" : "Create draft revision"}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PricingTab({
  creating,
  disabled,
  meta,
  clients,
  clientOptions,
  clientId,
  setClientId,
  existingClientName,
  subject,
  setSubject,
  issueDate,
  setIssueDate,
  validUntil,
  setValidUntil,
  currency,
  setCurrency,
  taxMode,
  setTaxMode,
  assignedEmployeeId,
  setAssignedEmployeeId,
  employeeOptions,
  items,
  setItems,
  patchItem,
  selectLineSource,
  baseLineSourceOptions,
  internalNotes,
  setInternalNotes,
  preview,
  sourceLeadId,
}: {
  creating: boolean;
  disabled: boolean;
  meta: Meta | null;
  clients: ClientOption[];
  clientOptions: { value: string; label: string; keywords?: string }[];
  clientId: string;
  setClientId: (value: string) => void;
  existingClientName: string;
  subject: string;
  setSubject: (value: string) => void;
  issueDate: string;
  setIssueDate: (value: string) => void;
  validUntil: string;
  setValidUntil: (value: string) => void;
  currency: string;
  setCurrency: (value: string) => void;
  taxMode: string;
  setTaxMode: (value: string) => void;
  assignedEmployeeId: string;
  setAssignedEmployeeId: (value: string) => void;
  employeeOptions: { value: string; label: string }[];
  items: DraftItem[];
  setItems: React.Dispatch<React.SetStateAction<DraftItem[]>>;
  patchItem: (index: number, patch: Partial<DraftItem>) => void;
  selectLineSource: (index: number, value: string) => void;
  baseLineSourceOptions: { value: string; label: string; keywords?: string }[];
  internalNotes: string;
  setInternalNotes: (value: string) => void;
  preview: { subtotal: number; discount: number; tax: number; total: number };
  sourceLeadId: string | null;
}) {
  return (
    <div className="space-y-6">
      <SectionHeading
        title="Quotation details & pricing"
        description="Define the client, commercial dates, currency, responsible employee, and the exact priced line items."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {creating ? (
          <SearchableSelect
            label="Client"
            name="quotation_client_v2"
            value={clientId}
            onValueChange={setClientId}
            options={clientOptions}
            searchPlaceholder="Search client by code or name..."
            required
          />
        ) : (
          <Field label="Client" value={existingClientName || clients.find((item) => item.id === clientId)?.display_name || ""} onChange={() => undefined} disabled />
        )}
        <Field label="Subject / project" value={subject} onChange={setSubject} disabled={disabled} />
        <Field label="Issue date" type="date" value={issueDate} onChange={setIssueDate} disabled={disabled} />
        <Field label="Valid until" type="date" value={validUntil} onChange={setValidUntil} disabled={disabled} />
        <SearchableSelect
          label="Currency"
          name="quotation_currency_v2"
          value={currency}
          onValueChange={setCurrency}
          options={CURRENCY_OPTIONS}
          searchPlaceholder="Search currency..."
          disabled={disabled}
          required
        />
        <label className="block text-sm font-medium">
          Tax calculation
          <select
            value={taxMode}
            onChange={(event) => setTaxMode(event.target.value)}
            disabled={disabled}
            className={inputClass}
          >
            <option value="exclusive">Tax exclusive</option>
            <option value="inclusive">Tax inclusive</option>
          </select>
        </label>
        <SearchableSelect
          label="Assigned employee"
          name="quotation_employee_v2"
          value={assignedEmployeeId}
          onValueChange={setAssignedEmployeeId}
          options={employeeOptions}
          searchPlaceholder="Search employee..."
          disabled={disabled}
        />
      </div>

      {sourceLeadId ? (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700">
          This quotation was prepared from a CRM lead. Lead requirement lineage is preserved on matching line items.
        </div>
      ) : null}

      <div className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-semibold">Pricing lines</h3>
            <p className="mt-1 text-xs text-neutral-500">Use catalog services/products or add one-time custom work.</p>
          </div>
          <button
            type="button"
            onClick={() => setItems((current) => [...current, blankItem(Number(meta?.default_tax_rate || 0))])}
            disabled={disabled}
            className="flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
          >
            <Plus className="size-4" /> Add line
          </button>
        </div>

        {items.map((item, index) => {
          const line = previewLine(item, taxMode);
          const sourceValue = item.product_id
            ? `catalog:${item.product_id}`
            : item.item_type === "non_stock_item"
              ? "custom:non_stock_item"
              : "custom:service";
          const sourceOptions =
            item.product_id && !baseLineSourceOptions.some((option) => option.value === sourceValue)
              ? [
                  { value: sourceValue, label: `Catalog · ${item.item_name || "Existing item"}` },
                  ...baseLineSourceOptions,
                ]
              : baseLineSourceOptions;
          return (
            <article key={`${sourceValue}-${index}`} className="rounded-2xl border bg-neutral-50/40 p-4">
              <div className="grid gap-4 lg:grid-cols-[1.35fr_1.35fr_.65fr_.65fr]">
                <SearchableSelect
                  label="Source"
                  name={`quotation_v2_line_source_${index}`}
                  value={sourceValue}
                  onValueChange={(value) => selectLineSource(index, value)}
                  options={sourceOptions}
                  searchPlaceholder="Search products and services..."
                  disabled={disabled}
                />
                <Field
                  label="Item / service name"
                  value={item.item_name}
                  onChange={(value) => patchItem(index, { item_name: value })}
                  disabled={disabled || Boolean(item.product_id)}
                />
                <NumberField
                  label="Quantity"
                  value={item.quantity}
                  onChange={(value) => patchItem(index, { quantity: value })}
                  disabled={disabled}
                />
                <Field
                  label="Unit"
                  value={item.unit}
                  onChange={(value) => patchItem(index, { unit: value })}
                  disabled={disabled || Boolean(item.product_id)}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[2fr_.8fr_.65fr_.65fr_auto]">
                <Field
                  label="Description"
                  value={item.description}
                  onChange={(value) => patchItem(index, { description: value })}
                  disabled={disabled}
                />
                <NumberField
                  label="Unit price"
                  value={item.unit_price}
                  onChange={(value) => patchItem(index, { unit_price: value })}
                  disabled={disabled}
                />
                <NumberField
                  label="Discount %"
                  value={item.discount_percent}
                  onChange={(value) => patchItem(index, { discount_percent: value })}
                  disabled={disabled}
                />
                <NumberField
                  label="Tax %"
                  value={item.tax_rate}
                  onChange={(value) => patchItem(index, { tax_rate: value })}
                  disabled={disabled}
                />
                <div className="flex items-end gap-2">
                  <div className="min-w-32 pb-2 text-right">
                    <p className="text-xs text-neutral-400">Line total</p>
                    <p className="mt-1 whitespace-nowrap font-semibold">{money(line.total, currency)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    disabled={disabled || items.length === 1}
                    className="mb-0.5 flex size-11 items-center justify-center rounded-xl border bg-white disabled:opacity-30"
                    aria-label="Remove line"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              {item.lead_interest_id ? (
                <p className="mt-3 text-xs text-blue-600">Linked to a lead requirement · final quotation pricing remains controlled here.</p>
              ) : null}
            </article>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <TextArea
          label="Internal notes"
          value={internalNotes}
          onChange={setInternalNotes}
          disabled={disabled}
          placeholder="Internal only. This content is not part of the client proposal."
        />
        <div className="h-fit rounded-2xl border bg-neutral-50 p-5">
          <h3 className="font-semibold">Quotation totals</h3>
          <Total label="Subtotal" value={money(preview.subtotal, currency)} />
          <Total label="Discount" value={`- ${money(preview.discount, currency)}`} />
          <Total label="Tax" value={money(preview.tax, currency)} />
          <div className="mt-4 border-t pt-4">
            <Total label="Total" value={money(preview.total, currency)} strong />
          </div>
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  disabled,
  projectTitle,
  setProjectTitle,
  executiveSummary,
  setExecutiveSummary,
  estimatedStartDate,
  setEstimatedStartDate,
  estimatedEndDate,
  setEstimatedEndDate,
  estimatedDuration,
  setEstimatedDuration,
  startCondition,
  setStartCondition,
}: {
  disabled: boolean;
  projectTitle: string;
  setProjectTitle: (value: string) => void;
  executiveSummary: string;
  setExecutiveSummary: (value: string) => void;
  estimatedStartDate: string;
  setEstimatedStartDate: (value: string) => void;
  estimatedEndDate: string;
  setEstimatedEndDate: (value: string) => void;
  estimatedDuration: string;
  setEstimatedDuration: (value: string) => void;
  startCondition: string;
  setStartCondition: (value: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SectionHeading
        title="Commercial proposal overview"
        description="Explain what the project is, the expected business outcome, schedule, and what must happen before work begins."
      />
      <Field label="Project title" value={projectTitle} onChange={setProjectTitle} disabled={disabled} />
      <TextArea
        label="Executive summary"
        value={executiveSummary}
        onChange={setExecutiveSummary}
        disabled={disabled}
        placeholder="Summarize the client's objective, your proposed solution, and the outcome in a few clear paragraphs."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Estimated start" type="date" value={estimatedStartDate} onChange={setEstimatedStartDate} disabled={disabled} />
        <Field label="Estimated end" type="date" value={estimatedEndDate} onChange={setEstimatedEndDate} disabled={disabled} />
        <Field
          label="Estimated duration"
          value={estimatedDuration}
          onChange={setEstimatedDuration}
          disabled={disabled}
          placeholder="e.g. 8–10 weeks"
        />
      </div>
      <TextArea
        label="Project start condition"
        value={startCondition}
        onChange={setStartCondition}
        disabled={disabled}
        placeholder="Example: Work begins after quotation acceptance, advance payment, and required account/API access."
      />
    </div>
  );
}

function SectionsTab({
  disabled,
  sections,
  onPatch,
  onAdd,
  onAddStandard,
  onRemove,
}: {
  disabled: boolean;
  sections: DraftSection[];
  onPatch: (index: number, patch: Partial<DraftSection>) => void;
  onAdd: () => void;
  onAddStandard: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SectionHeading
          title="Scope, deliverables & commercial terms"
          description="Each section is independent, ordered, and can be hidden from the client without deleting it."
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddStandard}
            disabled={disabled}
            className="h-10 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
          >
            Add standard structure
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={disabled}
            className="flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
          >
            <Plus className="size-4" /> Add section
          </button>
        </div>
      </div>

      {sections.length === 0 ? (
        <EmptyState
          title="No proposal sections yet"
          description="Add the standard structure or create only the sections needed for this quotation."
        />
      ) : (
        sections.map((section, index) => (
          <article key={`${section.section_type}-${index}`} className="rounded-2xl border bg-neutral-50/40 p-4">
            <div className="grid gap-4 lg:grid-cols-[240px_1fr_auto]">
              <label className="text-sm font-medium">
                Section type
                <select
                  value={section.section_type}
                  disabled={disabled}
                  onChange={(event) => {
                    const selected = SECTION_TYPES.find(([value]) => value === event.target.value);
                    onPatch(index, {
                      section_type: event.target.value,
                      title: section.title || selected?.[1] || "",
                    });
                  }}
                  className={inputClass}
                >
                  {SECTION_TYPES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <Field
                label="Display title"
                value={section.title}
                onChange={(value) => onPatch(index, { title: value })}
                disabled={disabled}
              />
              <div className="flex items-end gap-2 pb-0.5">
                <label className="flex h-11 items-center gap-2 rounded-xl border bg-white px-3 text-xs font-semibold">
                  <input
                    type="checkbox"
                    checked={section.is_visible}
                    disabled={disabled}
                    onChange={(event) => onPatch(index, { is_visible: event.target.checked })}
                  />
                  Client visible
                </label>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                  className="flex size-11 items-center justify-center rounded-xl border bg-white disabled:opacity-40"
                  aria-label="Remove section"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </div>
            <TextArea
              label="Content"
              value={section.content}
              onChange={(value) => onPatch(index, { content: value })}
              disabled={disabled}
              placeholder="Write clear client-ready content for this section."
            />
          </article>
        ))
      )}
    </div>
  );
}

function DeliveryTab({
  disabled,
  milestones,
  onPatch,
  onAdd,
  onRemove,
}: {
  disabled: boolean;
  milestones: DraftMilestone[];
  onPatch: (index: number, patch: Partial<DraftMilestone>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title="Delivery milestones"
          description="Define phases, expected dates, duration, deliverables, and acceptance criteria."
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
        >
          <Plus className="size-4" /> Add milestone
        </button>
      </div>

      {milestones.length === 0 ? (
        <EmptyState title="No delivery milestones" description="Add phases such as Discovery, UI/UX, Development, QA, and Launch." />
      ) : (
        milestones.map((milestone, index) => (
          <article key={milestone.source_id ?? `new-${index}`} className="rounded-2xl border p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Milestone {index + 1}</p>
              <button
                type="button"
                onClick={() => onRemove(index)}
                disabled={disabled}
                className="flex size-9 items-center justify-center rounded-lg border disabled:opacity-40"
                aria-label="Remove milestone"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-3 grid gap-4 lg:grid-cols-[1.4fr_.8fr_.8fr_.8fr]">
              <Field label="Title" value={milestone.title} onChange={(value) => onPatch(index, { title: value })} disabled={disabled} />
              <Field
                label="Start date"
                type="date"
                value={milestone.estimated_start_date}
                onChange={(value) => onPatch(index, { estimated_start_date: value })}
                disabled={disabled}
              />
              <Field
                label="End date"
                type="date"
                value={milestone.estimated_end_date}
                onChange={(value) => onPatch(index, { estimated_end_date: value })}
                disabled={disabled}
              />
              <Field
                label="Duration"
                value={milestone.estimated_duration}
                onChange={(value) => onPatch(index, { estimated_duration: value })}
                disabled={disabled}
                placeholder="e.g. 2 weeks"
              />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <TextArea
                label="Description"
                value={milestone.description}
                onChange={(value) => onPatch(index, { description: value })}
                disabled={disabled}
              />
              <TextArea
                label="Acceptance criteria"
                value={milestone.acceptance_criteria}
                onChange={(value) => onPatch(index, { acceptance_criteria: value })}
                disabled={disabled}
                placeholder="Define what must be delivered/approved before this milestone is considered complete."
              />
            </div>
          </article>
        ))
      )}
    </div>
  );
}

function PaymentsTab({
  disabled,
  currency,
  total,
  scheduledTotal,
  difference,
  milestones,
  payments,
  onPatch,
  onAdd,
  onRemove,
}: {
  disabled: boolean;
  currency: string;
  total: number;
  scheduledTotal: number;
  difference: number;
  milestones: DraftMilestone[];
  payments: DraftPayment[];
  onPatch: (index: number, patch: Partial<DraftPayment>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const reconciled = payments.length === 0 || Math.abs(difference) <= 0.011;
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title="Payment schedule"
          description="Create staged payments that reconcile exactly with the quotation total and can flow into Order billing milestones after acceptance."
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
        >
          <Plus className="size-4" /> Add payment
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Quotation total" value={money(total, currency)} />
        <Metric label="Scheduled" value={money(scheduledTotal, currency)} />
        <Metric
          label={reconciled ? "Reconciled" : "Difference"}
          value={reconciled ? "Exact" : money(difference, currency)}
          emphasis={!reconciled}
        />
      </div>

      {payments.length === 0 ? (
        <EmptyState
          title="No staged payment schedule"
          description="This is optional. Add payments when the quotation should create staged Order billing milestones after acceptance."
        />
      ) : (
        payments.map((payment, index) => {
          const derivedAmount =
            payment.payment_type === "percentage"
              ? (total * Number(payment.percentage || 0)) / 100
              : Number(payment.amount || 0);
          return (
            <article key={index} className="rounded-2xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Payment {index + 1}</p>
                  <p className="mt-1 text-sm font-semibold">{money(derivedAmount, currency)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                  className="flex size-9 items-center justify-center rounded-lg border disabled:opacity-40"
                  aria-label="Remove payment"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-[1.3fr_.8fr_.8fr_1fr]">
                <Field label="Title" value={payment.title} onChange={(value) => onPatch(index, { title: value })} disabled={disabled} />
                <label className="text-sm font-medium">
                  Payment type
                  <select
                    value={payment.payment_type}
                    disabled={disabled}
                    onChange={(event) =>
                      onPatch(index, {
                        payment_type: event.target.value === "fixed" ? "fixed" : "percentage",
                        percentage: event.target.value === "fixed" ? 0 : payment.percentage,
                        amount: event.target.value === "fixed" ? payment.amount : 0,
                      })
                    }
                    className={inputClass}
                  >
                    <option value="percentage">Percentage</option>
                    <option value="fixed">Fixed amount</option>
                  </select>
                </label>
                {payment.payment_type === "percentage" ? (
                  <NumberField
                    label="Percentage %"
                    value={payment.percentage}
                    onChange={(value) => onPatch(index, { percentage: value })}
                    disabled={disabled}
                  />
                ) : (
                  <NumberField
                    label={`Amount (${currency})`}
                    value={payment.amount}
                    onChange={(value) => onPatch(index, { amount: value })}
                    disabled={disabled}
                  />
                )}
                <label className="text-sm font-medium">
                  Delivery milestone
                  <select
                    value={payment.milestone_index == null ? "" : String(payment.milestone_index)}
                    disabled={disabled}
                    onChange={(event) =>
                      onPatch(index, {
                        milestone_index: event.target.value === "" ? null : Number(event.target.value),
                      })
                    }
                    className={inputClass}
                  >
                    <option value="">Not linked</option>
                    {milestones.map((milestone, milestoneIndex) => (
                      <option key={milestoneIndex} value={milestoneIndex}>
                        {milestoneIndex + 1}. {milestone.title || "Untitled milestone"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-[1.2fr_1.2fr_.7fr]">
                <TextArea
                  label="Description"
                  value={payment.description}
                  onChange={(value) => onPatch(index, { description: value })}
                  disabled={disabled}
                />
                <TextArea
                  label="Due condition"
                  value={payment.due_condition}
                  onChange={(value) => onPatch(index, { due_condition: value })}
                  disabled={disabled}
                  placeholder="Example: Due after prototype approval."
                />
                <Field
                  label="Due date"
                  type="date"
                  value={payment.due_date}
                  onChange={(value) => onPatch(index, { due_date: value })}
                  disabled={disabled}
                />
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

function ReviewTab({
  creating,
  core,
  proposal,
  clientName,
  subject,
  projectTitle,
  executiveSummary,
  currency,
  preview,
  items,
  sections,
  milestones,
  payments,
  issueDate,
  validUntil,
  estimatedDuration,
}: {
  creating: boolean;
  core: CoreDetail | null;
  proposal: CommercialDetail | null;
  clientName: string;
  subject: string;
  projectTitle: string;
  executiveSummary: string;
  currency: string;
  preview: { subtotal: number; discount: number; tax: number; total: number };
  items: DraftItem[];
  sections: DraftSection[];
  milestones: DraftMilestone[];
  payments: DraftPayment[];
  issueDate: string;
  validUntil: string;
  estimatedDuration: string;
}) {
  const total = creating || core?.status === "draft" ? preview.total : Number(core?.total || 0);
  return (
    <div className="space-y-6">
      <SectionHeading
        title="Client-ready review"
        description="Review the entire commercial document before saving, sending, revising, or printing it."
      />

      <div className="rounded-2xl border bg-neutral-950 p-6 text-white">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">Quotation</p>
            <h3 className="mt-2 text-2xl font-semibold">{projectTitle || subject || "Untitled proposal"}</h3>
            <p className="mt-2 text-sm text-neutral-300">Prepared for {clientName}</p>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-xs text-neutral-400">{creating ? "Draft" : `${core?.quotation_number} · R${proposal?.revision_number ?? 1}`}</p>
            <p className="mt-2 text-2xl font-semibold">{money(total, currency)}</p>
            <p className="mt-1 text-xs text-neutral-400">
              Issued {issueDate || "—"}{validUntil ? ` · Valid until ${validUntil}` : ""}
            </p>
          </div>
        </div>
      </div>

      {executiveSummary ? (
        <div className="rounded-2xl border p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Executive summary</p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-700">{executiveSummary}</p>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-400">
            <tr>
              <th className="px-4 py-3 text-left">Item / service</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Discount</th>
              <th>Tax</th>
              <th className="pr-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map((item, index) => {
              const line = previewLine(item, core?.tax_calculation_mode || "exclusive");
              return (
                <tr key={index}>
                  <td className="px-4 py-3">
                    <p className="font-medium">{item.item_name || "Unnamed item"}</p>
                    <p className="mt-1 text-xs text-neutral-400">{item.description || "—"}</p>
                  </td>
                  <td>{item.quantity} {item.unit}</td>
                  <td>{money(item.unit_price, currency)}</td>
                  <td>{item.discount_percent}%</td>
                  <td>{item.tax_rate}%</td>
                  <td className="pr-4 text-right font-medium">{money(line.total, currency)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="ml-auto max-w-md rounded-2xl border bg-neutral-50 p-5">
        <Total label="Subtotal" value={money(preview.subtotal, currency)} />
        <Total label="Discount" value={`- ${money(preview.discount, currency)}`} />
        <Total label="Tax" value={money(preview.tax, currency)} />
        <div className="mt-4 border-t pt-4">
          <Total label="Total" value={money(preview.total, currency)} strong />
        </div>
      </div>

      {sections.filter((section) => section.is_visible).map((section, index) => (
        <div key={`${section.section_type}-${index}`} className="rounded-2xl border p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {section.title || SECTION_TYPES.find(([value]) => value === section.section_type)?.[1] || section.section_type}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-neutral-700">{section.content || "—"}</p>
        </div>
      ))}

      {milestones.length ? (
        <div>
          <div className="flex items-end justify-between gap-4">
            <h3 className="font-semibold">Delivery plan</h3>
            {estimatedDuration ? <p className="text-xs text-neutral-400">Estimated duration · {estimatedDuration}</p> : null}
          </div>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {milestones.map((milestone, index) => (
              <div key={index} className="rounded-2xl border p-4">
                <p className="text-xs text-neutral-400">Milestone {index + 1}</p>
                <p className="mt-1 font-semibold">{milestone.title || "Untitled milestone"}</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-500">{milestone.description || "No description"}</p>
                <p className="mt-3 text-xs text-neutral-400">
                  {[milestone.estimated_start_date, milestone.estimated_end_date, milestone.estimated_duration]
                    .filter(Boolean)
                    .join(" · ") || "Schedule not set"}
                </p>
                {milestone.acceptance_criteria ? (
                  <p className="mt-3 border-t pt-3 text-xs leading-5 text-neutral-500">
                    <span className="font-semibold text-neutral-700">Acceptance:</span> {milestone.acceptance_criteria}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {payments.length ? (
        <div>
          <h3 className="font-semibold">Payment schedule</h3>
          <div className="mt-3 overflow-hidden rounded-2xl border">
            {payments.map((payment, index) => {
              const amount =
                payment.payment_type === "percentage"
                  ? (Number(preview.total || 0) * Number(payment.percentage || 0)) / 100
                  : Number(payment.amount || 0);
              return (
                <div
                  key={index}
                  className="flex flex-col gap-2 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium">{payment.title || `Payment ${index + 1}`}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {payment.due_condition || payment.due_date || "Due condition not set"}
                    </p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-semibold">{money(amount, currency)}</p>
                    <p className="mt-1 text-xs text-neutral-400">
                      {payment.payment_type === "percentage" ? `${payment.percentage}%` : "Fixed"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        disabled={disabled}
        placeholder={placeholder}
        className={inputClass}
      />
    </label>
  );
}

function NumberField({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <input
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
        type="number"
        step="any"
        disabled={disabled}
        className={inputClass}
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  disabled = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {label}
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        className={textareaClass}
      />
    </label>
  );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h3 className="text-lg font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-neutral-500">{description}</p>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`mt-2 flex justify-between gap-4 text-sm ${strong ? "text-base font-semibold" : "text-neutral-600"}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${emphasis ? "border-amber-200 bg-amber-50" : "bg-neutral-50"}`}>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${emphasis ? "text-amber-800" : "text-neutral-800"}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status, expired = false }: { status: string; expired?: boolean }) {
  const styles: Record<string, string> = {
    draft: "border-neutral-200 bg-neutral-50 text-neutral-600",
    sent: "border-blue-200 bg-blue-50 text-blue-700",
    accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-red-200 bg-red-50 text-red-700",
    cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.draft}`}>
      {status}{expired ? " · expired" : ""}
    </span>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number;
  icon: typeof FileText;
}) {
  return (
    <article className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-500">{label}</p>
        <Icon className="size-4 text-neutral-400" />
      </div>
      <p className="mt-4 text-2xl font-semibold">{value}</p>
    </article>
  );
}

function Action({
  label,
  icon: Icon,
  onClick,
  disabled,
  primary = false,
}: {
  label: string;
  icon: typeof FileText;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-semibold disabled:opacity-50 ${
        primary ? "bg-neutral-950 text-white" : "border bg-white"
      }`}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed px-6 py-12 text-center">
      <WalletCards className="mx-auto size-8 text-neutral-300" />
      <p className="mt-3 font-semibold">{title}</p>
      <p className="mx-auto mt-1 max-w-lg text-sm text-neutral-500">{description}</p>
    </div>
  );
}
