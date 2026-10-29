import Link from "next/link";
import { ArrowLeft, CircleAlert, CircleCheck, Info } from "lucide-react";

/** Shared presentation; pages retain ownership of request state and actions. */
export function AuthNotice({ kind, children }: { kind: "error" | "success" | "info"; children: React.ReactNode }) {
  const Icon = kind === "error" ? CircleAlert : kind === "success" ? CircleCheck : Info;
  return <div className={`auth-notice auth-notice-${kind}`} role={kind === "error" ? "alert" : "status"}><Icon size={17} aria-hidden="true" /><div>{children}</div></div>;
}

export function AuthBackLink() {
  return <p className="auth-back-link"><Link href="/login"><ArrowLeft size={14} aria-hidden="true" />Back to sign in</Link></p>;
}
