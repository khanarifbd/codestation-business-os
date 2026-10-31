"use client";
import { useId, useState, type ReactNode } from "react";
import { useDashboardSeries, type DashboardSeriesReadProps } from "@/hooks/use-dashboard-series";
import { DashboardSeriesLineChart } from "./dashboard-series-line-chart";
import { dashboardSeriesStyle } from "@/lib/dashboard-series-palette";
import "./dashboard-trend-explorer.css";
const choices = ["Income","Expenses","Projects","Orders","Clients"] as const;
type Choice = typeof choices[number];
export type DashboardTrendExplorerProps = DashboardSeriesReadProps & { reportingCurrency: string; filters?: ReactNode };
export function DashboardTrendExplorer(props: DashboardTrendExplorerProps) {
 const id=useId(), read=useDashboardSeries(props);
 const [selected,setSelected]=useState<Choice[]>(["Income","Expenses"]);
 const data=read.data;
 const periods=data?.counts.map(point=>({key:point.period_start,label:point.period_start===point.period_end?point.period_start:`${point.period_start} – ${point.period_end}`,axisLabel:data.bucket==="month"?point.period_start.slice(0,7):point.period_start.slice(5)}))??[];
 const moneySelected=selected.some(key=>key==="Income"||key==="Expenses");
 const countSelected=choices.filter((key):key is "Projects"|"Orders"|"Clients"=>key!=="Income"&&key!=="Expenses"&&selected.includes(key));
 const sortedMoney=data?[...data.money].sort((a,b)=>a.currency===props.reportingCurrency?-1:b.currency===props.reportingCurrency?1:a.currency.localeCompare(b.currency)):[];
 const charts: ReactNode[] = data ? [
  ...(moneySelected&&data.effective_date_to!==null?sortedMoney.map(currency=><DashboardSeriesLineChart key={currency.currency} title={`Income and expenses · ${currency.currency}`} description="Received income and recorded expenses; not cash profit." periods={periods} unit={{kind:"money",currency:currency.currency}} series={[
     ...(selected.includes("Income")?[{key:"income",label:"Income received",values:currency.points.map(point=>point.income)}]:[]),
     ...(selected.includes("Expenses")?[{key:"expenses",label:"Expenses recorded",values:currency.points.map(point=>point.expenses)}]:[]),
    ]}/>):[]),
  countSelected.length>0&&data.effective_date_to!==null?<DashboardSeriesLineChart key="created-records" title="Records created over time" description="Counts of newly created records, not active totals or monetary values." periods={periods} unit={{kind:"count"}} series={countSelected.map(key=>({key:key.toLowerCase(),label:key,values:data.counts.map(point=>String(point[key.toLowerCase() as "projects"|"orders"|"clients"]))}))}/>:null,
 ].filter(Boolean) : [];
 return <section className="dashboard-series-explorer" aria-labelledby={`${id}-heading`}>
  <header className="dashboard-series-explorer-heading"><div><h2 id={`${id}-heading`}>Business trends</h2><p>Explore actual activity over time · {props.timezone}</p></div></header>
  {!props.enabled||read.loading?<p role="status" className="dashboard-series-explorer-status">Loading trend history…</p>:read.error?<div className="dashboard-series-explorer-status"><p role="alert">{read.error}</p>{!read.restricted?<button type="button" onClick={()=>void read.retry()}>Retry trends</button>:null}</div>:data?<>
   {selected.length===0?<p className="dashboard-series-explorer-status">Select at least one series to view its history.</p>:null}
   {data.effective_date_to&&data.effective_date_to<data.date_to?<p className="dashboard-series-range-note">Actual history through {data.effective_date_to}. Future periods are not projected.</p>:null}
   {data.effective_date_to===null?<p className="dashboard-series-explorer-status">No elapsed periods are available in this date range. Future activity is not projected or represented as zero.</p>:null}
   <div className="dashboard-series-charts">{charts}</div>
   {moneySelected&&data.effective_date_to!==null&&sortedMoney.length===0?<p className="dashboard-series-explorer-status">No recorded monetary activity is available for this date range. No income or expense trend is inferred.</p>:null}
  </>:null}
  <div className="dashboard-series-controls">
  <fieldset className="dashboard-series-options"><legend>Choose trend series</legend>{choices.map(choice=><label key={choice} data-series={choice.toLowerCase()} style={{color:dashboardSeriesStyle(choice.toLowerCase()).color, borderColor:selected.includes(choice)?dashboardSeriesStyle(choice.toLowerCase()).color:undefined}}><input type="checkbox" checked={selected.includes(choice)} onChange={()=>setSelected(previous=>previous.includes(choice)?previous.filter(key=>key!==choice):choices.filter(key=>key===choice||previous.includes(key)))} /><span>{choice}</span></label>)}</fieldset>
  {props.filters ? <div className="dashboard-series-filter-slot">{props.filters}</div> : null}
  </div>

  <p className="dashboard-series-basis">Income received and expenses recorded use their original currency. Recorded expenses include approved payroll, which may not yet be paid. This is not a cash-profit comparison. Projects, orders and clients count records created in the company timezone.</p>
  <details className="dashboard-series-definitions"><summary>How these trends are calculated</summary><ul><li>Income: confirmed invoice collections and non-reversed direct income.</li><li>Expenses: posted expenses, non-reversed direct expenses and approved or paid gross payroll, dated by payroll period end.</li><li>Transfers are excluded. Different currencies are never combined, and recorded expenses are not a measure of cash paid.</li><li>Record counts include surviving projects, orders and clients by creation date. Deleted-record history is not reconstructed.</li></ul></details>
 </section>;
}
