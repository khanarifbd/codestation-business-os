import { DashboardShell } from "@/components/dashboard-shell";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @media (min-width: 1024px) {
          .business-dashboard-scope .tabular-nums {
            white-space: nowrap;
            overflow-wrap: normal;
            word-break: normal;
          }
        }
      `}</style>
      <DashboardShell>
        <div className="business-dashboard-scope">{children}</div>
      </DashboardShell>
    </>
  );
}
