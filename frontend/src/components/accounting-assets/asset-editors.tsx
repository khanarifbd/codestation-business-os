"use client";

import { ArrowRight, CalendarDays } from "lucide-react";
import { CurrencySelect } from "@/components/currency-select";
import { MoneyInput } from "@/components/money-input";
import { SearchableSelect } from "@/components/searchable-select";
import { useAssetCreate, useAssetDepreciation, type AssetCreateState } from "@/hooks/use-asset-editors";
import { assetDetailHref } from "@/lib/asset-navigation";
import { assetCents, assetCentsText, assetDate, assetMoney, pretty } from "./asset-model";
import type { DepreciationRun } from "./asset-types";
import { AssetActionStatus, AssetBack, AssetConfirmation, AssetDatum, AssetField, AssetHeading, AssetNotice, AssetSectionHeading, AssetState } from "./asset-ui";

export function AssetCreateEditor({ returnHref }: { returnHref: string }) {
  const vm = useAssetCreate(returnHref);
  if (!vm.canView || !vm.canManage) return <AssetState title="Asset recording is restricted">Finance viewing and management permissions are required. This workspace does not infer authority from an unavailable account list.</AssetState>;
  return <div>
    <AssetBack onClick={vm.cancel} disabled={vm.action.busy} context="Record an asset · immediate accounting"/>
    <AssetHeading eyebrow="Finance / Fixed assets / Record" title="Bring an asset onto the books." description="Choose a purchase with cash movement or an existing opening balance. Recording posts immediately; it is not a saved draft."/>
    <AssetActionStatus action={vm.action} inspectHref={vm.backHref}/>
    {vm.error ? <AssetNotice tone="error">{vm.error}</AssetNotice> : null}
    {vm.meta.loading ? <AssetState loading title="Loading authorized account context…"/> : vm.meta.error ? <AssetState title="Asset recording context unavailable" action={<button type="button" className="aa-secondary" disabled={vm.action.busy} onClick={()=>void vm.refresh()}>Retry context read</button>}>{vm.meta.error}</AssetState> : !vm.meta.value ? <AssetState title="No verified account context">Recording stays unavailable until the existing metadata response is verified.</AssetState> : <form onSubmit={event=>{event.preventDefault();vm.review();}} className="fa-editor-layout" aria-label="Record asset">
      <section className="fa-panel fa-form-panel"><AssetSectionHeading title="Asset and accounting basis">Original-currency values; the server verifies accounts, exchange rates and accounting periods.</AssetSectionHeading><AssetCreateFields vm={vm}/></section>
      <AssetCreateReview vm={vm}/>
    </form>}
    <AssetConfirmation action={vm.action}/>
  </div>;
}

function AssetCreateFields({ vm }: { vm: AssetCreateState }) {
  const { form, change } = vm, locked = vm.action.locked, opening = form.record_mode === "opening";
  const accounts = vm.meta.value?.accounts.filter(account=>account.account_type !== "credit_card") || [];
  return <>
    <fieldset className="fa-modes" disabled={locked}><legend>How is this asset being recorded?</legend><div className="fa-mode-options">
      <label><input type="radio" name="record_mode" value="purchase" checked={!opening} onChange={()=>change("record_mode","purchase")}/><span><strong>Asset purchase</strong><small>Record cost and decrease a cash/bank account.</small></span></label>
      <label><input type="radio" name="record_mode" value="opening" checked={opening} onChange={()=>change("record_mode","opening")}/><span><strong>Existing / opening asset</strong><small>Bring forward cost and depreciation; no cash movement.</small></span></label>
    </div></fieldset>
    <div className="fa-fields">
      <AssetField label="Asset code"><input required maxLength={50} value={form.asset_code} onChange={e=>change("asset_code",e.target.value)} disabled={locked} autoComplete="off"/></AssetField>
      <AssetField label="Category" hint="A descriptive category, such as equipment or furniture."><input required minLength={2} maxLength={80} value={form.category} onChange={e=>change("category",e.target.value)} disabled={locked}/></AssetField>
      <AssetField label="Asset name" wide><input required minLength={2} maxLength={220} value={form.name} onChange={e=>change("name",e.target.value)} disabled={locked}/></AssetField>
      {opening ? <CurrencySelect label="Asset currency" value={form.currency} onValueChange={value=>change("currency",value)} required clearable={false} disabled={locked}/> : <div className="fa-span"><SearchableSelect label="Pay from account" value={form.purchase_account_id} onValueChange={value=>change("purchase_account_id",value)} options={accounts.map(account=>({value:account.id,label:account.name,description:`${account.currency} · ${pretty(account.account_type)} · Last read balance ${assetMoney(account.balance,account.currency)}`}))} required disabled={locked} placeholder="Select an eligible financial account"/><p className="fa-muted">Active accounts only; credit cards are excluded. Choosing an account sets the asset currency. A read balance is not a reservation of funds.</p>{!accounts.length ? <AssetNotice tone="warning">No eligible purchase accounts were returned. An opening asset is a different accounting operation, not a workaround for a missing account.</AssetNotice> : null}</div>}
      {!opening ? <AssetField label="Asset currency" hint="Matches the selected purchase account."><input value={form.currency} readOnly aria-readonly="true"/></AssetField> : null}
      <MoneyInput label="Acquisition cost" currency={form.currency} value={form.acquisition_cost} onValueChange={value=>change("acquisition_cost",value)} required disabled={locked} step={0.01}/>
      <MoneyInput label="Salvage value" currency={form.currency} value={form.salvage_value} onValueChange={value=>change("salvage_value",value)} required disabled={locked}/>
      <AssetField label="Acquisition date" hint="The existing server also uses this date for the acquisition exchange-rate basis."><input type="date" required value={form.acquisition_date} onChange={e=>change("acquisition_date",e.target.value)} disabled={locked}/></AssetField>
      <AssetField label="In-service date" hint="On or after the acquisition date."><input type="date" required min={form.acquisition_date || undefined} value={form.in_service_date} onChange={e=>change("in_service_date",e.target.value)} disabled={locked}/></AssetField>
      <AssetField label="Useful life (months)" hint="Straight-line divisor; not a promise of exactly this many postings."><input type="number" required min={1} max={1200} step={1} value={form.useful_life_months} onChange={e=>change("useful_life_months",e.target.value)} disabled={locked}/></AssetField>
      {opening ? <><MoneyInput label="Opening accumulated depreciation" currency={form.currency} value={form.opening_accumulated_depreciation} onValueChange={value=>change("opening_accumulated_depreciation",value)} required disabled={locked}/><AssetField label="Opening balance date" hint="Journal posting date; on or after in-service. Its month and earlier months are excluded from subsequent depreciation runs."><input type="date" required min={form.in_service_date || undefined} value={form.opening_balance_date} onChange={e=>change("opening_balance_date",e.target.value)} disabled={locked}/></AssetField></> : null}
      <AssetField label="Reference" wide><input maxLength={180} value={form.reference} onChange={e=>change("reference",e.target.value)} disabled={locked}/></AssetField>
      <AssetField label="Notes" wide><textarea rows={4} value={form.notes} onChange={e=>change("notes",e.target.value)} disabled={locked}/></AssetField>
    </div>
  </>;
}

