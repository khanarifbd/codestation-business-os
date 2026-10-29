"use client";
import { ArrowRight, Plus, RefreshCw, Search, CalendarRange, Repeat2, Zap } from "lucide-react";
import { useControlBrowse } from "@/hooks/use-control-browse";
import { controlMoney, isAutomation, isPeriod, isRecurring, pretty } from "./control-model";
import type { ControlTab } from "./control-types";
import { ControlHeading, ControlState, ControlTag, ControlPager } from "./control-ui";
const tabs = [
  { key: "recurring", label: "Recurring schedules", icon: Repeat2 },
  { key: "automation", label: "Auto Post", icon: Zap },
  { key: "periods", label: "Accounting periods", icon: CalendarRange }
] as const;
export function ControlRegister({ defaultTab = "recurring" }: {
  defaultTab?: ControlTab;
}) {
  const vm = useControlBrowse(defaultTab), title = tabs.find(t => t.key === vm.tab)!.label;
  const options = vm.tab === "recurring" ? ["all", "active", "paused"] : vm.tab === "automation" ? ["all", "enabled", "disabled", "needs_attention", "eligible", "ineligible"] : ["all", "open", "closed"];
  return <div className="ct-workspace">

    <ControlHeading
      eyebrow="Accounting / Controls"
      title={title}
      description="Browse saved controls, inspect a record, then review an explicit action in its own workspace."
      actions={<>

        <button type="button" className="aa-secondary" onClick={vm.refresh} disabled={vm.resource.loading}><RefreshCw aria-hidden="true" />Refresh</button>

        {vm.canManage && vm.canView && vm.tab !== "automation" ? <a className="aa-primary" href={vm.createHref}>

          <Plus aria-hidden="true" />

          {vm.tab === "periods" ? "New period" : "New schedule"}

        </a> : null}

      </>} />


    <nav className="ct-tabs" aria-label="Control registers">

      {tabs.map(t => <button
        key={t.key}
        type="button"
        aria-current={vm.tab === t.key ? "page" : undefined}
        onClick={() => vm.apply({ tab: t.key, status: "all" })}>

        <t.icon aria-hidden="true" />

        {t.label}

      </button>)}

    </nav>


    {!vm.canView ? <ControlState title="Finance read access required">Management permission alone does not expose financial records.</ControlState> : <>


      <div className="ct-register-context">

        <div>

          <span className="aa-eyebrow">

            {vm.tab === "automation" ? "Setup & last reported attempt" : vm.tab === "periods" ? "Inclusive date controls" : "Manual by default"}

          </span>

          <p>

            {vm.tab === "automation" ? "Eligibility describes configuration, not available funds, period approval or proof that a scheduler is running." : vm.tab === "periods" ? "Open a period to inspect its date range and close or reopen history. Creating a period does not close it." : "Each schedule keeps its own currency, payment account and next due date. Posting and automation are separate actions."}

          </p>

        </div>

        <span className="ct-count">

          {vm.resource.value ? vm.total : "—"}

          <small>returned records</small>

        </span>

      </div>


      <div className="ct-filter">

        <label>

          <Search aria-hidden="true" />

          <span className="sr-only">Search returned controls</span>

          <input
            type="search"
            value={vm.browse.search}
            onChange={e => vm.apply({ search: e.target.value })}
            placeholder="Search name, description or account" />

        </label>

        <label>

          <span>Status</span>

          <select value={vm.browse.status} onChange={e => vm.apply({ status: e.target.value })}>

            {options.map(s => <option key={s} value={s}>

              {pretty(s)}

            </option>)}

          </select>

        </label>

      </div>


      {vm.resource.loading ? <ControlState title="Loading control register" loading /> : vm.resource.error ? <ControlState
        title="Register unavailable"
        action={<button className="aa-secondary" onClick={vm.refresh}>Retry read</button>}>

        {vm.resource.error}

      </ControlState> : !vm.rows.length ? <ControlState title={vm.total ? "No matching controls" : "No saved controls"}>

        {vm.total ? "Change the search or status filter. No records were changed." : "Create a recurring schedule or accounting period when your company needs one."}

      </ControlState> : <div className="ct-register" role="list" aria-label={title}>

        {vm.rows.map(row => <a key={row.id} id={`control-row-${row.id}`} role="listitem" className="ct-row" href={vm.viewHref(row.id)}>

          <div className="ct-row-main">

            <span className="ct-row-kicker">

              {isPeriod(row) ? "Accounting period" : isAutomation(row) ? "Automation control" : "Recurring schedule"}

            </span>

            <h2>

              {row.name}

            </h2>

            <p>

              {isPeriod(row) ? `${row.start_date} → ${row.end_date} · dates included` : row.description}

            </p>

          </div>

          <div className="ct-row-value">

            {isPeriod(row) ? <>

              <strong>

                {pretty(row.status)}

              </strong>

              <small>

                {row.closed_at ? `Closed ${row.closed_at.slice(0, 10)}` : "No closing date recorded"}

              </small>

            </> : <>

              <strong>

                {controlMoney(row.expense_amount, row.expense_currency)}

              </strong>

              <small>Every {row.interval_count} {pretty(row.frequency).toLowerCase()} interval</small>

            </>}

          </div>

          <div className="ct-row-context">

            {!isPeriod(row) ? <>

              <strong>Next due · {row.next_due_date}</strong>

              <small>{row.account_name} · {row.account_currency}</small>

            </> : <>

              <strong>

                {row.reopened_at ? `Reopened ${row.reopened_at.slice(0, 10)}` : "Period controls"}

              </strong>

              <small>View notes & audit context</small>

            </>}

          </div>

          <div className="ct-row-state">

            {isRecurring(row) ? <ControlTag tone={row.is_active ? "good" : "neutral"}>

              {row.is_active ? "Active" : "Paused"}

            </ControlTag> : isAutomation(row) ? <>

              <ControlTag tone={row.last_error ? "warn" : row.auto_post ? "good" : "neutral"}>

                {row.auto_post ? "Enabled" : "Disabled"}

              </ControlTag>

              <small>

                {row.last_error ? "Attempt needs attention" : row.eligible ? "Setup eligible" : "Setup restricted"}

              </small>

            </> : <ControlTag tone={row.status === "closed" ? "warn" : row.status === "open" ? "good" : "neutral"}>

              {pretty(row.status)}

            </ControlTag>}

            <ArrowRight aria-label="View record" />

          </div>

        </a>)}

      </div>}


      {vm.resource.value ? <ControlPager
        page={vm.page}
        pages={vm.pageCount}
        total={vm.filteredCount}
        onPage={vm.goPage}
        scope="matching returned records" /> : null}

      <p className="ct-footnote">Search, filters and pagination apply to this returned collection. Amounts remain in each record’s currency; no mixed-currency total is calculated.</p>

    </>}


  </div>;
}
