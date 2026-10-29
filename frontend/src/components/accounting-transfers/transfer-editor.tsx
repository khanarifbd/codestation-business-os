"use client";
import { ArrowRight, ArrowRightLeft, RefreshCw } from "lucide-react";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { RelationshipNotice } from "@/components/relationships/relationship-ui";
import type { AccountingTransfersState } from "@/hooks/use-accounting-transfers";
import { transferMoney } from "./transfer-model";
import { TransferHeading, TransferSectionHeading, TransferState, TransferDatum, TransferConfirmation } from "./transfer-primitives";
export function TransferEditor({ vm }: { vm: AccountingTransfersState }) {
  const { source, destination, preview } = vm, amounts = preview.amounts, uncertain = vm.phase === "uncertain", locked = vm.saving || uncertain;
  const details = [
    { label: "From account", value: source?.name || "—" }, { label: "To account", value: destination?.name || "—" },
    { label: "Total deducted", value: amounts && source ? transferMoney(amounts.source, source.currency) : "—", emphasis: true },
    { label: "Fee included", value: amounts && source ? transferMoney(amounts.fee, source.currency) : "—" },
    { label: "Net transferred", value: amounts && source ? transferMoney(amounts.net, source.currency) : "—" },
    { label: "Actual received", value: amounts && destination ? transferMoney(amounts.received, destination.currency) : "—", emphasis: true },
    { label: "Effective rate", value: amounts && source && destination ? `1 ${source.currency} = ${amounts.rate} ${destination.currency}` : "—" },
    { label: "Transfer date", value: vm.values.transfer_date || "Today in the company’s timezone" },
    ...(vm.values.reference ? [{ label: "Reference", value: vm.values.reference }] : []),
  ];
  if (!vm.canManage) return <TransferState title="Recording transfers is restricted">Your role can review records, but posting requires finance management permission.</TransferState>;
  if (!vm.accounts) return <TransferState loading={vm.accountsLoading} title={vm.accountsLoading ? "Loading source and destination accounts…" : "Account information unavailable"} action={!vm.accountsLoading ? <button className="aa-secondary" onClick={() => void vm.loadAccounts()}>Retry accounts</button> : undefined}>Balances and account currencies must be verified before a transfer can be recorded.</TransferState>;
  return <>
    <TransferHeading eyebrow="Finance / Record transfer" title="Move money between accounts" description="Record an account-to-account movement that happened outside Business OS. Review the deduction, fee and actual receipt before posting."/>
    {uncertain ? <RelationshipNotice tone="error">The previous outcome is uncertain. Your original values and operation key are retained, and editing is locked. <a href={vm.verificationHref} target="_blank" rel="noopener noreferrer">Check the transfer register in a new tab</a> before explicitly retrying this same operation. Do not start a replacement transfer until the first outcome is verified.</RelationshipNotice> : null}
    <form onSubmit={event => { event.preventDefault(); vm.review(); }} className="tr-editor-grid">
      <div className="tr-editor-main"><section className="aa-register tr-form-section"><TransferSectionHeading title="01 / Choose the accounts">Active non-card accounts only. Credit-card liabilities cannot be settled through account transfers.</TransferSectionHeading>
        <fieldset disabled={locked} className="tr-form-fields">
          <SearchableSelect label="From account" value={vm.values.from_account_id} required disabled={locked} options={vm.eligibleAccounts.filter(a => a.id !== vm.values.to_account_id).map(a => ({ value: a.id, label: a.name, description: `${a.currency} · ${transferMoney(a.current_balance, a.currency)} last loaded balance`, keywords: `${a.currency} ${a.provider_name || ""}` }))} onValueChange={value => vm.change("from_account_id", value)}/>
          <div className="tr-direction" aria-hidden="true"><ArrowRightLeft/></div>
          <SearchableSelect label="To account" value={vm.values.to_account_id} required disabled={locked} options={vm.eligibleAccounts.filter(a => a.id !== vm.values.from_account_id).map(a => ({ value: a.id, label: a.name, description: a.currency, keywords: a.provider_name || "" }))} onValueChange={value => vm.change("to_account_id", value)}/>
        </fieldset>
        <div className="tr-inline-note"><span>Balances are checked again by the server at posting.</span><button type="button" className="aa-text-button" onClick={() => void vm.loadAccounts()} disabled={locked || vm.accountsLoading}><RefreshCw aria-hidden="true"/>Refresh accounts</button></div>
        {vm.eligibleAccounts.length < 2 ? <p className="tr-warning">At least two active non-card accounts are required. No eligible destination is fabricated.</p> : null}
      </section>
      <section className="aa-register tr-form-section"><TransferSectionHeading title="02 / Amounts & reference">The fee is already part of the total deduction, not an extra deduction.</TransferSectionHeading>
        <fieldset disabled={locked} className="tr-input-grid">
          <MoneyInput label="Total deducted from source" currency={source?.currency} value={vm.values.source_amount} required min={0.01} max={1e12} disabled={locked} onValueChange={value => vm.change("source_amount", value)}/>
          <MoneyInput label="Fee included in deduction" currency={source?.currency} value={vm.values.fee_amount} min={0} max={1e12} disabled={locked} onValueChange={value => vm.change("fee_amount", value)}/>
          {source && destination && source.currency !== destination.currency ? <MoneyInput label="Actual received by destination" currency={destination.currency} value={vm.values.destination_amount} required min={0.01} max={1e15} disabled={locked} onValueChange={value => vm.change("destination_amount", value)} hint="Enter the settled receipt, not an estimated market conversion."/> : null}
          <label className="tr-field">Transfer date<input type="date" value={vm.values.transfer_date} onChange={event => vm.change("transfer_date", event.target.value)}/><span>Blank uses today in the company’s timezone.</span></label>
          <label className="tr-field">Reference<input maxLength={180} value={vm.values.reference} onChange={event => vm.change("reference", event.target.value)} placeholder="Bank reference or internal reference"/></label>
          <label className="tr-field tr-span">Internal notes<textarea rows={3} value={vm.values.notes} onChange={event => vm.change("notes", event.target.value)} placeholder="Optional context for this movement"/></label>
        </fieldset>
      </section></div>
      <aside className="tr-review"><p className="aa-eyebrow">Before you record</p><h2>Follow the money</h2><div className="tr-review-route"><span>{source?.name || "Source account"}</span><ArrowRight aria-hidden="true"/><span>{destination?.name || "Destination account"}</span></div>
        <dl><TransferDatum label="Total deduction">{amounts && source ? transferMoney(amounts.source, source.currency) : "—"}</TransferDatum><TransferDatum label="Less: fee included">{amounts && source ? transferMoney(amounts.fee, source.currency) : "—"}</TransferDatum><TransferDatum label="Net transferred">{amounts && source ? transferMoney(amounts.net, source.currency) : "—"}</TransferDatum><TransferDatum label="Destination receives">{amounts && destination ? transferMoney(amounts.received, destination.currency) : "—"}</TransferDatum><TransferDatum label="Effective rate">{amounts && source && destination ? `1 ${source.currency} = ${amounts.rate} ${destination.currency}` : "—"}</TransferDatum></dl>
        {preview.error ? <p className="tr-validation" role="status">{preview.error}</p> : <p className="aa-muted">Amounts use server-equivalent two-decimal rounding. The effective rate is shown to eight decimals.</p>}
        <button className="aa-primary tr-submit" disabled={vm.saving || !uncertain && !amounts} type="submit">{vm.saving ? "Recording…" : uncertain ? "Review same-operation retry" : "Review transfer"}<ArrowRight aria-hidden="true"/></button><button className="aa-secondary tr-submit" disabled={vm.saving} type="button" onClick={vm.back}>Cancel & back to transfers</button>
        <p className="tr-record-note">Recording updates the ledger only. It does not send a bank instruction or trigger a payment provider.</p>
      </aside>
    </form>
    <TransferConfirmation open={vm.confirmOpen} loading={vm.saving} details={details} uncertain={uncertain} onCancel={vm.cancelReview} onConfirm={vm.postTransfer}/>
  </>;
}
