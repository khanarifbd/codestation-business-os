"use client";
import { Suspense } from "react";
import { useParams } from "next/navigation";
import { usePortalScope } from "@/hooks/use-client-portal-resource";
import type { PortalKind } from "./portal-types";
import { PortalHome } from "./portal-home";
import { PortalRegister } from "./portal-register";
import { PortalInvoiceDocument, PortalOrderDocument, PortalProjectDocument, PortalQuotationDocument } from "./portal-documents";
import { PortalInvoicePrint } from "./portal-print";
import { PortalQuotationDecision } from "./portal-decision";
import { PortalState } from "./portal-ui";
import "@/components/accounting-accounts/account-workspace.css";
import "./portal.css";
const paramsByKind = { projects: "projectId", orders: "orderId", quotations: "quotationId", invoices: "invoiceId" } as const;
type Props = { kind?: PortalKind; mode?: "register" | "document" | "decision" | "print" };
function PortalRoute({ kind, mode = "register" }: Props) {
  const scope = usePortalScope(), params = useParams<Record<string, string | string[]>>();
  const rawId = kind ? params[paramsByKind[kind]] : "", id = typeof rawId === "string" ? rawId : "";
  const identity = `${scope.key}:${kind || "home"}:${mode}:${id}`;
  if (scope.loading) return <PortalState title="Checking workspace identity" loading />;
  if (!scope.ready) return <PortalState title="No active company workspace">Select an existing company workspace before opening client records.</PortalState>;
  if (!kind) return <PortalHome key={identity} />;
  if (mode === "register") return <PortalRegister key={identity} kind={kind} />;
  if (mode === "decision" && kind === "quotations") return <PortalQuotationDecision key={identity} id={id} />;
  if (mode === "print" && kind === "invoices") return <PortalInvoicePrint key={identity} id={id} />;
  if (kind === "projects") return <PortalProjectDocument key={identity} id={id} />;
  if (kind === "orders") return <PortalOrderDocument key={identity} id={id} />;
  if (kind === "quotations") return <PortalQuotationDocument key={identity} id={id} />;
  return <PortalInvoiceDocument key={identity} id={id} />;
}
export function ClientPortalWorkspace(props: Props) {
  return <Suspense fallback={<PortalState title="Loading client portal" loading />}><PortalRoute {...props} /></Suspense>;
}
