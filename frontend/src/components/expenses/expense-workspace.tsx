"use client";
import { useParams, usePathname, useSearchParams } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { RelationshipPage } from "@/components/relationships/relationship-ui";
import { safeExpenseReturn } from "@/lib/expense-navigation";
import { ExpenseState } from "./expense-ui";
import { ExpenseRegister } from "./expense-register";
import { ExpenseCreate } from "./expense-create";
import { ExpenseDocument, ExpenseReceiptCreate } from "./expense-document";
import { ExpenseSetupCreate } from "./expense-setup";
import "@/components/accounting-accounts/account-workspace.css";
import "./expense-workspace.css";

export function ExpenseWorkspace() {
  const { tenant, loading } = useDashboardSession(), pathname = usePathname();
  if (loading) return <RelationshipPage className="aa-workspace ex-workspace"><ExpenseState loading title="Loading expense workspace…"/></RelationshipPage>;
  return <RelationshipPage className="aa-workspace ex-workspace"><ExpenseContent key={`${tenant?.organization.id}:${tenant?.membership_id}:${tenant?.role_id}:${tenant?.permissions.join("|")}:${pathname}`}/></RelationshipPage>;
}
function ExpenseContent() {
  const pathname = usePathname(), params = useParams<{ expenseId?: string }>(), query = useSearchParams();
  const returnHref = safeExpenseReturn(query.get("returnTo"));
  if (pathname.endsWith("/vendors/new")) return <ExpenseSetupCreate kind="vendors" returnHref={returnHref}/>;
  if (pathname.endsWith("/categories/new")) return <ExpenseSetupCreate kind="categories" returnHref={returnHref}/>;
  if (params.expenseId && pathname.endsWith("/receipts/new")) return <ExpenseReceiptCreate expenseId={params.expenseId} returnHref={returnHref}/>;
  if (pathname.endsWith("/new")) return <ExpenseCreate returnHref={returnHref}/>;
  if (params.expenseId) return <ExpenseDocument expenseId={params.expenseId} returnHref={returnHref}/>;
  return <ExpenseRegister/>;
}