function AssetCreateReview({ vm }: { vm: AssetCreateState }) {
  const body=vm.preview, opening=vm.form.record_mode==="opening", account=vm.meta.value?.accounts.find(row=>row.id===body?.purchase_account_id);
  const book=body ? assetCentsText(assetCents(body.acquisition_cost)!-assetCents(body.opening_accumulated_depreciation)!) : null;
  return <aside className="fa-review"><p className="aa-eyebrow">Before you record</p><h2>{opening ? "An opening balance, not a purchase" : "A purchase, not an expense draft"}</h2>
    <p className="fa-muted">{opening ? "Gross asset cost and opening accumulated depreciation are posted with net opening equity. No cash account is changed." : "The acquisition cost decreases the chosen cash/bank account immediately and is recorded as a fixed asset."}</p>
    {body ? <><div className="fa-review-amount"><small>{opening ? "Opening book value" : "Cash paid / acquisition cost"}</small><strong>{assetMoney(opening ? book! : body.acquisition_cost,body.currency)}</strong></div><dl><AssetDatum label="Acquisition cost">{assetMoney(body.acquisition_cost,body.currency)}</AssetDatum><AssetDatum label="Salvage value">{assetMoney(body.salvage_value,body.currency)}</AssetDatum>{opening ? <AssetDatum label="Opening accumulated depreciation">{assetMoney(body.opening_accumulated_depreciation,body.currency)}</AssetDatum> : <AssetDatum label="Pay from">{account?.name || body.purchase_account_id}</AssetDatum>}<AssetDatum label="Journal posting date">{opening ? body.opening_balance_date : body.acquisition_date}</AssetDatum><AssetDatum label="Acquisition / FX basis date">{body.acquisition_date}</AssetDatum><AssetDatum label="In service / useful life">{body.in_service_date} · {body.useful_life_months} months</AssetDatum></dl></> : <AssetNotice>Complete the required details to review exact stored-cent values. No amount or eligibility has been inferred.</AssetNotice>}
    <p className="fa-muted">Amounts are reviewed in the asset currency. Exchange rates, account balance and open accounting periods are rechecked by the server; no functional-currency estimate is shown.</p>
    <button type="submit" className="aa-primary" disabled={vm.action.locked || !vm.readiness}>Review asset recording<ArrowRight aria-hidden="true"/></button><button type="button" className="aa-secondary" onClick={vm.cancel} disabled={vm.action.busy}>Cancel and return</button>
  </aside>;
}

