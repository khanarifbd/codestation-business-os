import { DashboardShell } from "@/components/dashboard-shell";
import { ProjectClientMilestoneSharing } from "@/components/project-client-milestone-sharing";
import { TenantAreaGuard } from "@/components/tenant-area-guard";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
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
      <DashboardShell>
        {children}
        <ProjectClientMilestoneSharing />
      </DashboardShell>
    </TenantAreaGuard>
  );
}
