import { Building2, KeyRound, Mail, UserRound } from "lucide-react";

export type AuthJourney = "signup" | "recovery" | "reset" | "verification";

const setupSteps = [
  { title: "Create your account", detail: "Your name, work email and password.", icon: UserRound },
  { title: "Verify your email", detail: "Confirm your email before signing in.", icon: Mail },
  { title: "Set up your company", detail: "Choose your country, timezone and defaults.", icon: Building2 },
];
const recoverySteps = [
  { title: "Request a reset link", detail: "Use the email connected to your account.", icon: Mail },
  { title: "Choose a new password", detail: "Open the link in your recovery email.", icon: KeyRound },
  { title: "Sign in again", detail: "Continue with your new password.", icon: UserRound },
];

export function AuthJourneyPanel({ journey }: { journey: AuthJourney }) {
  const recovery = journey === "recovery" || journey === "reset";
  const steps = recovery ? recoverySteps : setupSteps;
  const current = journey === "verification" || journey === "reset" ? 1 : 0;
  return <>
    <p className="login-overline"><span />{recovery ? "A SIMPLE WAY BACK" : "A BETTER WAY TO WORK"}</p>
    <h2>{recovery ? "A fresh start." : "A clearer start."}<br /><span>{recovery ? "Back to business." : "A connected business."}</span></h2>
    <p className="login-story-description">{recovery ? "Get back to the clients, projects and decisions that matter. We'll guide you through your next step." : "One account is the beginning. Bring your clients, projects, finances and team into a workspace built around your company."}</p>
    <div className="auth-journey" aria-label={recovery ? "Password recovery process" : "Account setup process"}>
      <div className="auth-journey-heading"><span>{recovery ? "YOUR WAY BACK" : "YOUR FIRST STEPS"}</span><span>01 — 03</span></div>
      <ol>{steps.map(({ title, detail, icon: Icon }, index) => <li key={title} className={index === current ? "auth-journey-current" : undefined} aria-current={index === current ? "step" : undefined}>
        <span className="auth-journey-icon"><Icon size={20} strokeWidth={1.5} aria-hidden="true" /></span>
        <div><strong>{title}</strong><p>{detail}</p></div><span className="auth-journey-number">0{index + 1}</span>
      </li>)}</ol>
    </div>
    <p className="auth-journey-footnote">{recovery ? "Already remember your password? You can return to sign in at any time." : "Company setup follows email verification and sign-in. No company details are needed on this screen."}</p>
  </>;
}

export function AuthProgress({ journey }: { journey: AuthJourney }) {
  const setup = journey === "signup" || journey === "verification";
  const labels = setup ? ["Account", "Verify email", "Company"] : ["Email", "New password", "Sign in"];
  const current = journey === "verification" || journey === "reset" ? 1 : 0;
  return <ol className="auth-progress" aria-label={setup ? "Account setup progress" : "Recovery progress"}>{labels.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined}><span /><small>{label}</small></li>)}</ol>;
}
