"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowRight, CheckCircle2, FileText, FolderKanban, ReceiptText, RefreshCw, ShoppingBag, UserRound } from "lucide-react";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipNotice, RelationshipPage } from "@/components/relationships/relationship-ui";
import { useMoneyInWorkspace, type MoneyInState } from "@/hooks/use-money-in-workspace";
import { moneyInMoney, purposes, receiptInfo, type Purpose, type Receipt, type ReceiptKind } from "./money-in-model";
import { MoneyInDatum, MoneyInHeading, MoneyInSectionHeading, MoneyInState as State } from "./money-in-ui";
import { MoneyInEditor } from "./money-in-editor";
import "@/components/accounting-accounts/account-workspace.css";
import "./money-in.css";
const purposeIcons = { invoice: FileText, project: FolderKanban, order: ShoppingBag, advance: UserRound, other: ReceiptText };
const registerKinds: { value: ReceiptKind; title: string; scope: string }[] = [
  { value: "payment", title: "Invoice payments", scope: "Invoice receipts on this cursor page. These settle receivables; they are not a second direct-income entry." },
  { value: "advance", title: "Open advances", scope: "Latest 300 open customer advances at most. Amounts shown remain customer credit; this is not a complete receipt history." },
  { value: "income", title: "Direct income", scope: "Latest 50 direct-income records at most. This excludes invoice payments and customer advances." },
];
export function MoneyInWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname(), query = useSearchParams();
  if (loading) return <RelationshipPage className="aa-workspace mi-workspace"><State loading title="Loading money received…"/></RelationshipPage>;
  const identity = `${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}:${pathname.endsWith("/new") ? `${query.get("purpose")}:${query.get("invoice_id")}` : ""}`;
  return <MoneyInContent key={identity}/>;
}
function MoneyInContent() {
  const vm = useMoneyInWorkspace();
  if (!vm.canView) return <RelationshipPage className="aa-workspace mi-workspace"><State title="Money-in information is restricted">Finance viewing permission is needed to verify source documents, accounts and receipts.{vm.canManage ? " Your role can post financial transactions, but the source and account reads needed by this workspace are unavailable." : ""}</State></RelationshipPage>;
  return <RelationshipPage className="aa-workspace mi-workspace">
    {vm.mode !== "register" ? <div className="aa-breadcrumb"><button type="button" className="aa-back" onClick={vm.back} disabled={vm.saving}><ArrowLeft aria-hidden="true"/>Back to money in</button><span>{vm.mode === "create" ? "Record money received" : "Receipt / read only"}</span></div> : null}
    {vm.writeError ? <RelationshipNotice tone="error">{vm.writeError}</RelationshipNotice> : null}
    {vm.mode === "register" ? <MoneyInRegister vm={vm}/>
      : vm.mode === "receipt" ? vm.documentLoading ? <State loading title="Loading receipt…"/> : vm.document ? <MoneyInReceipt receipt={vm.document} onRefresh={() => void vm.loadDocument()}/> : <State title="Receipt unavailable" action={<button type="button" className="aa-secondary" onClick={() => void vm.loadDocument()}>Retry receipt read</button>}>{vm.documentError || "This receipt could not be verified in the current company. Do not record a replacement solely because this read is unavailable."}</State>
      : vm.stage.status === "confirmed" ? <><RelationshipNotice tone="success">The server confirmed the operation. Do not submit it again. A returned receipt can show its current status, including a later reversal.</RelationshipNotice>{vm.receipt ? <MoneyInReceipt receipt={vm.receipt}/> : <State title="Recorded; receipt could not be verified" action={<a className="aa-secondary" href={vm.verificationHref} target="_blank" rel="noopener noreferrer">Check existing records<ArrowRight aria-hidden="true"/></a>}>Confirmed status is retained even if the receipt cannot be loaded. Verify the original operation before recording anything else.</State>}<div className="mi-inline-actions">{vm.receipt ? <button type="button" className="aa-primary" onClick={vm.openReceipt}>Open receipt document<ArrowRight aria-hidden="true"/></button> : null}<button type="button" className="aa-secondary" onClick={vm.back}>Return to money in</button></div></>
      : <MoneyInEditor vm={vm}/>}
  </RelationshipPage>;
}
function MoneyInRegister({ vm }: { vm: MoneyInState }) {
  const selected = registerKinds.find(item => item.value === vm.browse.kind)!;
  return <>
    <MoneyInHeading eyebrow="Finance / Money in" title="Every receipt has a reason" description="Follow money received without confusing invoice collections, customer credit and direct income." actions={<button type="button" className="aa-icon-button" aria-label="Refresh money-in register" disabled={vm.pageLoading} onClick={() => void vm.loadPage()}><RefreshCw aria-hidden="true"/></button>}/>
    {vm.canManage ? <details className="mi-mobile-record"><summary><FileText aria-hidden="true"/><span>Record money received</span><ArrowRight aria-hidden="true"/></summary><MoneyInPurposeLinks createHref={vm.createHref}/></details> : null}
    <div className="mi-context"><ArrowDownLeft aria-hidden="true"/><p><strong>Received money, not a payment request.</strong> Record an actual receipt in the right account and business context. This does not collect funds through a bank or payment provider.</p><span>Distinct purposes<br/>No combined totals</span></div>
    <div className="mi-browse-grid"><section className="aa-register">
      <MoneyInSectionHeading title="Receipt register">Review one accounting treatment at a time.</MoneyInSectionHeading>
      <nav className="mi-tabs" aria-label="Receipt types">{registerKinds.map(item => <button type="button" key={item.value} aria-current={vm.browse.kind === item.value ? "page" : undefined} onClick={() => vm.changeKind(item.value)}>{item.title}</button>)}</nav>
      <p className="mi-register-scope">{selected.scope}{vm.browse.invoice_id && vm.browse.kind === "payment" ? " Filtered to the selected invoice." : ""}</p>
      {vm.pageLoading ? <State loading title={`Loading ${selected.title.toLowerCase()}…`}/> : vm.pageError ? <State title="Receipt register unavailable" action={<button className="aa-secondary" onClick={() => void vm.loadPage()}>Retry register read</button>}>{vm.pageError} No failed read is presented as a zero balance or an empty financial history.</State> : !vm.rows?.length ? <State title={vm.browse.kind === "advance" ? "No open advances in this loaded scope" : "No receipts in this loaded scope"}>This is the selected register only, not a company-wide income or cash total.</State> : <><div className="mi-columns" aria-hidden="true"><span>Receipt / context</span><span>Receiving account</span><span>{vm.browse.kind === "advance" ? "Credit remaining" : "Receipt amount"}</span><span>View</span></div>{vm.rows.map(row => <MoneyInRow key={row.record.id} receipt={row} href={vm.receiptHref(row)}/>)}</>}
      {vm.browse.kind === "payment" ? <div className="mi-register-pagination"><p>Page {vm.browse.page} · {vm.rows ? vm.rows.length : "—"} receipts loaded</p><div><button className="aa-secondary" type="button" disabled={vm.pageLoading || vm.paging || !vm.hasPrevious} onClick={vm.previousPage}><ArrowLeft aria-hidden="true"/>Previous</button><button className="aa-secondary" type="button" disabled={vm.pageLoading || vm.paging || !vm.nextCursor} onClick={() => void vm.nextPage()}>Next<ArrowRight aria-hidden="true"/></button></div></div> : null}
      {vm.browse.kind === "payment" && vm.browse.page > 1 && !vm.hasPrevious ? <p className="aa-register-note">Earlier-page history is unavailable in this tab. Next remains available when the server provides another page. <button type="button" className="aa-text-button" onClick={() => vm.changeKind("payment")}>Return to the first page</button></p> : null}
    </section><aside className={`mi-sidebar${vm.canManage ? " mi-sidebar-actions" : ""}`}><h2>{vm.canManage ? "Record money received" : "Receipt purposes"}</h2>{vm.canManage ? <MoneyInPurposeLinks createHref={vm.createHref}/> : <p className="aa-muted">Your role can view records. Recording a receipt requires finance management permission.</p>}<p className="aa-muted">Invoice receipts reduce receivables. Advances remain customer credit. Direct income is classified separately. Different currencies are never added together here.</p></aside></div>
  </>;
}
function MoneyInPurposeLinks({ createHref }: { createHref: (purpose: Purpose) => string }) {
  return <div className="mi-purpose-links">{purposes.map(item => <PurposeLink key={item.value} purpose={item.value} href={createHref(item.value)}/>)}</div>;
}
function PurposeLink({ purpose, href }: { purpose: Purpose; href: string }) {
  const item = purposes.find(p => p.value === purpose)!, Icon = purposeIcons[purpose];
  return <a href={href}><Icon aria-hidden="true"/><div><strong>{item.title}</strong><small>{item.help}</small></div><ArrowRight aria-hidden="true"/></a>;
}
function MoneyInRow({ receipt, href }: { receipt: Receipt; href: string }) {
  const item = receiptInfo(receipt), isAdvance = receipt.kind === "advance";
  return <article className="mi-row" tabIndex={-1} id={`money-in-row-${receipt.record.id}`}><div><Link className="aa-name" href={href}>{item.title}</Link><span>{item.context}</span><small>{item.date}</small></div><div><span className="mi-mobile-label">Receiving account</span><strong>{item.account}</strong><small>{item.status.replaceAll("_", " ")}</small></div><div><span className="mi-mobile-label">{isAdvance ? "Credit remaining" : "Receipt amount"}</span><b className="mi-amount">{moneyInMoney(isAdvance ? receipt.record.remaining_amount : item.amount, item.currency)}</b>{isAdvance ? <small>Original {moneyInMoney(receipt.record.original_amount, item.currency)}</small> : null}</div><Link className="aa-row-link" href={href} aria-label={`View receipt ${item.title}`}>View<ArrowRight aria-hidden="true"/></Link></article>;
}
export function MoneyInReceipt({ receipt, onRefresh }: { receipt: Receipt; onRefresh?: () => void }) {
  const item = receiptInfo(receipt), payment = receipt.kind === "payment" ? receipt.record : null, advance = receipt.kind === "advance" ? receipt.record : null, income = receipt.kind === "income" ? receipt.record : null;
  const StatusIcon = payment?.status === "confirmed" ? CheckCircle2 : ReceiptText;
  return <>
    <MoneyInHeading eyebrow={`Finance / ${receipt.kind === "payment" ? "Invoice receipt" : receipt.kind === "advance" ? "Customer advance" : "Direct income"}`} title={item.title} description={`${item.date} · ${item.context}`} actions={<><span className="mi-status"><StatusIcon aria-hidden="true"/>{item.status.replaceAll("_", " ")}</span>{onRefresh ? <button className="aa-icon-button" type="button" onClick={onRefresh} aria-label="Refresh receipt"><RefreshCw aria-hidden="true"/></button> : null}</>}/>
    <section className="mi-receipt-hero"><div><p className="aa-eyebrow">{payment ? "Applied to invoice" : advance ? "Original advance received" : "Direct income received"}</p><strong>{moneyInMoney(item.amount, item.currency)}</strong><p>{payment ? `${payment.invoice_number} · ${payment.client_name}` : advance ? `${advance.client_name} · customer credit, not income` : income?.category_ledger_account_name}</p></div><div><p className="aa-eyebrow">Receiving account</p><p className="mi-receipt-account">{item.account}</p>{payment ? <p>Account receipt: {moneyInMoney(payment.account_amount, payment.account_currency)}</p> : advance ? <p>Credit remaining: {moneyInMoney(advance.remaining_amount, advance.currency)}</p> : <p>{item.currency} account</p>}</div></section>
    <div className="mi-document-grid"><section className="aa-register"><MoneyInSectionHeading title="Accounting context">Saved record values, not an editable draft or a new payment instruction.</MoneyInSectionHeading><dl className="mi-details"><MoneyInDatum label="Business event">{payment ? "Invoice payment" : advance ? "Client advance" : "Other income"}</MoneyInDatum>{payment ? <><MoneyInDatum label="Invoice">{payment.invoice_number}</MoneyInDatum><MoneyInDatum label="Client">{payment.client_name}</MoneyInDatum><MoneyInDatum label="Payment method">{payment.method.replaceAll("_", " ")}</MoneyInDatum><MoneyInDatum label="Invoice amount">{moneyInMoney(payment.invoice_amount, payment.invoice_currency)}</MoneyInDatum><MoneyInDatum label="Account amount">{moneyInMoney(payment.account_amount, payment.account_currency)}</MoneyInDatum></> : advance ? <><MoneyInDatum label="Customer">{advance.client_name}</MoneyInDatum><MoneyInDatum label="Original receipt">{moneyInMoney(advance.original_amount, advance.currency)}</MoneyInDatum><MoneyInDatum label="Unapplied credit">{moneyInMoney(advance.remaining_amount, advance.currency)}</MoneyInDatum></> : income ? <><MoneyInDatum label="Income category">{income.category_ledger_account_name}</MoneyInDatum><MoneyInDatum label="Related record">{income.source_label || "No relationship"}</MoneyInDatum><MoneyInDatum label="Description">{income.description}</MoneyInDatum></> : null}</dl></section><section className="aa-register"><MoneyInSectionHeading title="Receipt details">Keep the original reference and internal context visible.</MoneyInSectionHeading><dl className="mi-details"><MoneyInDatum label="Receipt date">{item.date}</MoneyInDatum><MoneyInDatum label="Reference">{receipt.record.reference || "No reference"}</MoneyInDatum><MoneyInDatum label="Internal notes">{receipt.record.notes || "No notes"}</MoneyInDatum><MoneyInDatum label="Record ID">{receipt.record.id}</MoneyInDatum></dl></section></div>
  </>;
}
