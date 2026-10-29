"use client";
import {useState} from "react";
import {ChevronDown} from "lucide-react";
import {payrollRecord,payrollMoney,type PayrollAdjustment} from "./payroll-model";
import {PayrollFacts} from "./payroll-ui";
const display=(value:unknown)=>typeof value==="string"||typeof value==="number"?String(value):"—";
const moneyFields=["base_salary","allowance_total","deduction_total","tax_amount","gross_pay","net_pay"];
const recordedRows=(value:unknown)=>Array.isArray(value)?value.filter(payrollRecord):[];
function ExactFraction({value,label="Exact fraction"}:{value:unknown;label?:string}) {
    return payrollRecord(value)?<p className="pr-small">{label}: {display(value.numerator)} / {display(value.denominator)}</p>:null;
}
function RecordedAmounts({value,currency}:{value:Record<string,unknown>;currency:string}) {
    return <PayrollFacts items={moneyFields.map(key=>[key.replaceAll("_"," "),payrollMoney(display(value[key]),currency)])}/>;
}
function RecordedComponents({title,rows,currency,shown}:{title:string;rows:Record<string,unknown>[];currency:string;shown:number}) {
    return <div className="pr-component-read"><h3>{title}</h3>{rows.length?<dl>{rows.slice(0,shown).map((row,index)=><div key={index}><dt>{display(row.name)}{row.source_profile_id!==undefined?<small>Profile {display(row.source_profile_id)} · source component {display(row.source_component_index)}</small>:null}</dt><dd>{payrollMoney(display(row.amount),currency)}</dd></div>)}</dl>:<p className="pr-muted">No recorded {title.toLowerCase()}.</p>}{rows.length>shown?<p className="pr-small">Showing {shown} of {rows.length} {title.toLowerCase()}.</p>:null}</div>;
}
export function PayrollBreakdown({snapshot,currency}:{snapshot:Record<string,unknown>|null|undefined;currency:string}) {
    const [expanded,setExpanded]=useState(false),[shown,setShown]=useState(25),[shownComponents,setShownComponents]=useState(25),[shownCalculations,setShownCalculations]=useState(25);
    if(!snapshot)return <div className="pr-inline-note"><strong>Legacy calculation</strong><p>No versioned calculation breakdown was stored for this historical entry. Current saved amounts are not reconstructed.</p></div>;
    const slices=recordedRows(snapshot.slices),policy=payrollRecord(snapshot.policy)?snapshot.policy:null,config=policy&&payrollRecord(policy.config)?policy.config:null;
    const totals=payrollRecord(snapshot.totals)?snapshot.totals:null,allowances=recordedRows(snapshot.allowances),deductions=recordedRows(snapshot.deductions),calculations=recordedRows(snapshot.component_calculations);
    return <details className="pr-disclosure" onToggle={event=>setExpanded(event.currentTarget.open)}>
        <summary>Initial calculation breakdown<ChevronDown aria-hidden="true"/></summary>
        {expanded?<div className="pr-disclosure-body">
            <p className="pr-small">This immutable initial calculation is separate from later adjustments and current saved amounts.</p>
            {totals?<section className="pr-initial-totals"><h3>Initial rounded amounts</h3><RecordedAmounts value={totals} currency={currency}/></section>:<p className="pr-inline-note">Initial rounded totals are not present in this stored breakdown. Current amounts are not substituted.</p>}
            <PayrollFacts items={[["Method",display(snapshot.method)],["Policy version",policy?display(policy.version):"See saved run context"],["Organization timezone",display(snapshot.timezone)],["Allowance treatment",display(snapshot.allowance_treatment??config?.allowance_treatment)],["Deduction treatment",display(snapshot.deduction_treatment??config?.deduction_treatment)]]}/>
            {snapshot.automatic_proration===false||snapshot.method==="manual_latest_overlapping_profile"?<p className="pr-inline-note">Manual full-profile calculation. No automatic day proration was applied.</p>:null}
            {Array.isArray(snapshot.allowances)||Array.isArray(snapshot.deductions)?<section><h3>Initial component amounts</h3><div className="pr-before-after"><RecordedComponents title="Allowances" rows={allowances} currency={currency} shown={shownComponents}/><RecordedComponents title="Deductions" rows={deductions} currency={currency} shown={shownComponents}/></div>{Math.max(allowances.length,deductions.length)>shownComponents?<button className="pr-secondary" type="button" onClick={()=>setShownComponents(n=>n+25)}>Show next 25 initial components</button>:null}</section>:null}
            {snapshot.unrounded_base_total!==undefined?<section><h3>Initial unrounded base total</h3><p>{display(snapshot.unrounded_base_total)}</p><p className="pr-small">{snapshot.unrounded_base_total_is_approximation?"Approximate decimal; exact fraction retained":"Exact finite decimal"}. The initial rounded base above is the stored monetary amount.</p><ExactFraction value={snapshot.unrounded_base_total_fraction}/></section>:null}
            {slices.length?<>
                <div className="pr-slice-list">{slices.slice(0,shown).map((slice,index)=><article key={index}><h3>Slice {index+1} · {display(slice.profile_id)}</h3><PayrollFacts items={[["Eligible dates",`${display(slice.eligible_start)} — ${display(slice.eligible_end)}`],["Full reference cycle",`${display(slice.cycle_start)} — ${display(slice.cycle_end)}`],["Eligible / reference units",`${display(slice.numerator)} / ${display(slice.denominator)}`],["Cycle base",payrollMoney(display(slice.cycle_base_salary),currency)],["Unrounded display",display(slice.unrounded_base)],["Display precision",slice.unrounded_base_is_approximation?"Approximate decimal; exact fraction retained":"Exact finite decimal"]]}/><ExactFraction value={slice.unrounded_base_fraction}/></article>)}</div>
                <p className="pr-small">Showing {Math.min(shown,slices.length)} of {slices.length} recorded slices. These are server inputs/results, not a browser recalculation.</p>
                {shown<slices.length?<button className="pr-secondary" type="button" onClick={()=>setShown(n=>n+25)}>Show next 25 slices</button>:null}
            </>:null}
            {calculations.length?<section><h3>Recorded component calculation</h3><div className="pr-slice-list">{calculations.slice(0,shownCalculations).map((row,index)=><article key={index}><h3>{display(row.name)}</h3><PayrollFacts items={[["Category",display(row.category)],["Source profile",display(row.source_profile_id)],["Source component index",display(row.source_component_index)],["Treatment",display(row.treatment)],["Unrounded display",display(row.unrounded_amount_display)],["Display precision",row.display_is_approximation?"Approximate decimal; exact fraction retained":"Exact finite decimal"],["Initial rounded amount",payrollMoney(display(row.rounded_amount),currency)]]}/><ExactFraction value={row.unrounded_amount_fraction}/></article>)}</div><p className="pr-small">Showing {Math.min(shownCalculations,calculations.length)} of {calculations.length} recorded component calculations. Duplicate names are distinct source rows.</p>{shownCalculations<calculations.length?<button className="pr-secondary" type="button" onClick={()=>setShownCalculations(n=>n+25)}>Show next 25 component calculations</button>:null}</section>:null}
            {Array.isArray(snapshot.holiday_dates)?<div className="pr-inline-note"><strong>Recorded holiday dates</strong><p>{snapshot.holiday_dates.length?snapshot.holiday_dates.map(display).join(" · "):"None in the recorded reference horizon"}</p></div>:null}
            <p className="pr-small">Rounded stored amounts use the server’s recorded HALF_UP rules. Exact fractions are retained where the explanatory decimal repeats.</p>
        </div>:null}
    </details>;
}
export function PayrollAdjustmentHistory({adjustments,currency}:{adjustments:PayrollAdjustment[];currency:string}) {
    return <section className="pr-adjustment-history"><h2>Adjustment history</h2>{adjustments.length?adjustments.map((row,index)=><details className="pr-disclosure" key={row.id??index}><summary><span>{row.reason}<small>{row.created_at}</small></span><ChevronDown aria-hidden="true"/></summary><div className="pr-disclosure-body">{row.created_by_user_id?<p className="pr-small">Recorded by user {row.created_by_user_id}</p>:null}<div className="pr-before-after">{([["Before",row.before],["After",row.after]] as const).map(([label,values])=><div key={label}><h3>{label}</h3><RecordedAmounts value={values} currency={currency}/></div>)}</div></div></details>):<p className="pr-muted">No monetary adjustment has been recorded for this entry.</p>}</section>;
}
