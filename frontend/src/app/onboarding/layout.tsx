import { TenantAreaGuard } from "@/components/tenant-area-guard";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return <TenantAreaGuard>{children}</TenantAreaGuard>;
}
