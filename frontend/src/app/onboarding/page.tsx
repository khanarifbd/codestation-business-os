import { Suspense } from "react";
import { CompanyOnboardingWorkspace } from "@/components/identity/company-onboarding";
export default function OnboardingPage() {
  return <Suspense fallback={<main className="p-6" role="status">Checking company setup…</main>}><CompanyOnboardingWorkspace /></Suspense>;
}
