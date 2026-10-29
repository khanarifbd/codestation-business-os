import { type ReactNode } from "react";
import { Loader2, ArrowRight } from "lucide-react";
import Link from "next/link";
import { accountMoney } from "./account-model";
export function AccountState({ title, children, loading = false, action }: {
    title: string;
    children?: ReactNode;
    loading?: boolean;
    action?: ReactNode;
}) {
    return <section className="aa-state" aria-busy={loading}>{loading ? <Loader2 aria-hidden="true" className="animate-spin"/> : null}<h2>{title}</h2>{children ? <p>{children}</p> : null}{action}</section>;
}
export function AccountHeading({ eyebrow, title, description, actions }: {
    eyebrow: string;
    title: string;
    description?: string;
    actions?: ReactNode;
}) {
    return <header className="aa-heading"><div><p className="aa-eyebrow">{eyebrow}</p><h1>{title}</h1>{description ? <p className="aa-description">{description}</p> : null}</div>{actions ? <div className="aa-actions">{actions}</div> : null}</header>;
}
export function CurrencyValues({ values, empty = "No balances recorded" }: {
    values: [
        string,
        number
    ][];
    empty?: string;
}) {
    return values.length ? <dl className="aa-currency-values">{values.map(([currency, value]) => <div key={currency}><dt>{currency}</dt><dd>{accountMoney(value, currency).replace(`${currency} `, "")}</dd></div>)}</dl> : <p className="aa-muted">{empty}</p>;
}
export function AccountSectionHeading({ title, children, action }: {
    title: string;
    children?: ReactNode;
    action?: ReactNode;
}) {
    return <div className="aa-section-heading"><div><h2>{title}</h2>{children ? <p>{children}</p> : null}</div>{action}</div>;
}
export function AccountActionLink({ href, title, children }: {
    href: string;
    title: string;
    children?: ReactNode;
}) {
    return <Link className="aa-action-link" href={href}><div><strong>{title}</strong>{children ? <span>{children}</span> : null}</div><ArrowRight aria-hidden="true"/></Link>;
}
