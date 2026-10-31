"use client";

import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { formatMoneyExact } from "@/lib/sales-money-preview";
import { dashboardSeriesGeometry, exactChartCount, keyboardChartPeriod, nearestChartPeriod, type DashboardChartPeriod, type DashboardChartSeries, type DashboardChartUnit } from "@/lib/dashboard-series-geometry";
import { dashboardSeriesStyle } from "@/lib/dashboard-series-palette";
import "./dashboard-series-line-chart.css";

export type DashboardSeriesLineChartProps = {
  title: string;
  description?: string;
  periods: DashboardChartPeriod[];
  series: DashboardChartSeries[];
  unit: DashboardChartUnit;
};
function ChartMarker({ x, y, size, metric, title }: { x:number; y:number; size:number; metric:string; title?:string }) {
  const marker=dashboardSeriesStyle(metric).marker;
  const content=title?<title>{title}</title>:null;
  if(marker==="square")return <rect x={x-size} y={y-size} width={size*2} height={size*2}>{content}</rect>;
  if(marker==="diamond")return <polygon points={`${x},${y-size*1.3} ${x+size*1.3},${y} ${x},${y+size*1.3} ${x-size*1.3},${y}`}>{content}</polygon>;
  if(marker==="triangle")return <polygon points={`${x},${y-size*1.4} ${x+size*1.3},${y+size} ${x-size*1.3},${y+size}`}>{content}</polygon>;
  return <circle cx={x} cy={y} r={size}>{content}</circle>;
}

