import { DashboardSessionProvider } from "@/components/dashboard-session-context";
import { DashboardShell } from "@/components/dashboard-shell";
import { TenantAreaGuard } from "@/components/tenant-area-guard";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardSessionProvider>
      <TenantAreaGuard>
        <style>{`
          @media (min-width: 1024px) {
            .tabular-nums {
              white-space: nowrap;
              overflow-wrap: normal;
              word-break: normal;
            }
          }
        `}</style>
        <DashboardShell>{children}</DashboardShell>
      </TenantAreaGuard>
    </DashboardSessionProvider>
  );
}
