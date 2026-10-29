"use client";

import { ArrowLeft, Loader2, Printer } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type QuotationItem = {
  id: string;
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

type QuotationCommercialDetail = {
  id: string;
  quotation_number: string;
  root_quotation_id: string | null;
  supersedes_quotation_id: string | null;
  revision_number: number;
  revision_reason: string | null;
  status: string;
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

const SECTION_FALLBACK_TITLES: Record<string, string> = {
  scope: "Scope of work",
  deliverables: "Deliverables",
  client_responsibilities: "Client responsibilities",
  exclusions: "Exclusions",
  third_party_costs: "Third-party costs",
  support_warranty: "Support & warranty",
  change_request_policy: "Change request policy",
  ip_terms: "IP / source-code terms",
  confidentiality: "Confidentiality",
  terms_conditions: "Terms & conditions",
  additional_notes: "Additional notes",
};

function money(value: string | number | null | undefined, currency: string) {
  const amount = Number(value || 0);
  return `${currency} ${amount.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return value;
  return new Intl.DateTimeFormat("en", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}

function humanize(value: string | null | undefined) {
  if (!value) return "-";
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusLabel(value: string) {
  return humanize(value || "draft");
}

function sellerMonogram(name: string) {
  const letters = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return letters || "Q";
}

export default function QuotationPrintPage() {
  const params = useParams<{ quotationId: string }>();
  const router = useRouter();
  const [detail, setDetail] = useState<QuotationCommercialDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/sales/quotations/${encodeURIComponent(params.quotationId)}/commercial`,
        );
        if (response.status === 401) {
          router.replace("/login");
          return;
        }
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          const message =
            payload && typeof payload === "object" && typeof payload.detail === "string"
              ? payload.detail
              : "Unable to load quotation.";
          throw new Error(message);
        }
        if (active) setDetail(payload as QuotationCommercialDetail);
      } catch (reason) {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Unable to load quotation.");
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [params.quotationId, router]);

  useEffect(() => {
    if (!detail) return;
    const previousTitle = document.title;
    const safeNumber = detail.quotation_number.replace(/[^a-zA-Z0-9._-]+/g, "-");
    document.title = `${safeNumber}-R${detail.revision_number}`;
    return () => {
      document.title = previousTitle;
    };
  }, [detail]);

  const visibleSections = useMemo(
    () =>
      (detail?.sections ?? [])
        .filter((section) => section.is_visible && section.content.trim())
        .sort((a, b) => a.sort_order - b.sort_order),
    [detail],
  );
  const deliveryMilestones = useMemo(
    () => [...(detail?.milestones ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [detail],
  );
  const paymentMilestones = useMemo(
    () => [...(detail?.payment_milestones ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [detail],
  );
  const sortedItems = useMemo(
    () => [...(detail?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [detail],
  );

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100">
        <Loader2 className="size-7 animate-spin text-neutral-400" />
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="rounded-2xl border bg-white p-8 text-center shadow-sm">
          <p className="font-semibold">Quotation unavailable</p>
          <p className="mt-2 text-sm text-neutral-500">{error ?? "Quotation not found"}</p>
        </div>
      </main>
    );
  }

  const title = detail.project_title || detail.subject || "Commercial proposal";
  const monogram = sellerMonogram(detail.seller_name_snapshot);
  const hasSchedule = Boolean(
    detail.estimated_start_date ||
      detail.estimated_end_date ||
      detail.estimated_duration ||
      detail.start_condition,
  );
  const hasPreparedBy = Boolean(
    detail.prepared_by_name_snapshot ||
      detail.prepared_by_email_snapshot ||
      detail.prepared_by_designation_snapshot,
  );
  const sellerContact = [detail.seller_email_snapshot, detail.seller_phone_snapshot]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-8 text-neutral-950 print:bg-white print:p-0">
      <style jsx global>{`
        @page {
          size: A4;
          margin: 13mm 12mm 14mm;
        }

        @media print {
          html,
          body {
            background: white !important;
            print-color-adjust: exact !important;
            -webkit-print-color-adjust: exact !important;
          }

          .print-actions {
            display: none !important;
          }

          .print-sheet {
            box-shadow: none !important;
            border: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: none !important;
            padding: 0 !important;
          }

          .avoid-break,
          .proposal-card,
          .milestone-card,
          .payment-row,
          .acceptance-block {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          thead {
            display: table-header-group;
          }

          tr {
            break-inside: avoid;
            page-break-inside: avoid;
          }

          .print-muted-bg {
            background: #f5f5f5 !important;
          }

          .print-dark-bg {
            background: #171717 !important;
            color: #ffffff !important;
          }
        }
      `}</style>

      <div className="print-actions mx-auto mb-4 flex max-w-[210mm] items-center justify-between gap-3">
        <Link
          href="/dashboard/quotations"
          className="flex h-10 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold"
        >
          <ArrowLeft className="size-4" /> Back
        </Link>
        <div className="flex items-center gap-3">
          <p className="hidden text-xs text-neutral-500 sm:block">Choose “Save as PDF” in the print dialog to download.</p>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-10 items-center gap-2 rounded-xl bg-neutral-950 px-4 text-sm font-semibold text-white"
          >
            <Printer className="size-4" /> Print / Save PDF
          </button>
        </div>
      </div>

      <article className="print-sheet mx-auto min-h-[297mm] w-full max-w-[210mm] bg-white p-8 shadow-xl ring-1 ring-neutral-200 print:min-h-0">
        <header className="avoid-break border-b border-neutral-200 pb-7">
          <div className="flex items-start justify-between gap-8">
            <div className="flex min-w-0 items-start gap-4">
              <div
                aria-label={`${detail.seller_name_snapshot} document mark`}
                className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-neutral-950 text-lg font-semibold tracking-tight text-white"
              >
                {monogram}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-neutral-400">
                  Commercial quotation
                </p>
                <h1 className="mt-2 text-3xl font-semibold tracking-tight">{detail.quotation_number}</h1>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-semibold">
                    Revision R{detail.revision_number}
                  </span>
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 font-semibold">
                    {statusLabel(detail.status)}
                  </span>
                </div>
              </div>
            </div>

            <div className="max-w-[285px] text-right">
              <p className="text-lg font-semibold">{detail.seller_name_snapshot}</p>
              {detail.seller_email_snapshot ? (
                <p className="mt-1 text-sm text-neutral-500">{detail.seller_email_snapshot}</p>
              ) : null}
              {detail.seller_phone_snapshot ? (
                <p className="mt-1 text-sm text-neutral-500">{detail.seller_phone_snapshot}</p>
              ) : null}
              {detail.seller_address_snapshot ? (
                <p className="mt-1 whitespace-pre-line text-sm leading-5 text-neutral-500">
                  {detail.seller_address_snapshot}
                </p>
              ) : null}
              {detail.seller_tax_identifier_snapshot ? (
                <p className="mt-2 text-xs text-neutral-400">
                  Tax ID: {detail.seller_tax_identifier_snapshot}
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <section className="avoid-break mt-7 grid grid-cols-[1.15fr_.85fr] gap-7">
          <div className="rounded-2xl border border-neutral-200 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Prepared for</p>
            <p className="mt-2 text-xl font-semibold">{detail.client_name_snapshot}</p>
            {detail.client_contact_snapshot ? (
              <p className="mt-1 text-sm text-neutral-600">Attn: {detail.client_contact_snapshot}</p>
            ) : null}
            {detail.client_email_snapshot ? (
              <p className="mt-1 text-sm text-neutral-500">{detail.client_email_snapshot}</p>
            ) : null}
            {detail.client_phone_snapshot ? (
              <p className="mt-1 text-sm text-neutral-500">{detail.client_phone_snapshot}</p>
            ) : null}
            {detail.client_address_snapshot ? (
              <p className="mt-2 whitespace-pre-line text-sm leading-5 text-neutral-500">
                {detail.client_address_snapshot}
              </p>
            ) : null}
            {detail.client_tax_identifier_snapshot ? (
              <p className="mt-2 text-xs text-neutral-400">
                Tax ID: {detail.client_tax_identifier_snapshot}
              </p>
            ) : null}
          </div>

          <div className="print-muted-bg rounded-2xl bg-neutral-50 p-5">
            <div className="grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
              <Meta label="Issue date" value={formatDate(detail.issue_date)} />
              <Meta label="Valid until" value={formatDate(detail.valid_until)} />
              <Meta label="Currency" value={detail.currency} />
              <Meta
                label="Tax mode"
                value={detail.tax_calculation_mode === "inclusive" ? "Tax inclusive" : "Tax exclusive"}
              />
            </div>
          </div>
        </section>

        <section className="print-dark-bg avoid-break mt-7 rounded-2xl bg-neutral-950 p-6 text-white">
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0 max-w-[72%]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Project</p>
              <h2 className="mt-2 text-2xl font-semibold leading-tight">{title}</h2>
              {detail.executive_summary ? (
                <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-neutral-300">
                  {detail.executive_summary}
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs uppercase tracking-wide text-neutral-400">Total investment</p>
              <p className="mt-2 text-2xl font-semibold">{money(detail.total, detail.currency)}</p>
            </div>
          </div>
        </section>

        {hasPreparedBy ? (
          <section className="avoid-break mt-5 flex items-start justify-between gap-8 border-b border-neutral-100 pb-5 text-sm">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Prepared by</p>
              {detail.prepared_by_name_snapshot ? (
                <p className="mt-1 font-semibold">{detail.prepared_by_name_snapshot}</p>
              ) : null}
              {detail.prepared_by_designation_snapshot ? (
                <p className="mt-0.5 text-neutral-500">{detail.prepared_by_designation_snapshot}</p>
              ) : null}
              {detail.prepared_by_email_snapshot ? (
                <p className="mt-0.5 text-neutral-500">{detail.prepared_by_email_snapshot}</p>
              ) : null}
            </div>
            {detail.revision_reason ? (
              <div className="max-w-[52%] text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Revision note</p>
                <p className="mt-1 text-neutral-600">{detail.revision_reason}</p>
              </div>
            ) : null}
          </section>
        ) : detail.revision_reason ? (
          <section className="avoid-break mt-5 border-b border-neutral-100 pb-5 text-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Revision note</p>
            <p className="mt-1 text-neutral-600">{detail.revision_reason}</p>
          </section>
        ) : null}

        <DocumentHeading
          eyebrow="Commercials"
          title="Pricing & investment"
          description="The following pricing is based on the scope, quantities, discounts, and taxes defined for this quotation revision."
        />

        <section className="mt-4 overflow-hidden rounded-xl border border-neutral-200">
          <table className="w-full border-collapse text-[11px] sm:text-xs">
            <thead className="print-muted-bg bg-neutral-50 uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-3 text-left">Item / service</th>
                <th className="px-2 py-3 text-right">Qty</th>
                <th className="px-2 py-3 text-right">Unit price</th>
                <th className="px-2 py-3 text-right">Discount</th>
                <th className="px-2 py-3 text-right">Tax</th>
                <th className="px-3 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-3 align-top">
                    <p className="font-semibold text-neutral-800">
                      {item.item_name_snapshot || item.description}
                    </p>
                    {item.description && item.description !== item.item_name_snapshot ? (
                      <p className="mt-1 whitespace-pre-wrap leading-5 text-neutral-500">{item.description}</p>
                    ) : null}
                    <div className="mt-1.5 flex flex-wrap gap-x-2 text-[10px] text-neutral-400">
                      {item.sku_snapshot ? <span>SKU: {item.sku_snapshot}</span> : null}
                      {item.unit_snapshot ? <span>Unit: {item.unit_snapshot}</span> : null}
                    </div>
                  </td>
                  <td className="px-2 py-3 text-right align-top">{Number(item.quantity).toLocaleString()}</td>
                  <td className="px-2 py-3 text-right align-top">{money(item.unit_price, detail.currency)}</td>
                  <td className="px-2 py-3 text-right align-top">
                    {Number(item.discount_percent) > 0 ? `${Number(item.discount_percent)}%` : "-"}
                  </td>
                  <td className="px-2 py-3 text-right align-top">
                    {Number(item.tax_rate) > 0 ? `${Number(item.tax_rate)}%` : "-"}
                  </td>
                  <td className="px-3 py-3 text-right align-top font-semibold">
                    {money(item.line_total, detail.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="avoid-break mt-5 ml-auto w-full max-w-sm rounded-2xl border border-neutral-200 p-5">
          <Total label="Subtotal" value={money(detail.subtotal, detail.currency)} />
          {Number(detail.discount_total) > 0 ? (
            <Total label="Discount" value={`- ${money(detail.discount_total, detail.currency)}`} />
          ) : null}
          <Total label="Tax" value={money(detail.tax_total, detail.currency)} />
          <div className="mt-4 border-t border-neutral-200 pt-4">
            <Total label="Grand total" value={money(detail.total, detail.currency)} strong />
          </div>
        </section>

        {hasSchedule ? (
          <section className="avoid-break mt-9">
            <DocumentHeading
              eyebrow="Schedule"
              title="Project timing"
              description="Estimated timing is subject to the start conditions and client dependencies described below."
            />
            <div className="mt-4 grid grid-cols-3 gap-3">
              <InfoCard label="Estimated start" value={formatDate(detail.estimated_start_date)} />
              <InfoCard label="Estimated end" value={formatDate(detail.estimated_end_date)} />
              <InfoCard label="Duration" value={detail.estimated_duration || "-"} />
            </div>
            {detail.start_condition ? (
              <div className="print-muted-bg mt-3 rounded-xl bg-neutral-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Start condition</p>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                  {detail.start_condition}
                </p>
              </div>
            ) : null}
          </section>
        ) : null}

        {visibleSections.length ? (
          <section className="mt-9">
            <DocumentHeading
              eyebrow="Proposal"
              title="Scope, deliverables & terms"
              description="The following sections form part of this quotation and define the commercial delivery boundaries."
            />
            <div className="mt-4 space-y-4">
              {visibleSections.map((section, index) => (
                <article key={section.id} className="proposal-card rounded-2xl border border-neutral-200 p-5">
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-neutral-950 text-xs font-semibold text-white">
                      {index + 1}
                    </span>
                    <div className="min-w-0">
                      <h3 className="font-semibold">
                        {section.title || SECTION_FALLBACK_TITLES[section.section_type] || humanize(section.section_type)}
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                        {section.content}
                      </p>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {deliveryMilestones.length ? (
          <section className="mt-9">
            <DocumentHeading
              eyebrow="Delivery plan"
              title="Project milestones"
              description="Milestones describe the expected phases of delivery and their acceptance criteria."
            />
            <div className="mt-4 space-y-3">
              {deliveryMilestones.map((milestone, index) => (
                <article key={milestone.id} className="milestone-card rounded-2xl border border-neutral-200 p-5">
                  <div className="flex items-start justify-between gap-5">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Milestone {index + 1}
                      </p>
                      <h3 className="mt-1 font-semibold">{milestone.title}</h3>
                    </div>
                    <div className="shrink-0 text-right text-xs text-neutral-500">
                      {milestone.estimated_duration ? <p>{milestone.estimated_duration}</p> : null}
                      {milestone.estimated_start_date || milestone.estimated_end_date ? (
                        <p className="mt-1">
                          {formatDate(milestone.estimated_start_date)} - {formatDate(milestone.estimated_end_date)}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {milestone.description ? (
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-neutral-600">
                      {milestone.description}
                    </p>
                  ) : null}
                  {milestone.acceptance_criteria ? (
                    <div className="print-muted-bg mt-4 rounded-xl bg-neutral-50 p-4 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Acceptance criteria
                      </p>
                      <p className="mt-2 whitespace-pre-wrap leading-6 text-neutral-600">
                        {milestone.acceptance_criteria}
                      </p>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {paymentMilestones.length ? (
          <section className="mt-9">
            <DocumentHeading
              eyebrow="Commercial terms"
              title="Payment schedule"
              description="Payments are tied to the conditions, dates, or delivery milestones specified below."
            />
            <div className="mt-4 overflow-hidden rounded-2xl border border-neutral-200">
              {paymentMilestones.map((payment, index) => {
                const linkedMilestone = payment.quotation_milestone_id
                  ? deliveryMilestones.find((milestone) => milestone.id === payment.quotation_milestone_id)
                  : null;
                return (
                  <div
                    key={payment.id}
                    className="payment-row flex items-start justify-between gap-6 border-b border-neutral-200 p-4 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">
                        Payment {index + 1}
                      </p>
                      <p className="mt-1 font-semibold">{payment.title}</p>
                      {payment.description ? (
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-neutral-500">
                          {payment.description}
                        </p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
                        {payment.due_condition ? <span>Due: {humanize(payment.due_condition)}</span> : null}
                        {payment.due_date ? <span>Date: {formatDate(payment.due_date)}</span> : null}
                        {linkedMilestone ? <span>Linked to: {linkedMilestone.title}</span> : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-semibold">{money(payment.amount, detail.currency)}</p>
                      {payment.payment_type === "percentage" && payment.percentage != null ? (
                        <p className="mt-1 text-xs text-neutral-400">{Number(payment.percentage)}%</p>
                      ) : (
                        <p className="mt-1 text-xs text-neutral-400">Fixed amount</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="acceptance-block mt-10 rounded-2xl border border-neutral-300 p-6">
          <div className="flex items-start justify-between gap-8">
            <div className="max-w-[70%]">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">Acceptance</p>
              <h2 className="mt-2 text-xl font-semibold">Quotation acceptance</h2>
              <p className="mt-2 text-sm leading-6 text-neutral-600">
                By accepting this quotation, the client confirms agreement with the pricing, visible scope,
                delivery plan, payment schedule, and commercial terms contained in revision R{detail.revision_number}.
              </p>
              {detail.valid_until ? (
                <p className="mt-2 text-sm font-medium text-neutral-700">
                  This quotation is valid until {formatDate(detail.valid_until)}.
                </p>
              ) : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-xs text-neutral-400">Quotation total</p>
              <p className="mt-1 text-xl font-semibold">{money(detail.total, detail.currency)}</p>
            </div>
          </div>

          <div className="mt-9 grid grid-cols-2 gap-10">
            <SignatureLine label="Authorized by seller" value={detail.prepared_by_name_snapshot || detail.seller_name_snapshot} />
            <SignatureLine label="Accepted by client" value={detail.client_contact_snapshot || detail.client_name_snapshot} />
            <SignatureLine label="Signature" />
            <SignatureLine label="Date" />
          </div>
        </section>

        <footer className="avoid-break mt-9 border-t border-neutral-200 pt-5">
          <div className="flex items-end justify-between gap-6 text-xs text-neutral-400">
            <div>
              <p className="font-semibold text-neutral-500">{detail.seller_name_snapshot}</p>
              {sellerContact ? <p className="mt-1">{sellerContact}</p> : null}
            </div>
            <div className="text-right">
              <p>{detail.quotation_number} · Revision R{detail.revision_number}</p>
              <p className="mt-1">Commercial quotation</p>
            </div>
          </div>
        </footer>
      </article>
    </main>
  );
}

function DocumentHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="mt-9">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-neutral-500">{description}</p>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 font-medium">{value}</p>
    </div>
  );
}

function Total({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      className={`mt-2 flex items-center justify-between gap-4 ${
        strong ? "text-base font-semibold" : "text-sm text-neutral-600"
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="print-muted-bg rounded-xl bg-neutral-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-400">{label}</p>
      <p className="mt-1 text-sm font-semibold text-neutral-700">{value}</p>
    </div>
  );
}

function SignatureLine({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <div className="min-h-7 border-b border-neutral-400 pb-1 text-sm text-neutral-700">{value || ""}</div>
      <p className="mt-1 text-xs text-neutral-400">{label}</p>
    </div>
  );
}