/** A presentation-only chart: callers own validated history, units and selection. */
export function DashboardSeriesLineChart({ title, description, periods, series, unit }: DashboardSeriesLineChartProps) {
  const id = useId();
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  let geometry: ReturnType<typeof dashboardSeriesGeometry>;
  try { geometry = dashboardSeriesGeometry(periods, series, unit); }
  catch { return <section className="dashboard-series-chart" aria-label={title}><p role="alert">Chart data is unavailable. Refresh the dashboard to try again.</p></section>; }
  if (!periods.length || !series.length) return <section className="dashboard-series-chart" aria-label={title}><h3>{title}</h3><p className="dashboard-series-note">{!series.length ? "Select a series to view its history." : "No periods are available for this date range."}</p></section>;
  const selectedIndex = periods.findIndex(period => period.key === selectedPeriod);
  const activeIndex = selectedIndex < 0 ? periods.length - 1 : selectedIndex;
  const active = periods[activeIndex];
  const formatValue = (value: string) => unit.kind === "count" ? exactChartCount(value) : formatMoneyExact(value, unit.currency);
  const selectPointer = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const index = nearestChartPeriod(event.clientX, bounds.left, bounds.width, periods.length);
    if (index != null) setSelectedPeriod(periods[index].key);
  };
  const inspectKeyboard = (event: KeyboardEvent<SVGSVGElement>) => {
    const index=keyboardChartPeriod(event.key,activeIndex,periods.length);
    if(index!==null){event.preventDefault();setSelectedPeriod(periods[index].key);}
  };
  const ticks = periods.map((_, index) => index).filter(index => index === 0 || index === periods.length - 1 || index % Math.ceil(periods.length / 2) === 0);
  return <section className="dashboard-series-chart" aria-labelledby={`${id}-title`}>
    <header className="dashboard-series-heading"><div><h3 id={`${id}-title`}>{title}</h3>{description ? <p>{description}</p> : null}</div><span className="dashboard-series-unit">{unit.kind === "count" ? "Records created" : unit.currency}</span></header>
    <ul className="dashboard-series-legend" aria-label={`${title} series`}>
      {series.map(row => <li key={row.key} data-series={row.key} style={{color:dashboardSeriesStyle(row.key).color}}><svg width="29" height="12" aria-hidden="true"><line x1="0" x2="29" y1="6" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray={dashboardSeriesStyle(row.key).dash} /><g className="dashboard-series-marker"><ChartMarker x={14} y={6} size={3} metric={row.key}/></g></svg><span>{row.label}</span></li>)}
    </ul>
    <p className="dashboard-series-scale">{unit.kind === "count" ? "Count scale" : `${unit.currency} scale`}: {formatValue(geometry.min)} — {formatValue(geometry.max)}</p>
    <figure className="dashboard-series-figure">
      <svg className="dashboard-series-svg" viewBox="0 0 640 228" role="img" tabIndex={0} aria-keyshortcuts="ArrowLeft ArrowRight Home End" aria-labelledby={`${id}-title`} aria-describedby={`${id}-caption`} onKeyDown={inspectKeyboard} onPointerMove={selectPointer} onPointerDown={selectPointer}>
        {[0, 1, 2, 3, 4].map(tick => <line key={tick} className="dashboard-series-gridline" x1={geometry.left} x2={geometry.right} y1={geometry.top + tick / 4 * (geometry.bottom - geometry.top)} y2={geometry.top + tick / 4 * (geometry.bottom - geometry.top)} />)}
        <line className="dashboard-series-cursor" x1={geometry.points[0][activeIndex].x} x2={geometry.points[0][activeIndex].x} y1={geometry.top} y2={geometry.bottom} />
        {series.map((row, index) => <g key={row.key} className="dashboard-series-line" data-series={row.key} style={{color:dashboardSeriesStyle(row.key).color}}>
          {periods.length > 1 ? <polyline points={geometry.points[index].map(point => `${point.x},${point.y}`).join(" ")} fill="none" strokeWidth="2" strokeDasharray={dashboardSeriesStyle(row.key).dash} vectorEffect="non-scaling-stroke" /> : null}
          <g className="dashboard-series-marker">{geometry.points[index].map((point, pointIndex) => <ChartMarker key={periods[pointIndex].key} x={point.x} y={point.y} size={pointIndex === activeIndex ? 4 : 2.3} metric={row.key} title={`${periods[pointIndex].label} · ${row.label}: ${formatValue(row.values[pointIndex])}`} />)}</g>
        </g>)}
        {ticks.map(index => <text key={periods[index].key} x={geometry.points[0][index].x} y="216" textAnchor={index === 0 ? "start" : index === periods.length - 1 ? "end" : "middle"}>{periods[index].axisLabel ?? periods[index].label}</text>)}
      </svg>
      <figcaption id={`${id}-caption`}>{periods.length === 1 ? "One recorded period; a point is shown, not an inferred trend. " : "Straight lines connect actual period values. "}{geometry.allZero ? "All selected values are zero. " : ""}{unit.kind === "count" ? "Counts are not monetary values." : `Only ${unit.currency} amounts share this scale.`} Hover or touch the chart for exact values. With the chart focused, use Left/Right to inspect points and Home/End for the first/last point. Point inspection does not change the date range; use the date-range popup below.</figcaption>
    </figure>
    <div className="dashboard-series-inspector">
      <dl className="dashboard-series-values" aria-live="polite" aria-atomic="true"><div className="dashboard-series-current-period"><dt>Period</dt><dd>{active.label}</dd></div>{series.map(row => <div key={row.key}><dt>{row.label}</dt><dd>{formatValue(row.values[activeIndex])}</dd></div>)}</dl>
    </div>
    <details className="dashboard-series-exact"><summary>View exact period values</summary><div className="dashboard-series-table-scroll" tabIndex={0} role="region" aria-label={`${title} exact values; scroll horizontally`}><table><caption>{title} · {unit.kind === "count" ? "counts" : unit.currency}</caption><thead><tr><th scope="col">Period</th>{series.map(row => <th scope="col" key={row.key}>{row.label}</th>)}</tr></thead><tbody>{periods.map((period, index) => <tr key={period.key}><th scope="row">{period.label}</th>{series.map(row => <td key={row.key}>{formatValue(row.values[index])}</td>)}</tr>)}</tbody></table></div></details>
  </section>;
}
