"use client";
import { Suspense } from "react";
import { OperationalReportsWorkspace } from "@/components/operational-reports/report-workspace";
export default function ReportsPage() {
  return <Suspense fallback={<p className="p-6" role="status">Loading report workspace…</p>}><OperationalReportsWorkspace /></Suspense>;
}
