"use client";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { useControlDocument } from "@/hooks/use-control-document";
import { controlDetailHref } from "@/lib/finance-controls-navigation";
import { controlMoney, controlToday, isAutomation, isPeriod, isRecurring, pretty } from "./control-model";
import type { ControlTab } from "./control-types";
import { ControlBack, ControlDatum, ControlDocumentGate, ControlHeading, ControlNotice, ControlSectionHeading, ControlTag } from "./control-ui";
export function ControlDocument({ tab, id, returnTo }: {
  tab: ControlTab;
  id: string;
  returnTo: string;
}) {
  const vm = useControlDocument(tab, id, returnTo),
    row = vm.record,
    { tenant } = useDashboardSession(),
    today = controlToday(tenant?.organization.timezone);
  return <div className="ct-workspace">

    <ControlBack href={vm.backHref} context="Read-only record" />

    <ControlDocumentGate vm={vm}>

      {row ? <>

        <ControlHeading
          eyebrow={`Controls / ${tab === "automation" ? "Auto Post" : tab === "periods" ? "Accounting period" : "Recurring schedule"}`}
          title={row.name}
          description={isPeriod(row) ? "Saved date range, status and audit context." : row.description}
          actions={<ControlTag
            tone={isPeriod(row) ? row.status === "closed" ? "warn" : row.status === "open" ? "good" : "neutral" : row.is_active ? "good" : "neutral"}>

            {isPeriod(row) ? pretty(row.status) : row.is_active ? "Active schedule" : "Paused schedule"}

          </ControlTag>} />


        <div className="ct-document-grid">

          <main>

            <section className="ct-hero">

              <p className="aa-eyebrow">

                {isPeriod(row) ? "Inclusive accounting dates" : "Configured expense per occurrence"}

              </p>

              <h2>

                {isPeriod(row) ? `${row.start_date} → ${row.end_date}` : controlMoney(row.expense_amount, row.expense_currency)}

              </h2>

              <p>

                {isPeriod(row) ? "Both dates belong to this period." : `Every ${row.interval_count} ${pretty(row.frequency).toLowerCase()} interval · next due ${row.next_due_date}`}

              </p>

            </section>


            <section className="ct-section">

              <ControlSectionHeading title={isPeriod(row) ? "Period history" : "Schedule context"} />

              <dl className="ct-facts">

                {isPeriod(row) ? <>

                  <ControlDatum label="Close notes">

                    {row.close_notes || "No close notes"}

                  </ControlDatum>

                  <ControlDatum label="Closed at">

                    {row.closed_at || "Not recorded"}

                  </ControlDatum>

                  <ControlDatum label="Reopen reason">

                    {row.reopen_reason || "No reopen reason"}

                  </ControlDatum>

                  <ControlDatum label="Reopened at">

                    {row.reopened_at || "Not recorded"}

                  </ControlDatum>

                </> : <>

                  <ControlDatum label="Payment account">{row.account_name} · {row.account_currency}</ControlDatum>

                  <ControlDatum label="Expense category">

                    {row.category_name}

                  </ControlDatum>

                  <ControlDatum label="Vendor">

                    {row.vendor_name || "No vendor linked"}

                  </ControlDatum>

                  <ControlDatum label="Next due">

                    {row.next_due_date}

                  </ControlDatum>

                  {isRecurring(row) ? <>

                    <ControlDatum label="End date">

                      {row.end_date || "No end date"}

                    </ControlDatum>

                    <ControlDatum label="Payment method">

                      {pretty(row.payment_method)}

                    </ControlDatum>

                    <ControlDatum label="Tax amount">

                      {controlMoney(row.tax_amount, row.expense_currency)}

                    </ControlDatum>

                    <ControlDatum label="Client / project">

                      {[row.client_id ? (row.client_name || `Client ${row.client_id} · name unavailable`) : null, row.project_id ? (row.project_name || `Project ${row.project_id} · name unavailable`) : null].filter(Boolean).join(" / ")
                        || "Not linked"}

                    </ControlDatum>

                    <ControlDatum label="Reference">

                      {row.reference || "None"}

                    </ControlDatum>

                    <ControlDatum label="Notes">

                      {row.notes || "No notes"}

                    </ControlDatum>

                  </> : null}

                </>}

              </dl>

            </section>


            {isAutomation(row) ? <section className="ct-section">

              <ControlSectionHeading title="Eligibility & last reported attempt">Configuration eligibility is not proof of sufficient funds or an open period.</ControlSectionHeading>

              <dl className="ct-facts">

                <ControlDatum label="Auto Post">

                  {row.auto_post ? "Enabled" : "Disabled"}

                </ControlDatum>

                <ControlDatum label="Setup eligibility">

                  {row.eligible ? "Eligible" : row.eligibility_reason || "Restricted"}

                </ControlDatum>

                <ControlDatum label="Last attempt">

                  {row.last_attempt_at || "No attempt recorded"}

                </ControlDatum>

                <ControlDatum label="Last reported error">

                  {row.last_error || "No error reported"}

                </ControlDatum>

              </dl>

              {row.last_error ? <ControlNotice tone="error">

                {row.last_error}

              </ControlNotice> : null}

            </section> : null}


          </main>

          <aside className="ct-aside">

            <p className="aa-eyebrow">Available actions</p>

            <h2>Review before changing</h2>

            {!vm.canManage ? <p>You can inspect this control. finance.manage is required for changes.</p> : <div className="ct-action-list">

              {isRecurring(row) ? <>

                {row.is_active ? <a href={vm.actionHref("post")}>

                  <strong>Post one expense</strong>

                  <span>Review six posting fields and keep one keyed operation.</span>

                </a> : null}

                <a href={vm.actionHref("status")}>

                  <strong>{row.is_active ? "Pause" : "Resume"} schedule</strong>

                  <span>Change availability; existing expenses stay unchanged.</span>

                </a>

                <a href={controlDetailHref("automation", id, vm.backHref)}>

                  <strong>Inspect Auto Post</strong>

                  <span>Separate automatic-posting eligibility and controls.</span>

                </a>

              </> : isAutomation(row) ? <>

                {row.auto_post || row.is_active && row.eligible ? <a href={vm.actionHref("configure")}>

                  <strong>{row.auto_post ? "Disable" : "Enable"} Auto Post</strong>

                  <span>Review the change without posting an expense now.</span>

                </a> : null}

                {row.retryable && row.is_active && row.auto_post ? <a href={vm.actionHref("retry")}>

                  <strong>Review due-occurrence attempt</strong>

                  <span>An immediate, unkeyed write with a due-date condition.</span>

                </a> : null}

                <a href={controlDetailHref("recurring", id, vm.backHref)}>

                  <strong>Inspect recurring schedule</strong>

                  <span>Read saved payment and reference context.</span>

                </a>

              </> : isPeriod(row) ? <>

                {row.status === "open" && today && row.end_date <= today ? <a href={vm.actionHref("close")}>

                  <strong>Close period</strong>

                  <span>Review inclusive dates and optional closing notes.</span>

                </a> : row.status === "closed" ? <a href={vm.actionHref("reopen")}>

                  <strong>Reopen period</strong>

                  <span>A required reason is retained in the audit trail.</span>

                </a> : <p>

                  {row.status === "open" ? "No closing action is available before the period end date." : "This saved status is not recognized for a lifecycle action. The record remains read-only."}

                </p>}

              </> : null}

            </div>}

            <p className="ct-footnote">Actions open separately. Reading this record does not submit or alter it.</p>

          </aside>

        </div>


      </> : null}

    </ControlDocumentGate>

  </div>;
}
