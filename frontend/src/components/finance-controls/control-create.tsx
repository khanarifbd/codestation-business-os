"use client";
import { SearchableSelect } from "@/components/searchable-select";
import { useControlCreate } from "@/hooks/use-control-create";
import { controlFrequencies, controlPaymentMethods } from "./control-types";
import { pretty } from "./control-model";
import { ControlActionStatus, ControlBack, ControlConfirmation, ControlField, ControlHeading, ControlNotice, ControlSectionHeading, ControlState } from "./control-ui";
export function ControlCreate({ kind, returnTo }: {
  kind: "recurring" | "periods";
  returnTo: string;
}) {
  const vm = useControlCreate(kind, returnTo), f = vm.form, meta = vm.meta.value, locked = vm.action.locked || !vm.canManage;
  const select = (key: "category_id" | "account_id" | "vendor_id" | "client_id" | "project_id", label: string, options: {
    value: string;
    label: string;
    description?: string;
  }[], required = false) => <div className="ad-field">

      <SearchableSelect
        label={label}
        name={key}
        value={f[key]}
        onValueChange={v => vm.change(key, v)}
        options={options}
        required={required}
        clearable={!required}
        disabled={locked} />

    </div>;
  return <div className="ct-workspace ct-editor">

    <ControlBack onClick={vm.cancel} disabled={vm.action.busy} context="New control" />

    <ControlHeading
      eyebrow="Controls / Create"
      title={kind === "recurring" ? "New recurring schedule" : "New accounting period"}
      description={kind === "recurring" ? "Define the recurrence first. Expense posting and Auto Post stay separate." : "Create an open date range, without closing any financial period."} />

    <ControlActionStatus action={vm.action}>

      <a className="aa-secondary" href={vm.backHref} target="_blank" rel="noopener noreferrer">Inspect saved controls</a>

    </ControlActionStatus>


    {!vm.canView ? <ControlState title="Finance read access required" /> : !vm.canManage ? <ControlState title="Finance management access required">You can browse saved controls, but cannot create one.</ControlState> : vm.action.phase !== "idle" && vm.action.phase !== "saving" ? null : kind === "recurring" && (vm.meta.loading || vm.accounts.loading) ? <ControlState title="Loading schedule options" loading /> : kind === "recurring" && (!meta || !vm.accounts.value) ? <ControlState
      title="Schedule options unavailable"
      action={<button
        type="button"
        className="aa-secondary"
        onClick={() => { void vm.meta.refresh(); void vm.accounts.refresh(); }}>Retry options</button>}>

      {vm.meta.error || vm.accounts.error || "Required account and relationship metadata could not be verified."}

    </ControlState> : <form onSubmit={e => { e.preventDefault(); vm.review(); }}>

      <fieldset disabled={locked}>


        {kind === "periods" ? <section className="ct-section">

          <ControlSectionHeading title="Period definition">Dates are inclusive. Existing overlapping periods are rejected by the server.</ControlSectionHeading>

          <div className="ct-form-grid">

            <ControlField label="Period name" wide>

              <input
                required
                maxLength={120}
                value={vm.period.name}
                onChange={e => vm.changePeriod("name", e.target.value)} />

            </ControlField>

            <ControlField label="Start date">

              <input
                required
                type="date"
                value={vm.period.start_date}
                onChange={e => vm.changePeriod("start_date", e.target.value)} />

            </ControlField>

            <ControlField label="End date">

              <input
                required
                type="date"
                value={vm.period.end_date}
                min={vm.period.start_date || undefined}
                onChange={e => vm.changePeriod("end_date", e.target.value)} />

            </ControlField>

          </div>

        </section> : <>


          <section className="ct-section">

            <ControlSectionHeading title="01 · Schedule identity">Give the recurring cost a clear name and posting description.</ControlSectionHeading>

            <div className="ct-form-grid">

              <ControlField label="Schedule name">

                <input required value={f.name} onChange={e => vm.change("name", e.target.value)} />

              </ControlField>

              <ControlField label="Expense description">

                <input required value={f.description} onChange={e => vm.change("description", e.target.value)} />

              </ControlField>

              {select("category_id", "Expense category", meta!.categories.filter(x => x.is_active).map(x => ({ value: x.id, label: x.name })), true)}

              {select("vendor_id", "Vendor (optional)", meta!.vendors.filter(x => x.is_active).map(x => ({ value: x.id, label: x.name })))}

            </div>

          </section>


          <section className="ct-section">

            <ControlSectionHeading title="02 · Amount & payment">Amounts keep their original currencies. No conversion is assumed.</ControlSectionHeading>

            <div className="ct-form-grid">

              <ControlField label="Expense currency">

                <input
                  required
                  maxLength={3}
                  value={f.expense_currency}
                  onChange={e => vm.change("expense_currency", e.target.value.toUpperCase())} />

              </ControlField>

              <ControlField label="Expense amount">

                <input
                  required
                  inputMode="decimal"
                  value={f.expense_amount}
                  onChange={e => vm.change("expense_amount", e.target.value)} />

              </ControlField>

              {select("account_id", "Payment account", vm.accounts.value!.filter(x => x.is_active).map(x => ({ value: x.id, label: `${x.name} · ${x.currency}`, description: pretty(x.account_type) })), true)}

              <ControlField label="Payment method">

                <select value={f.payment_method} onChange={e => vm.change("payment_method", e.target.value)}>

                  {controlPaymentMethods.map(p => <option key={p} value={p}>

                    {pretty(p)}

                  </option>)}

                </select>

              </ControlField>

              <ControlField label="Tax amount" hint="Stored as configured; not a new jurisdictional tax calculation.">

                <input inputMode="decimal" value={f.tax_amount} onChange={e => vm.change("tax_amount", e.target.value)} />

              </ControlField>

              <ControlField label="Reference (optional)">

                <input value={f.reference} onChange={e => vm.change("reference", e.target.value)} />

              </ControlField>

            </div>

          </section>


          <section className="ct-section">

            <ControlSectionHeading title="03 · Recurrence">The first saved due date starts the schedule. Creation does not post an expense.</ControlSectionHeading>

            <div className="ct-form-grid">

              <ControlField label="Frequency">

                <select value={f.frequency} onChange={e => vm.change("frequency", e.target.value)}>

                  {controlFrequencies.map(p => <option key={p} value={p}>

                    {pretty(p)}

                  </option>)}

                </select>

              </ControlField>

              <ControlField label="Interval count">

                <input
                  type="number"
                  min={1}
                  max={120}
                  required
                  value={f.interval_count}
                  onChange={e => vm.change("interval_count", e.target.value)} />

              </ControlField>

              <ControlField label="First due date">

                <input
                  type="date"
                  required
                  value={f.next_due_date}
                  onChange={e => vm.change("next_due_date", e.target.value)} />

              </ControlField>

              <ControlField label="End date (optional)">

                <input
                  type="date"
                  min={f.next_due_date || undefined}
                  value={f.end_date}
                  onChange={e => vm.change("end_date", e.target.value)} />

              </ControlField>

            </div>

          </section>


          <section className="ct-section">

            <ControlSectionHeading title="04 · Relationship & notes">Available choices contain up to 500 active clients and 500 recent projects; absence does not prove a relationship is invalid.</ControlSectionHeading>

            <div className="ct-form-grid">

              {select("client_id", "Client (optional)", meta!.clients.map(x => ({ value: x.id, label: x.name, description: x.currency || "Currency unavailable" })))}

              {select("project_id", "Project (optional)", meta!.projects.filter(x => !f.client_id || x.client_id === f.client_id).map(x => ({ value: x.id, label: `${x.number} · ${x.name}`, description: x.currency })))}

              <ControlField label="Notes (optional)" wide>

                <textarea value={f.notes} onChange={e => vm.change("notes", e.target.value)} />

              </ControlField>

            </div>

          </section>

        </>}


      </fieldset>

      {vm.error ? <ControlNotice tone="error">

        {vm.error}

      </ControlNotice> : null}

      <div className="ct-form-actions">

        <button type="button" className="aa-secondary" disabled={vm.action.busy} onClick={vm.cancel}>Cancel</button>

        <button className="aa-primary" disabled={locked}>Review {kind === "recurring" ? "manual schedule" : "open period"}</button>

      </div>

    </form>}

    <ControlConfirmation action={vm.action} />

  </div>;
}
