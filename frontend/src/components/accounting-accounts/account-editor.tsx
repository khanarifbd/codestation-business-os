import Link from "next/link";
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { SearchableSelect } from "@/components/searchable-select";
import { CURRENCY_OPTIONS } from "@/lib/company-options";
import { type AccountingAccountsState } from "@/hooks/use-accounting-accounts";
import { RelationshipNotice } from "@/components/relationships/relationship-ui";
import { ACCOUNT_TYPES, accountLabel, accountMoney } from "./account-model";
import { AccountHeading } from "./account-ui";
export function AccountEditor({ vm }: {
    vm: AccountingAccountsState;
}) {
    const edit = vm.mode === "edit", v = vm.values;
    return <>
    <AccountHeading eyebrow="Finance / Account settings" title={edit ? `Edit ${vm.account!.name}` : "Add a financial account"} description={edit ? "Update account identity and payment defaults without changing ledger history." : "Record an existing financial account and its opening position."}/>
    {vm.gatewayError ? <RelationshipNotice tone="error">{vm.gatewayError} {edit ? "Existing links are retained; retry loading before changing a link." : "A manual account does not require a connection."} {vm.canView ? <button className="aa-text-button" disabled={vm.loading} onClick={() => void vm.load()}>Retry connections</button> : null}</RelationshipNotice> : null}
    {edit ? <div className="aa-immutable"><span>{accountLabel(vm.account!.account_type)}</span><strong>{vm.account!.currency}</strong><span>Opening {accountMoney(vm.account!.opening_balance, vm.account!.currency)}</span><p>Type, currency and opening balance cannot be edited here.</p></div> : null}
    {vm.uncertain ? <RelationshipNotice tone="error">Creation is not confirmed. This draft is frozen to prevent another opening-balance entry. {vm.canView ? <a href="/dashboard/accounting/accounts" target="_blank" rel="noopener noreferrer">Review Accounts in a separate tab</a> : "Ask a colleague with finance viewing permission to review Accounts."} A missing or similarly named account is not proof of this request’s outcome. Reloading or leaving loses this document-only protection. <button type="button" className="aa-text-button" onClick={vm.back}>Leave after review</button></RelationshipNotice> : null}
    <form className="aa-editor" onSubmit={event => {
        event.preventDefault();
        void vm.save();
    }}><fieldset disabled={vm.saving || vm.committed || vm.uncertain}>
      <EditorSection number="01" title="Account identity" description="Use a name your team recognizes.">
        {!edit ? <Field label="Account type"><select value={v.account_type} onChange={event => vm.change("account_type", event.target.value)}>{ACCOUNT_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select><small>{ACCOUNT_TYPES.find(type => type.value === v.account_type)?.help}</small></Field> : null}
        <Field label="Account name"><input required maxLength={edit ? 180 : undefined} value={v.name} onChange={event => vm.change("name", event.target.value)} placeholder="Business bank account"/></Field>
        {!edit ? <SearchableSelect label="Currency" value={v.currency} onValueChange={value => vm.change("currency", value)} options={CURRENCY_OPTIONS} placeholder="Select currency" searchPlaceholder="Search currency…" required clearable={false}/> : null}
      </EditorSection>
      <EditorSection number="02" title="Provider & ownership" description="Identifiers help your team recognize the account. Never enter passwords, PINs or private keys.">
        <Field label="Bank / provider name"><input maxLength={edit ? 120 : undefined} value={v.provider_name} onChange={event => vm.change("provider_name", event.target.value)}/></Field><Field label="Account holder"><input maxLength={edit ? 180 : undefined} value={v.account_holder_name} onChange={event => vm.change("account_holder_name", event.target.value)}/></Field><Field label="Account / reference number"><input maxLength={edit ? 180 : undefined} value={v.account_reference} onChange={event => vm.change("account_reference", event.target.value)}/></Field>
        {v.account_type === "payment_gateway" ? <div className="aa-field-wide"><Field label="Connected payment gateway"><select value={v.gateway_connection_id} disabled={Boolean(vm.gatewayError)} onChange={event => vm.change("gateway_connection_id", event.target.value)}><option value="">No connected gateway (manual account)</option>{vm.gateways.map(gateway => <option key={gateway.id} value={gateway.id!}>Stripe {gateway.mode === "test" ? "Sandbox" : "Live"} · {gateway.account_label || gateway.stripe_account_id}</option>)}{v.gateway_connection_id && !vm.gateways.some(gateway => gateway.id === v.gateway_connection_id) ? <option value={v.gateway_connection_id}>Previously linked connection (unavailable or inactive)</option> : null}</select></Field>{v.gateway_connection_id && vm.gateways.find(gateway => gateway.id === v.gateway_connection_id)?.mode === "test" && v.currency !== "USD" ? <p className="aa-warning">Stripe Sandbox currently supports USD accounts only.</p> : null}<p className="aa-field-hint">Linking does not import balances or move money. <Link href="/dashboard/company?tab=payments">Manage Payment Gateways</Link>.</p></div> : null}
      </EditorSection>
      <EditorSection number="03" title={edit ? "Internal account settings" : "Opening position"} description={edit ? "Inactive accounts remain in the directory and keep their ledger history." : "The balance already held when Business OS begins tracking this account. An opening balance creates an accounting entry."}>
        {!edit ? <Field label={v.account_type === "credit_card" ? "Amount currently owed" : "Opening balance"}><div className="aa-money-field"><span>{v.currency}</span><input type="number" inputMode="decimal" min={v.account_type === "credit_card" ? "0" : undefined} step="0.01" value={v.opening_balance} onChange={event => vm.change("opening_balance", event.target.value)}/></div><small>{v.account_type === "credit_card" ? "Enter the existing card liability, not available credit." : "Use the existing balance before tracked transactions."}</small></Field> : <label className="aa-checkbox"><input type="checkbox" checked={v.is_active} onChange={event => vm.change("is_active", event.target.checked)}/>Account active</label>}
        <Field label="Internal notes"><input value={v.notes} onChange={event => vm.change("notes", event.target.value)}/></Field>
      </EditorSection>
      <EditorSection number="04" title="Client payment defaults" description="Optional invoice payment instructions. These do not alter the account balance.">
        <Field label="Default payment URL"><input type="url" maxLength={edit ? 1000 : undefined} value={v.payment_url} onChange={event => vm.change("payment_url", event.target.value)} placeholder="https://pay.example.com/…"/></Field><Field label="Client payment instructions"><textarea maxLength={edit ? 5000 : undefined} rows={3} value={v.payment_instructions} onChange={event => vm.change("payment_instructions", event.target.value)}/></Field>
      </EditorSection>
      <footer className="aa-editor-footer"><p>If a save is interrupted, check Accounts before retrying. The change may already have been recorded.</p><div><button type="button" className="aa-secondary" onClick={vm.back}>Cancel</button><button type="submit" className="aa-primary" disabled={!vm.canSubmit || vm.saving}>{vm.saving ? <Loader2 aria-hidden="true" className="animate-spin"/> : null}{vm.saving ? "Saving…" : edit ? "Save account" : "Create account"}</button></div></footer>
    </fieldset></form>
  </>;
}
function Field({ label, children }: {
    label: string;
    children: ReactNode;
}) {
    return <label className="aa-field"><span>{label}</span>{children}</label>;
}
function EditorSection({ number, title, description, children }: {
    number: string;
    title: string;
    description: string;
    children: ReactNode;
}) {
    return <section className="aa-editor-section"><div className="aa-editor-section-heading"><span>{number}</span><div><h2>{title}</h2><p>{description}</p></div></div><div className="aa-editor-fields">{children}</div></section>;
}
