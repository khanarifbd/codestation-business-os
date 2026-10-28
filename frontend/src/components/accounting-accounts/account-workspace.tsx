"use client";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Plus, Pencil, RefreshCw, Download, ChevronDown, Landmark, WalletCards } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { CursorPager } from "@/components/cursor-pager";
import { StripeLivePayoutPanel } from "@/components/stripe-live-payout-panel";
import { useAccountingAccounts, type AccountingAccountsState } from "@/hooks/use-accounting-accounts";
import { accountMoney, accountLabel, type FinancialAccount } from "./account-model";
import { AccountState, AccountHeading, CurrencyValues, AccountSectionHeading } from "./account-ui";
import { AccountEditor } from "./account-editor";
import "./account-workspace.css";
type Props = {
    vm: AccountingAccountsState;
};
export function AccountsWorkspace() {
    const { tenant, loading } = useDashboardSession(), pathname = usePathname();
    const key = `${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`;
    if (loading)
        return <RelationshipPage className="aa-workspace"><AccountState loading title="Loading financial accounts…"/></RelationshipPage>;
    return <AccountsContent key={key}/>;
}
function AccountsContent() {
    const vm = useAccountingAccounts();
    if (!vm.canView && !(vm.mode === "create" && vm.canManage))
        return <RelationshipPage className="aa-workspace"><AccountState title="Financial accounts are restricted" action={vm.mode === "register" && vm.canManage ? <a className="aa-primary" href={vm.createHref}><Plus aria-hidden="true"/>Add account</a> : undefined}>Your current company role does not include finance viewing permission.{vm.mode === "register" && vm.canManage ? " You can still create a financial account." : ""}</AccountState></RelationshipPage>;
    return <RelationshipPage className="aa-workspace">
    {vm.mode !== "register" ? <div className="aa-breadcrumb"><button className="aa-back" onClick={vm.back} disabled={vm.saving}><ArrowLeft aria-hidden="true"/>{vm.mode === "edit" ? "Back to statement" : "Back to accounts"}</button><span>{vm.mode === "view" ? "Account statement" : vm.mode === "edit" ? "Account settings" : "New account"}</span></div> : null}
    {vm.error ? <RelationshipNotice tone="error">{vm.error}</RelationshipNotice> : null}
    {vm.committed ? <AccountState title="Account saved" action={<button className="aa-primary" onClick={vm.openSaved}>{vm.canView ? "Open saved result" : "Return to dashboard"}<ArrowRight aria-hidden="true"/></button>}>The server confirmed this change. Do not submit it again. {vm.canView ? "Open the account or register to review the saved record." : "Your role can create accounts but cannot view balances or statements."}</AccountState>
            : vm.mode === "create" ? vm.canManage ? <AccountEditor vm={vm}/> : <AccountState title="Account creation is restricted">Creating an account requires finance management permission.</AccountState>
            : vm.loading && !vm.accounts ? <AccountState loading title="Loading financial accounts…">Retrieving balances and account details.</AccountState>
                : !vm.accounts ? <AccountState title="Accounts unavailable" action={<button className="aa-secondary" onClick={() => void vm.load()}>Retry loading</button>}>No balances are shown because the account response could not be verified.</AccountState>
                    : vm.mode === "register" ? <AccountRegister vm={vm}/>
                        : vm.mode !== "create" && !vm.account ? <AccountState title="Account unavailable" action={<button className="aa-secondary" onClick={() => void vm.load()}>Retry loading</button>}>This account was not found in the current company’s account collection.</AccountState>
                            : vm.editing ? vm.canManage ? <AccountEditor vm={vm}/> : <AccountState title="Account editing is restricted">You can view financial accounts, but changing them requires finance management permission.</AccountState>
                                : <AccountDocument vm={vm}/>}
  </RelationshipPage>;
}
function AccountRegister({ vm }: Props) {
    return <>
    <AccountHeading eyebrow="Finance / Financial accounts" title="Where your money lives" description="A separate balance and statement for every account. Different currencies stay separate." actions={<><button className="aa-icon-button" aria-label="Refresh accounts" disabled={vm.loading} onClick={() => void vm.load()}><RefreshCw aria-hidden="true"/></button>{vm.canManage ? <a className="aa-primary" href={vm.createHref}><Plus aria-hidden="true"/>Add account</a> : null}</>}/>
    <section className="aa-position aa-position-desktop" aria-label="Current account position"><div className="aa-position-intro"><p className="aa-eyebrow">Current position</p><strong>{vm.positions.active.length}<span>active / {vm.accounts!.length} total</span></strong></div><div><h2>Available money</h2><CurrencyValues values={vm.positions.available}/><p>Active non-card accounts only</p></div><div className="aa-liabilities"><h2>Credit cards · amount owed</h2><CurrencyValues values={vm.positions.liabilities} empty="No active credit-card accounts"/><p>Liabilities, not available cash</p></div></section>
    <details className="aa-position-mobile"><summary><span><strong>{vm.positions.active.length}</strong> active / {vm.accounts!.length} accounts</span><span>Position<ChevronDown aria-hidden="true" /></span></summary><div className="aa-position"><div><h2>Available money</h2><CurrencyValues values={vm.positions.available}/><p>Active non-card accounts only</p></div><div className="aa-liabilities"><h2>Credit cards · amount owed</h2><CurrencyValues values={vm.positions.liabilities} empty="No active credit-card accounts"/><p>Liabilities, not available cash</p></div></div></details>
    <section className="aa-register"><AccountSectionHeading title="Account directory"><span>{vm.accounts!.length} accounts · balances from the account ledger</span></AccountSectionHeading>{!vm.canManage ? <p className="aa-register-note">View-only access. Account settings require finance management permission.</p> : null}
      {vm.accounts!.length ? <div className="aa-account-list"><div className="aa-account-columns" aria-hidden="true"><span>Account / provider</span><span>Currency & status</span><span>Current position</span><span>Statement</span></div>{vm.accounts!.map(account => <AccountRow key={account.id} account={account} onOpen={() => vm.openAccount(account.id)}/>)}</div> : <AccountState title="No financial accounts yet">Add a bank, cash, wallet or gateway account to start tracking an existing balance.</AccountState>}
    </section>
  </>;
}
export function AccountRow({ account, onOpen }: {
    account: FinancialAccount;
    onOpen: () => void;
}) {
    return <article className="aa-account-row" id={`account-row-${account.id}`} tabIndex={-1}><div className="aa-account-identity"><span className="aa-account-icon" aria-hidden="true">{account.account_type === "bank" ? <Landmark /> : <WalletCards />}</span><div><button onClick={onOpen} className="aa-name">{account.name}</button><p>{accountLabel(account.account_type)}{account.provider_name ? ` · ${account.provider_name}` : ""}</p>{account.account_reference ? <span className="aa-row-reference">{account.account_reference}</span> : null}</div></div><div className="aa-account-status"><strong>{account.currency}</strong><span className="aa-badge" data-active={account.is_active}>{account.is_active ? "Active" : "Inactive"}</span></div><div className="aa-account-amount"><strong>{accountMoney(account.current_balance, account.currency)}</strong><span>{account.account_type === "credit_card" ? "Amount owed" : "Current balance"}</span></div><button className="aa-row-link" aria-label={`Open statement for ${account.name}`} onClick={onOpen}>Statement<ArrowRight aria-hidden="true"/></button></article>;
}
function AccountDocument({ vm }: Props) {
    const account = vm.account!;
    return <>
    <AccountHeading eyebrow={`${accountLabel(account.account_type)} / ${account.currency}`} title={account.name} description={account.provider_name || account.account_reference || "Account balance and transaction statement"} actions={<><button className="aa-icon-button" aria-label="Refresh account and statement" onClick={() => void vm.refresh()} disabled={vm.loading || vm.ledgerLoading}><RefreshCw aria-hidden="true"/></button>{vm.canManage ? <a className="aa-secondary" href={vm.editHref}><Pencil aria-hidden="true"/>Edit account & gateway</a> : <span className="aa-muted">View only</span>}</>}/>
    <div className="aa-account-balance"><div><span className="aa-badge" data-active={account.is_active}>{account.is_active ? "Active account" : "Inactive account"}</span><p>{account.account_type === "credit_card" ? "Amount currently owed" : "Current balance"}</p><strong>{accountMoney(account.current_balance, account.currency)}</strong></div><dl><div><dt>Opening balance</dt><dd>{accountMoney(account.opening_balance, account.currency)}</dd></div><div><dt>Credit · this page</dt><dd>{vm.ledger ? accountMoney(vm.pageTotals.credit, account.currency) : "—"}</dd></div><div><dt>Debit · this page</dt><dd>{vm.ledger ? accountMoney(vm.pageTotals.debit, account.currency) : "—"}</dd></div></dl></div>
    <AccountStatement vm={vm}/>
    <details className="aa-account-context"><summary><span>Account details & payment instructions</span><ChevronDown aria-hidden="true"/></summary><dl><Datum label="Account type" value={accountLabel(account.account_type)}/><Datum label="Provider" value={account.provider_name}/><Datum label="Account holder" value={account.account_holder_name}/><Datum label="Account / reference" value={account.account_reference}/><Datum label="Gateway connection" value={account.gateway_connection_id}/><Datum label="Default payment URL" value={account.payment_url}/><Datum label="Client payment instructions" value={account.payment_instructions}/><Datum label="Internal notes" value={account.notes}/></dl><p>Currency and opening balance are ledger history. Gateway links do not move money.</p></details>
    {account.account_type === "payment_gateway" && account.gateway_connection_id ? <div className="aa-payout-existing">{!vm.canManage ? <p className="aa-muted">Any payout posting controls below require finance management permission.</p> : null}<fieldset disabled={!vm.canManage}><StripeLivePayoutPanel account={account} onPosted={vm.refresh}/></fieldset></div> : null}
  </>;
}
function Datum({ label, value }: {
    label: string;
    value: string | null;
}) {
    return <div><dt>{label}</dt><dd>{value || "—"}</dd></div>;
}
function AccountStatement({ vm }: Props) {
    const activeFilters = Boolean(vm.browse.search || vm.browse.direction !== "all" || vm.browse.source_type || vm.browse.date_from || vm.browse.date_to);
    const filters = <div className="aa-ledger-filters"><form onSubmit={event => {
        event.preventDefault();
        vm.changeLedger({ search: vm.queryDraft });
    }}><label><span>Search statement</span><input type="search" value={vm.queryDraft} onChange={event => vm.setQueryDraft(event.target.value)} placeholder="Description, reference or source…"/></label><button className="aa-secondary" type="submit">Search</button></form><label><span>Direction</span><select value={vm.browse.direction} onChange={event => vm.changeLedger({ direction: event.target.value as "all" | "credit" | "debit" })}><option value="all">Credit & debit</option><option value="credit">Credit</option><option value="debit">Debit</option></select></label><label><span>Source type</span><select value={vm.browse.source_type} onChange={event => vm.changeLedger({ source_type: event.target.value })}><option value="">All source types</option>{vm.sourceTypes.map(value => <option key={value} value={value}>{accountLabel(value)}</option>)}</select></label><label><span>From date</span><input type="date" value={vm.browse.date_from} onChange={event => vm.changeLedger({ date_from: event.target.value })}/></label><label><span>To date</span><input type="date" value={vm.browse.date_to} onChange={event => vm.changeLedger({ date_to: event.target.value })}/></label>{activeFilters ? <button className="aa-secondary" onClick={() => vm.changeLedger({
        search: "", direction: "all", source_type: "", date_from: "", date_to: ""
    })}>Clear filters</button> : null}</div>;
    return <section className="aa-statement"><AccountSectionHeading title="Account statement" action={<button className="aa-secondary" disabled={vm.ledgerLoading || !vm.ledger?.items.length} onClick={vm.exportPage}><Download aria-hidden="true"/>Export this page</button>}>Server-filtered transactions · page totals do not replace the account balance</AccountSectionHeading><div className="aa-filters-desktop">{filters}</div><details className="aa-filters-mobile"><summary>Statement filters{activeFilters ? " · applied" : ""}<ChevronDown aria-hidden="true"/></summary>{filters}</details>
    {vm.ledgerError ? <AccountState title="Statement unavailable" action={<button className="aa-secondary" onClick={vm.retryLedger}>Retry statement</button>}>{vm.ledgerError} No page totals or export are available until it loads.</AccountState> : vm.ledgerLoading ? <AccountState loading title="Loading statement…"/> : vm.ledger?.items.length ? <div className="aa-ledger"><table><thead><tr><th scope="col">Date</th><th scope="col">Description / source ID</th><th scope="col">Source</th><th scope="col">Reference</th><th scope="col" className="aa-number">Debit</th><th scope="col" className="aa-number">Credit</th></tr></thead><tbody>{vm.ledger.items.map(row => <tr key={row.id}><td><span className="aa-mobile-label">Date</span>{row.transaction_date}</td><td className="aa-ledger-description"><strong>{row.description || accountLabel(row.source_type)}</strong><span>{row.source_id}</span></td><td><span className="aa-mobile-label">Source</span>{accountLabel(row.source_type)}</td><td><span className="aa-mobile-label">Reference</span>{row.reference || "—"}</td><td className="aa-number"><span className="aa-mobile-label">Debit</span>{row.direction === "debit" ? accountMoney(row.amount, row.currency) : "—"}</td><td className="aa-number"><span className="aa-mobile-label">Credit</span>{row.direction === "credit" ? accountMoney(row.amount, row.currency) : "—"}</td></tr>)}</tbody></table></div> : <AccountState title="No matching account transactions">{activeFilters ? "Change the filters or select another date range." : "This account has no transactions in the current statement page."}</AccountState>}
    <div className="aa-pager"><CursorPager page={vm.browse.page} pageSize={vm.browse.size} shownCount={vm.ledger?.items.length ?? 0} hasPrevious={vm.hasPreviousPage} hasNext={Boolean(vm.ledger?.next_cursor)} loading={vm.ledgerLoading} onPrevious={vm.previousLedgerPage} onNext={() => void vm.nextLedgerPage()} onPageSizeChange={size => vm.changeLedger({ size })}/></div>
    {vm.browse.page > 1 && !vm.hasPreviousPage ? <p className="aa-register-note">{vm.previousHistoryLoading ? "Checking this tab’s earlier statement pages…" : <>Earlier page history is unavailable in this tab. You can continue forward or <button className="aa-text-button" onClick={() => vm.changeLedger({})}>return to the first page</button> with the same filters.</>}</p> : null}
    <p className="aa-register-note">Source choices reflect this page. CSV exports only the currently loaded page, with the original debit and credit directions.</p>
  </section>;
}
