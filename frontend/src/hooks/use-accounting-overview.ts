"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useDashboardSession } from "@/components/dashboard-session-context";
import { accountRequest, AccountRequestError } from "./use-accounting-accounts";
import { isAccountList, isAccountingSummary, isAccountingLoans, isAccountingPayables, type FinancialAccount, type AccountingSummary, type AccountingLoan, type AccountingPayable } from "@/components/accounting-accounts/account-model";
type Data = {
    accounts: FinancialAccount[] | null;
    summary: AccountingSummary | null;
    loans: AccountingLoan[] | null;
    payables: AccountingPayable[] | null;
};
export function useAccountingOverview() {
    const { tenant } = useDashboardSession(), router = useRouter();
    const canView = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.view")), canManage = Boolean(tenant?.permissions.some(value => value === "*" || value === "finance.manage"));
    const [data, setData] = useState<Data>({
        accounts: null, summary: null, loans: null, payables: null
    }), [errors, setErrors] = useState<Partial<Record<keyof Data, string>>>({}), [loading, setLoading] = useState(true);
    const mounted = useRef(true), epoch = useRef(0);
    const load = useCallback(async () => {
        if (!canView)
            return;
        const current = ++epoch.current;
        setLoading(true);
        setErrors({});
        setData({
            accounts: null, summary: null, loans: null, payables: null
        });
        const definitions = [["accounts", "/api/finance/accounts", isAccountList], ["summary", "/api/finance/summary", isAccountingSummary], ["loans", "/api/accounting/loans", isAccountingLoans], ["payables", "/api/accounting/payables", isAccountingPayables]] as const;
        await Promise.all(definitions.map(async ([key, path, valid]) => {
            try {
                const result = await accountRequest(path);
                if (!mounted.current || current !== epoch.current)
                    return;
                if (!valid(result))
                    throw new Error("The financial response could not be verified.");
                setData(old => ({ ...old, [key]: result }));
            }
            catch (reason) {
                if (!mounted.current || current !== epoch.current)
                    return;
                setErrors(old => ({ ...old, [key]: reason instanceof Error ? reason.message : "Unable to load this section." }));
                if (reason instanceof AccountRequestError && reason.status === 401)
                    router.replace("/login");
            }
        }));
        if (mounted.current && current === epoch.current)
            setLoading(false);
    }, [canView, router]);
    const invalidate = useCallback(() => {
        epoch.current++;
    }, []);
    useEffect(() => {
        mounted.current = true;
        let active = true;
        void Promise.resolve().then(() => {
            if (active)
                void load();
        });
        return () => {
            active = false;
            mounted.current = false;
            invalidate();
        };
    }, [load, invalidate]);
    return {
        data, errors, loading, canView, canManage, load
    };
}
