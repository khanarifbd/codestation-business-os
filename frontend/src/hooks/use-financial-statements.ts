"use client";
import { useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAdvancedPermissions, useAdvancedResource } from "./use-advanced-resource";
import { isFinancialStatements, statementMatchesPeriod, type FinancialStatements } from "@/components/accounting-statements/statement-model";
import { statementPeriod, statementsApi, statementsHref, statementAccountHref, type StatementSection } from "@/lib/statement-navigation";
export function useFinancialStatements() {
  const { canView } = useAdvancedPermissions(), router = useRouter(), query = useSearchParams();
  const period = statementPeriod(query.toString());
  const validate = useCallback((value: unknown): value is FinancialStatements => isFinancialStatements(value)
    && statementMatchesPeriod(value, period.from, period.to), [period.from, period.to]);
  const resource = useAdvancedResource(statementsApi(period), canView && !period.invalid, validate);
  function apply(from: string, to: string) {
    const next = statementPeriod(new URLSearchParams({ date_from: from, date_to: to, section: period.section }));
    if (next.invalid) return false;
    router.push(statementsHref(next), { scroll: false });
    return true;
  }
  return { canView, period, resource, apply, selectSection: (section: StatementSection) => router.push(statementsHref({ ...period, section }), { scroll: false }),
    accountHref: statementAccountHref({ returnTo: statementsHref(period) }) };
}
