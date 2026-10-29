import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, FileText, FolderKanban, Handshake, ReceiptText, WalletCards } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";

import { AuthJourneyPanel, AuthProgress, type AuthJourney } from "@/components/auth/auth-journey";
import "@/app/login/login.css";

export type AuthFrameVariant = "login" | AuthJourney;

/** Shared approved authentication shell. Page components retain all authentication logic. */
export function LoginFrame({ eyebrow, title, description, children, variant = "login" }: {
  eyebrow: string; title: string; description: string; children: React.ReactNode; variant?: AuthFrameVariant;
}) {
  return (
    <main className={`login-redesign${variant !== "login" ? " auth-flow auth-flow-" + variant : ""}`}>
      <a href="#sign-in" className="login-skip-link">{variant === "login" ? "Skip to sign in" : "Skip to form"}</a>
      <aside className="login-story" aria-label="About Business OS">
        <div className="login-story-grid" aria-hidden="true" />
        <Link href="/" className="login-brand" aria-label="Business OS home">
          <span className="login-brand-mark"><BrandMark variant="light" /></span>
          <span className="login-brand-name">Business<span>OS</span><small>BY CODESTATION AI</small></span>
        </Link>

        <div className="login-story-content">
          {variant === "login" ? <>
          <p className="login-overline"><span />YOUR BUSINESS. WORKING TOGETHER.</p>
          <h2>One workspace.<br />Every <span>moving part.</span></h2>
          <p className="login-story-description">From the first client conversation to the final payment. Bring your team, projects and finances into one connected workspace.</p>

          <div className="login-workflow" aria-label="Illustrative workflow: client, quotation, order, project, invoice, payment. Not live account data.">
            <div className="login-workflow-top"><span><span className="login-flow-dot" />THE CONNECTED WORKFLOW</span><span className="login-flow-example">Product overview</span></div>
            <div className="login-flow-row">
              <div className="login-flow-step"><span><Handshake size={20} strokeWidth={1.5} /></span><strong>Client</strong><small>Start a relationship</small></div><ArrowRight className="login-flow-arrow" size={17} />
              <div className="login-flow-step"><span><FileText size={20} strokeWidth={1.5} /></span><strong>Quotation</strong><small>Define the scope</small></div><ArrowRight className="login-flow-arrow" size={17} />
              <div className="login-flow-step"><span><ReceiptText size={20} strokeWidth={1.5} /></span><strong>Order</strong><small>Make it official</small></div>
            </div>
            <div className="login-flow-connector" aria-hidden="true"><svg viewBox="0 0 500 32" preserveAspectRatio="none" fill="none"><path d="M416 0v8a6 6 0 0 1-6 6H90a6 6 0 0 0-6 6v9" /><path d="m80 25 4 4 4-4" /></svg></div>
            <div className="login-flow-row login-flow-row-bottom">
              <div className="login-flow-step"><span><FolderKanban size={20} strokeWidth={1.5} /></span><strong>Project</strong><small>Deliver the work</small></div><ArrowRight className="login-flow-arrow" size={17} />
              <div className="login-flow-step"><span><FileText size={20} strokeWidth={1.5} /></span><strong>Invoice</strong><small>Bill with clarity</small></div><ArrowRight className="login-flow-arrow" size={17} />
              <div className="login-flow-step login-flow-finish"><span><WalletCards size={20} strokeWidth={1.5} /><i><Check size={8} strokeWidth={3} /></i></span><strong>Payment</strong><small>Close the loop</small></div>
            </div>
          </div>
          <div className="login-capabilities"><span>CRM & sales</span><i /><span>Projects & delivery</span><i /><span>Finance & accounting</span><i /><span>People & HR</span></div>
          </> : <AuthJourneyPanel journey={variant} />}
        </div>
        <footer className="login-story-footer"><span>Less disconnected work. More forward momentum.</span><span className="login-footer-line" /></footer>
      </aside>

      <section className="login-access" aria-label={variant === "login" ? "Sign in to your account" : title}>
        <header className="login-access-header">
          <Link href="/" className="login-mobile-brand" aria-label="Business OS home"><span><BrandMark /></span><strong>Business<span>OS</span></strong></Link>
          <span className="login-help-label">Need a hand?</span><Link href="/support">Contact support <ArrowUpRight size={13} /></Link>
        </header>
        <div className="login-form-region" id="sign-in" tabIndex={-1}>
          <div className="login-form-content">
            {variant !== "login" ? <AuthProgress journey={variant} /> : null}
            <div className="login-welcome"><p className="login-form-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
            {children}
          </div>
        </div>
        <footer className="login-access-footer"><span>© CodeStation AI</span><nav aria-label="Legal links"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Help</Link></nav></footer>
      </section>
    </main>
  );
}