export function AssetDepreciationEditor({ returnHref }: { returnHref: string }) {
  const vm=useAssetDepreciation(returnHref), validDate=assetDate(vm.periodDate);
  if(!vm.canView || !vm.canManage)return <AssetState title="Depreciation posting is restricted">Finance viewing and management permissions are required for this companywide operation.</AssetState>;
  return <div><AssetBack onClick={vm.cancel} disabled={vm.action.busy} context="Companywide depreciation · non-cash posting"/><AssetHeading eyebrow="Finance / Fixed assets / Depreciation" title="One month. The whole company." description="Post one monthly straight-line amount for eligible active company assets. Choose the exact journal date; eligibility and amounts are resolved by the server."/>
    <AssetActionStatus action={vm.action} inspectHref={vm.backHref}/>{vm.error ? <AssetNotice tone="error">{vm.error}</AssetNotice> : null}
    {vm.result ? <AssetDepreciationResult result={vm.result} returnHref={vm.backHref}/> : null}
    <form className="fa-editor-layout" aria-label="Companywide depreciation" onSubmit={e=>{e.preventDefault();vm.review();}}><section className="fa-panel fa-form-panel"><AssetSectionHeading title="Posting date and monthly scope">The depreciation month is derived from this date. The journal retains the exact day you select.</AssetSectionHeading><AssetField label="Journal posting date"><input type="date" required value={vm.periodDate} onChange={e=>vm.changeDate(e.target.value)} disabled={vm.action.locked}/></AssetField><div className="fa-depreciation-context"><AssetNotice tone="warning">This is not an amount preview or a per-asset action. The run applies to all eligible active assets in the current company.</AssetNotice><ul><li>One monthly amount; no daily proration, gap filling or catch-up.</li><li>Opening assets exclude their opening month and earlier months.</li><li>Already-posted months are skipped. A later posted period can block an earlier run.</li><li>The server rechecks accounting periods. A lost response is not permission to repeat the request.</li></ul></div></section><aside className="fa-review"><p className="aa-eyebrow">Review the scope</p><h2>Non-cash accounting, companywide</h2>{validDate ? <dl><AssetDatum label="Depreciation month">{vm.periodDate.slice(0,7)}</AssetDatum><AssetDatum label="Journal posting date">{vm.periodDate}</AssetDatum><AssetDatum label="Scope">All eligible active company assets</AssetDatum><AssetDatum label="Cash movement">None</AssetDatum></dl> : <AssetNotice>Select a posting date to identify the month. No eligible count or financial amount is forecast.</AssetNotice>}<p className="fa-muted">Posted amounts, resulting book values and skipped reasons are shown only from a verified response. Currency groups will remain separate.</p><button type="submit" className="aa-primary" disabled={vm.action.locked}>Review depreciation<CalendarDays aria-hidden="true"/></button><button type="button" className="aa-secondary" onClick={vm.cancel} disabled={vm.action.busy}>Cancel and return</button></aside></form><AssetConfirmation action={vm.action}/>
  </div>;
}

export function AssetDepreciationResult({ result,returnHref }: { result:DepreciationRun;returnHref:string }) {
  const currencies=Array.from(new Set(result.posted.map(row=>row.currency))).sort();
  return <section className="fa-results" aria-label="Verified depreciation result"><AssetSectionHeading title="Returned depreciation result">Actual rows from the verified response, not a forecast or a substitute for a later journal/account read.</AssetSectionHeading><dl className="fa-result-period"><AssetDatum label="Depreciation month">{result.period_date.slice(0,7)}</AssetDatum><AssetDatum label="Stored period identity">{result.period_date}</AssetDatum><AssetDatum label="Journal posting date">{result.posting_date}</AssetDatum></dl>
    {currencies.length ? currencies.map(currency=><section className="fa-panel" key={currency}><AssetSectionHeading title={`${currency} · Posted depreciation`}>Original currency amounts; not combined with other currencies.</AssetSectionHeading>{result.posted.filter(row=>row.currency===currency).map(row=><article className="fa-result-row" key={row.asset_id}><div className="fa-row-identity"><strong>{row.asset_code}</strong><small className="fa-mono">{row.asset_id}</small><a className="aa-back" href={assetDetailHref(row.asset_id,returnHref)}>View asset<ArrowRight aria-hidden="true"/></a></div><dl><AssetDatum label="Depreciation posted">{assetMoney(row.amount,currency)}</AssetDatum></dl><dl><AssetDatum label="Returned book value">{assetMoney(row.book_value,currency)}</AssetDatum></dl></article>)}</section>) : <AssetNotice>No depreciation rows were posted in this response. This is not evidence that a new run is required.</AssetNotice>}
    <section className="fa-panel"><AssetSectionHeading title={`Skipped assets · ${result.skipped.length}`}>Source identities and reasons returned by the server. Missing names and currencies are not guessed.</AssetSectionHeading>{result.skipped.length ? result.skipped.map((row,index)=><article className="fa-skipped-row" key={`${row.asset_id}-${index}`}><a className="aa-back" href={assetDetailHref(row.asset_id,returnHref)}>{row.asset_id}<ArrowRight aria-hidden="true"/></a><div><strong>{pretty(row.reason)}</strong><p className="fa-mono">Reason code: {row.reason}</p></div></article>) : <div className="fa-notes"><p>No skipped rows returned.</p></div>}</section>
  </section>;
}
