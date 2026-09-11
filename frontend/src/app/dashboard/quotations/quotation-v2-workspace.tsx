"use client";

import {
  ChevronRight,
  Clock3,
  FilePenLine,
  History,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  WalletCards,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

type QuotationRow = {
  id: string;
  quotation_number: string;
  client_name: string;
  status: string;
  subject: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  total: string | number;
};

type QuotationItem = {
  id: string;
  item_name_snapshot: string;
  description: string;
  quantity: string | number;
  unit_snapshot: string;
  unit_price: string | number;
  tax_rate: string | number;
  line_total: string | number;
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
  items: QuotationItem[];
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

type EditorTab = "overview" | "sections" | "delivery" | "payments" | "review";

const inputClass =
  "mt-2 h-11 w-full rounded-xl border border-neutral-200 bg-white px-3 text-sm outline-none transition focus:border-neutral-500 disabled:bg-neutral-50 disabled:text-neutral-500";
const textareaClass =
  "mt-2 min-h-28 w-full rounded-xl border border-neutral-200 bg-white px-3 py-3 text-sm leading-6 outline-none transition focus:border-neutral-500 disabled:bg-neutral-50 disabled:text-neutral-500";

const SECTION_TYPES = [
  ["scope", "Scope of work"],
  ["deliverables", "Deliverables"],
  ["client_responsibilities", "Client responsibilities"],
  ["exclusions", "Exclusions"],
  ["third_party_costs", "Third-party costs"],
  ["support_warranty", "Support & warranty"],
  ["change_request_policy", "Change request policy"],
  ["ip_terms", "IP terms"],
  ["confidentiality", "Confidentiality"],
  ["terms_conditions", "Terms & conditions"],
  ["additional_notes", "Additional notes"],
] as const;

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
  const [rows, setRows] = useState<QuotationRow[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [proposal, setProposal] = useState<CommercialDetail | null>(null);
  const [revisions, setRevisions] = useState<RevisionRow[]>([]);
  const [loadingRows, setLoadingRows] = useState(true);
  const [loadingProposal, setLoadingProposal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [tab, setTab] = useState<EditorTab>("overview");

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

  const loadRows = useCallback(async () => {
    setLoadingRows(true);
    try {
      const page = (await api("/quotations?limit=100")) as { items: QuotationRow[] };
      setRows(page.items);
      setSelectedId((current) => current ?? page.items[0]?.id ?? null);
    } finally {
      setLoadingRows(false);
    }
  }, [api]);

  const applyProposal = useCallback((detail: CommercialDetail) => {
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

  const loadProposal = useCallback(
    async (quotationId: string) => {
      setLoadingProposal(true);
      setError(null);
      setMessage(null);
      try {
        const [detail, history] = await Promise.all([
          api(`/quotations/${encodeURIComponent(quotationId)}/commercial`) as Promise<CommercialDetail>,
          api(`/quotations/${encodeURIComponent(quotationId)}/revisions`) as Promise<RevisionRow[]>,
        ]);
        applyProposal(detail);
        setRevisions(history);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to load commercial proposal.");
        setProposal(null);
        setRevisions([]);
      } finally {
        setLoadingProposal(false);
      }
    },
    [api, applyProposal],
  );

  useEffect(() => {
    void loadRows().catch((reason) =>
      setError(reason instanceof Error ? reason.message : "Unable to load quotations."),
    );
  }, [loadRows]);

  useEffect(() => {
    if (!selectedId) return;
    void loadProposal(selectedId);
  }, [loadProposal, selectedId]);

  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (!needle) return true;
      return `${row.quotation_number} ${row.client_name} ${row.subject ?? ""}`
        .toLowerCase()
        .includes(needle);
    });
  }, [rows, search, statusFilter]);

  const editable = proposal?.status === "draft";
  const proposalTotal = Number(proposal?.total || 0);
  const scheduledTotal = useMemo(
    () =>
      payments.reduce((sum, item) => {
        if (item.payment_type === "percentage") {
          return sum + (proposalTotal * Number(item.percentage || 0)) / 100;
        }
        return sum + Number(item.amount || 0);
      }, 0),
    [payments, proposalTotal],
  );
  const scheduleDifference = proposalTotal - scheduledTotal;

  function patchSection(index: number, patch: Partial<DraftSection>) {
    setSections((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function patchMilestone(index: number, patch: Partial<DraftMilestone>) {
    setMilestones((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  function patchPayment(index: number, patch: Partial<DraftPayment>) {
    setPayments((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  async function saveProposal() {
    if (!proposal || !editable) return;
    if (estimatedStartDate && estimatedEndDate && estimatedEndDate < estimatedStartDate) {
      setError("Estimated end date cannot be before the start date.");
      setTab("overview");
      return;
    }
    if (sections.some((item) => !item.content.trim())) {
      setError("Every proposal section must contain content.");
      setTab("sections");
      return;
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
      return;
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
      return;
    }
    if (payments.length && Math.abs(scheduleDifference) > 0.011) {
      setError(
        `Payment schedule must equal the quotation total. Difference: ${money(scheduleDifference, proposal.currency)}.`,
      );
      setTab("payments");
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        project_title: projectTitle.trim() || null,
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
      const updated = (await api(`/quotations/${proposal.id}/commercial`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })) as CommercialDetail;
      applyProposal(updated);
      setMessage(`Proposal ${updated.quotation_number} R${updated.revision_number} saved.`);
      const history = (await api(`/quotations/${updated.id}/revisions`)) as RevisionRow[];
      setRevisions(history);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save proposal.");
    } finally {
      setSaving(false);
    }
  }

  async function createRevision() {
    if (!proposal) return;
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
      applyProposal(created);
      setTab("overview");
      setMessage(`Revision R${created.revision_number} created as a draft.`);
      await loadRows();
      const history = (await api(`/quotations/${created.id}/revisions`)) as RevisionRow[];
      setRevisions(history);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to create revision.");
    } finally {
      setSaving(false);
    }
  }

  const tabs: { id: EditorTab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "sections", label: `Sections (${sections.length})` },
    { id: "delivery", label: `Delivery (${milestones.length})` },
    { id: "payments", label: `Payments (${payments.length})` },
    { id: "review", label: "Review" },
  ];

  return (
    <main className="bg-neutral-100 p-4 pt-5 sm:p-8 sm:pt-5 lg:p-10 lg:pt-5">
      <div className="mx-auto max-w-[1500px]">
        <header className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-medium text-neutral-500">Quotation V2 · Phase 2</p>
            <h1 className="mt-1 text-3xl font-semibold">Commercial proposal builder</h1>
            <p className="mt-2 max-w-3xl text-sm text-neutral-500">
              Build client-ready scope, delivery milestones, payment schedules, commercial terms, and revisions on top of the existing quotation pricing.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadRows()}
            disabled={loadingRows}
            className="flex h-11 items-center gap-2 self-start rounded-xl border bg-white px-4 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw className={`size-4 ${loadingRows ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </header>

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

        <div className="mt-5 grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="h-fit overflow-hidden rounded-2xl border bg-white shadow-sm xl:sticky xl:top-4">
            <div className="border-b p-4">
              <div className="relative">
                <Search className="absolute left-3 top-3.5 size-4 text-neutral-400" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search quotation or client..."
                  className="h-11 w-full rounded-xl border pl-9 pr-3 text-sm outline-none focus:border-neutral-500"
                />
              </div>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                className="mt-3 h-11 w-full rounded-xl border bg-white px-3 text-sm"
              >
                <option value="">All statuses</option>
                {['draft', 'sent', 'accepted', 'rejected', 'cancelled'].map((status) => (
                  <option key={status} value={status}>
                    {status[0].toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="max-h-[68vh] overflow-y-auto p-2">
              {loadingRows ? (
                <div className="flex min-h-40 items-center justify-center">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-neutral-500">No quotations found.</div>
              ) : (
                filteredRows.map((row) => (
                  <button
                    type="button"
                    key={row.id}
                    onClick={() => setSelectedId(row.id)}
                    className={`mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                      selectedId === row.id ? "bg-neutral-950 text-white" : "hover:bg-neutral-50"
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold">{row.quotation_number}</p>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${
                            selectedId === row.id
                              ? "bg-white/15 text-white"
                              : "bg-neutral-100 text-neutral-500"
                          }`}
                        >
                          {row.status}
                        </span>
                      </div>
                      <p className={`mt-1 truncate text-xs ${selectedId === row.id ? "text-neutral-300" : "text-neutral-500"}`}>
                        {row.client_name}
                      </p>
                      <p className={`mt-1 truncate text-xs ${selectedId === row.id ? "text-neutral-400" : "text-neutral-400"}`}>
                        {money(row.total, row.currency)}
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 opacity-60" />
                  </button>
                ))
              )}
            </div>
          </aside>

          <section className="min-w-0 overflow-hidden rounded-2xl border bg-white shadow-sm">
            {loadingProposal ? (
              <div className="flex min-h-[620px] items-center justify-center">
                <Loader2 className="size-7 animate-spin" />
              </div>
            ) : !proposal ? (
              <div className="flex min-h-[620px] items-center justify-center px-6 text-center">
                <div>
                  <FilePenLine className="mx-auto size-9 text-neutral-300" />
                  <h2 className="mt-4 text-lg font-semibold">Select a quotation</h2>
                  <p className="mt-1 text-sm text-neutral-500">Choose an existing quotation to build its commercial proposal.</p>
                </div>
              </div>
            ) : (
              <>
                <div className="border-b p-5 sm:p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold">{proposal.quotation_number}</h2>
                        <span className="rounded-full border bg-neutral-50 px-2.5 py-1 text-xs font-semibold">
                          R{proposal.revision_number}
                        </span>
                        <StatusBadge status={proposal.status} />
                      </div>
                      <p className="mt-2 text-sm text-neutral-500">
                        {proposal.client_name_snapshot} · {money(proposal.total, proposal.currency)}
                      </p>
                      {proposal.revision_reason ? (
                        <p className="mt-2 text-xs text-neutral-400">Revision reason: {proposal.revision_reason}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {editable ? (
                        <button
                          type="button"
                          onClick={() => void saveProposal()}
                          disabled={saving}
                          className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                          Save proposal
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setRevisionIssueDate(proposal.issue_date);
                            setRevisionValidUntil(proposal.valid_until ?? "");
                            setRevisionOpen(true);
                          }}
                          disabled={saving}
                          className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white disabled:opacity-50"
                        >
                          <History className="size-4" />
                          Create revision
                        </button>
                      )}
                    </div>
                  </div>

                  {!editable ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      This revision is {proposal.status} and immutable. Review it here or create a new draft revision before changing commercial terms.
                    </div>
                  ) : null}

                  <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
                    {revisions.map((revision) => (
                      <button
                        type="button"
                        key={revision.id}
                        onClick={() => setSelectedId(revision.id)}
                        className={`shrink-0 rounded-xl border px-3 py-2 text-left text-xs ${
                          revision.id === proposal.id
                            ? "border-neutral-950 bg-neutral-950 text-white"
                            : "bg-white text-neutral-600 hover:bg-neutral-50"
                        }`}
                      >
                        <span className="font-semibold">R{revision.revision_number}</span>
                        <span className="ml-2 capitalize opacity-70">{revision.status}</span>
                      </button>
                    ))}
                  </div>
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
                      onRemove={(index) => setSections((current) => current.filter((_, i) => i !== index))}
                    />
                  ) : null}

                  {tab === "delivery" ? (
                    <DeliveryTab
                      disabled={!editable}
                      milestones={milestones}
                      onPatch={patchMilestone}
                      onAdd={() => setMilestones((current) => [...current, blankMilestone()])}
                      onRemove={(index) => {
                        setMilestones((current) => current.filter((_, i) => i !== index));
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
                      currency={proposal.currency}
                      total={proposalTotal}
                      scheduledTotal={scheduledTotal}
                      difference={scheduleDifference}
                      milestones={milestones}
                      payments={payments}
                      onPatch={patchPayment}
                      onAdd={() => setPayments((current) => [...current, blankPayment()])}
                      onRemove={(index) => setPayments((current) => current.filter((_, i) => i !== index))}
                    />
                  ) : null}

                  {tab === "review" ? (
                    <ReviewTab proposal={proposal} sections={sections} milestones={milestones} payments={payments} />
                  ) : null}
                </div>
              </>
            )}
          </section>
        </div>
      </div>

      {revisionOpen && proposal ? (
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
                {proposal.quotation_number} R{proposal.revision_number} will be cloned into a new editable draft.
              </p>
            </div>
            <div className="space-y-4 p-6">
              <TextArea
                label="Revision reason"
                value={revisionReason}
                onChange={setRevisionReason}
                placeholder="Example: Client requested revised scope and milestone payment terms."
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
        title="Proposal overview"
        description="Define the project identity, executive summary, expected schedule, and start condition."
      />
      <Field label="Project title" value={projectTitle} onChange={setProjectTitle} disabled={disabled} />
      <TextArea
        label="Executive summary"
        value={executiveSummary}
        onChange={setExecutiveSummary}
        disabled={disabled}
        placeholder="Summarize the client's objective, your proposed solution, and the business outcome."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Estimated start"
          type="date"
          value={estimatedStartDate}
          onChange={setEstimatedStartDate}
          disabled={disabled}
        />
        <Field
          label="Estimated end"
          type="date"
          value={estimatedEndDate}
          onChange={setEstimatedEndDate}
          disabled={disabled}
        />
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
        placeholder="Example: Work begins after acceptance, advance payment, and required account access."
      />
    </div>
  );
}

function SectionsTab({
  disabled,
  sections,
  onPatch,
  onAdd,
  onRemove,
}: {
  disabled: boolean;
  sections: DraftSection[];
  onPatch: (index: number, patch: Partial<DraftSection>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <SectionHeading
          title="Structured proposal sections"
          description="Keep scope, responsibilities, exclusions, warranty, IP, and commercial terms separate and reusable."
        />
        <button
          type="button"
          onClick={onAdd}
          disabled={disabled}
          className="flex h-10 shrink-0 items-center gap-2 rounded-xl border px-3 text-sm font-semibold disabled:opacity-40"
        >
          <Plus className="size-4" /> Add section
        </button>
      </div>

      {sections.length === 0 ? (
        <EmptyState title="No proposal sections yet" description="Add Scope of work first, then structure the rest of the commercial proposal." />
      ) : (
        sections.map((section, index) => (
          <article key={`${section.section_type}-${index}`} className="rounded-2xl border bg-neutral-50/50 p-4">
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
              placeholder="Write the client-ready content for this section."
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
          description="Describe what will be delivered, when it is expected, and how the client accepts each phase."
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
        <EmptyState title="No delivery milestones" description="Add phases such as Discovery, Prototype, Development, QA, and Launch." />
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
              <Field
                label="Title"
                value={milestone.title}
                onChange={(value) => onPatch(index, { title: value })}
                disabled={disabled}
              />
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
                placeholder="Define what must be true before this milestone is considered accepted."
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
          description="Create the staged commercial schedule that will become Order billing milestones after acceptance."
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
          description="This is allowed. Add payments when you want accepted quotations to create staged Order billing milestones."
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
                <Field
                  label="Title"
                  value={payment.title}
                  onChange={(value) => onPatch(index, { title: value })}
                  disabled={disabled}
                />
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
  proposal,
  sections,
  milestones,
  payments,
}: {
  proposal: CommercialDetail;
  sections: DraftSection[];
  milestones: DraftMilestone[];
  payments: DraftPayment[];
}) {
  return (
    <div className="space-y-6">
      <SectionHeading
        title="Proposal review"
        description="A compact commercial preview before the quotation is sent or revised. Pricing remains sourced from the core quotation."
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Client" value={proposal.client_name_snapshot} />
        <Metric label="Quotation" value={`${proposal.quotation_number} · R${proposal.revision_number}`} />
        <Metric label="Status" value={proposal.status} />
        <Metric label="Total" value={money(proposal.total, proposal.currency)} />
      </div>
      <div className="overflow-x-auto rounded-2xl border">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-400">
            <tr>
              <th className="px-4 py-3 text-left">Item / service</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Tax</th>
              <th className="pr-4 text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {proposal.items.map((item) => (
              <tr key={item.id}>
                <td className="px-4 py-3">
                  <p className="font-medium">{item.item_name_snapshot}</p>
                  <p className="mt-1 text-xs text-neutral-400">{item.description}</p>
                </td>
                <td>{Number(item.quantity)} {item.unit_snapshot}</td>
                <td>{money(item.unit_price, proposal.currency)}</td>
                <td>{Number(item.tax_rate)}%</td>
                <td className="pr-4 text-right font-medium">{money(item.line_total, proposal.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {sections.filter((section) => section.is_visible).map((section, index) => (
        <div key={`${section.section_type}-${index}`} className="rounded-2xl border p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
            {section.title || SECTION_TYPES.find(([value]) => value === section.section_type)?.[1] || section.section_type}
          </p>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-700">{section.content || "—"}</p>
        </div>
      ))}

      {milestones.length ? (
        <div>
          <h3 className="font-semibold">Delivery plan</h3>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {milestones.map((milestone, index) => (
              <div key={index} className="rounded-2xl border p-4">
                <p className="text-xs text-neutral-400">Milestone {index + 1}</p>
                <p className="mt-1 font-semibold">{milestone.title || "Untitled milestone"}</p>
                <p className="mt-2 text-sm leading-6 text-neutral-500">{milestone.description || "No description"}</p>
                <p className="mt-3 text-xs text-neutral-400">
                  {[milestone.estimated_start_date, milestone.estimated_end_date, milestone.estimated_duration]
                    .filter(Boolean)
                    .join(" · ") || "Schedule not set"}
                </p>
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
                  ? (Number(proposal.total || 0) * Number(payment.percentage || 0)) / 100
                  : Number(payment.amount || 0);
              return (
                <div key={index} className="flex flex-col gap-2 border-b p-4 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium">{payment.title || `Payment ${index + 1}`}</p>
                    <p className="mt-1 text-xs text-neutral-400">{payment.due_condition || payment.due_date || "Due condition not set"}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="font-semibold">{money(amount, proposal.currency)}</p>
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

function Metric({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${emphasis ? "border-amber-200 bg-amber-50" : "bg-neutral-50"}`}>
      <p className="text-xs text-neutral-400">{label}</p>
      <p className={`mt-1 text-sm font-semibold ${emphasis ? "text-amber-800" : "text-neutral-800"}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "border-neutral-200 bg-neutral-50 text-neutral-600",
    sent: "border-blue-200 bg-blue-50 text-blue-700",
    accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
    rejected: "border-red-200 bg-red-50 text-red-700",
    cancelled: "border-neutral-200 bg-neutral-100 text-neutral-500",
  };
  return (
    <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
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
