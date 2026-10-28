"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Plus, RefreshCw, Search } from "lucide-react";
import { useReconciliationRegister } from "@/hooks/use-reconciliation-register";
import { reconciliationMoney, reconciliationZero, RECONCILIATION_LIST_CAP } from "./reconciliation-model";
import type { ReconciliationSession } from "./reconciliation-types";
import {
  ReconciliationHeading, ReconciliationPager, ReconciliationSectionHeading,
  ReconciliationState, ReconciliationStatus,
} from "./reconciliation-ui";

type RegisterState = ReturnType<typeof useReconciliationRegister>;

export function ReconciliationRegister() {
  const vm = useReconciliationRegister();
  if (!vm.canView) return <ReconciliationState title="Reconciliations are restricted">
    Finance viewing permission is required. Management permission does not implicitly grant access to account information.
  </ReconciliationState>;

  return <>
    <ReconciliationHeading eyebrow="Finance / Reconciliation" title="Bring each statement into focus."
      description="Compare a statement with recorded account activity, then open a dedicated workspace to match its transactions."
      actions={<>
        <button type="button" className="aa-icon-button" aria-label="Refresh reconciliation register"
          disabled={vm.resource.loading} onClick={() => void vm.refresh()}><RefreshCw aria-hidden="true"/></button>
        {vm.canManage ? <a className="aa-primary" href={vm.createHref}><Plus aria-hidden="true"/>New reconciliation</a>
          : <span className="aa-muted">View only</span>}
      </>}/>
    <RegisterScope vm={vm}/>
    <section className="aa-register rc-register">
      <ReconciliationSectionHeading title="Statement register">
        Latest up to {RECONCILIATION_LIST_CAP} statements returned, ordered by statement end. Filters search only this loaded slice.
      </ReconciliationSectionHeading>
      <RegisterFilters key={`${vm.browse.search}|${vm.browse.status}|${vm.browse.account}`} vm={vm}/>
      {vm.resource.loading ? <ReconciliationState loading title="Loading statement register…"/>
        : vm.resource.error || !vm.resource.value ? <ReconciliationState title="Statement register unavailable"
          action={<button type="button" className="aa-secondary" onClick={() => void vm.refresh()}>Retry register read</button>}>
          {vm.resource.error || "The returned statement information could not be verified."} A failed read is not an empty register.
        </ReconciliationState>
          : vm.filtered.length === 0 ? <ReconciliationState title={vm.resource.value.length ? "No loaded statements match" : "No statements returned"}>
            {vm.resource.value.length ? "Adjust the loaded-slice filters. Older statements beyond the response limit are not searched here."
              : "Create a reconciliation in its own workspace when you have the account statement to hand."}
          </ReconciliationState>
            : <>
              <div className="rc-statement-columns" aria-hidden="true">
                <span>Account / statement</span><span>Statement balance</span><span>Difference at read</span><span>Review</span>
              </div>
              {vm.page.rows.map(row => <StatementRow key={row.id} row={row} href={vm.detailHref(row.id)}/>)}
              <ReconciliationPager page={vm.page.page} pages={vm.page.pages} count={vm.page.filteredCount}
                busy={vm.resource.loading} onPage={page => vm.change({ page })}/>
            </>}
    </section>
    <div className="rc-context-note">
      <strong>Finalized means selection-locked.</strong>
      <p>Balances are recalculated when read. A later reconciliation that matches an older transaction can change an earlier displayed balance; finalization does not freeze a balance snapshot.</p>
    </div>
  </>;
}

function RegisterScope({ vm }: { vm: RegisterState }) {
  if (vm.resource.loading || vm.resource.error || !vm.resource.value) return null;
  const rows = vm.resource.value;
  return <section className="rc-scope-rail" aria-label="Loaded statement scope">
    <div><span className="aa-eyebrow">Current response</span><strong>{rows.length}<small>statements loaded</small></strong></div>
    <dl>
      <div><dt>Drafts in this slice</dt><dd>{rows.filter(row => row.status === "draft").length}</dd></div>
      <div><dt>Finalized in this slice</dt><dd>{rows.filter(row => row.status === "finalized").length}</dd></div>
    </dl>
    <p>Loaded counts, not company-wide totals.<br/>Account currencies remain separate.</p>
  </section>;
}

function RegisterFilters({ vm }: { vm: RegisterState }) {
  const [search, setSearch] = useState(vm.browse.search);
  const [status, setStatus] = useState(vm.browse.status);
  const [account, setAccount] = useState(vm.browse.account);
  return <form className="rc-filters" onSubmit={event => { event.preventDefault(); vm.change({ search, status, account, page: 1 }); }}>
    <label className="rc-search"><span>Find a loaded statement</span><Search aria-hidden="true"/>
      <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Account, date, notes or statement ID"/>
    </label>
    <label><span>Status</span><select value={status} onChange={event => setStatus(event.target.value as typeof status)}>
      <option value="">All statuses</option><option value="draft">Draft</option><option value="finalized">Finalized</option>
    </select></label>
    <label><span>Account</span><select value={account} onChange={event => setAccount(event.target.value)}>
      <option value="">All loaded accounts</option>
      {account && !vm.accounts.some(row => row.id === account) ? <option value={account}>Selected account — not loaded</option> : null}
      {vm.accounts.map(row => <option key={row.id} value={row.id}>{row.name} · {row.currency}</option>)}
    </select></label>
    <div>
      <button type="submit" className="aa-primary" disabled={vm.resource.loading}>Apply filters</button>
      <button type="button" className="aa-secondary" disabled={vm.resource.loading}
        onClick={() => vm.change({ search: "", status: "", account: "", page: 1 })}>Reset</button>
    </div>
  </form>;
}

function StatementRow({ row, href }: { row: ReconciliationSession; href: string }) {
  return <article className="rc-statement-row" id={`reconciliation-row-${row.id}`} tabIndex={-1}>
    <div className="rc-statement-identity">
      <Link className="aa-name" href={href}>{row.account_name}</Link>
      <strong>Through {row.statement_end_date}</strong>
      <small>{row.statement_start_date ? `Starts ${row.statement_start_date}` : "No statement start supplied"}</small>
      <ReconciliationStatus status={row.status}/>
    </div>
    <div className="rc-money-cell"><span className="rc-cell-label">Statement balance</span>
      <b>{reconciliationMoney(row.statement_ending_balance, row.currency)}</b>
      <small>Cleared {reconciliationMoney(row.cleared_book_balance, row.currency)}</small>
    </div>
    <div className="rc-money-cell" data-zero={reconciliationZero(row.difference) || undefined}>
      <span className="rc-cell-label">Difference at read</span><b>{reconciliationMoney(row.difference, row.currency)}</b>
      <small>{row.matched_transactions} transaction{row.matched_transactions === 1 ? "" : "s"} selected</small>
    </div>
    <div className="rc-row-action"><Link className="aa-secondary" href={href}>View statement<ArrowRight aria-hidden="true"/></Link></div>
  </article>;
}
