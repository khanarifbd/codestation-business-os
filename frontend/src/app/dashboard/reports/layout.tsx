import { AccountingNav } from "@/components/accounting-nav";

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="mx-auto max-w-[1500px] px-4 pt-4 sm:px-7 sm:pt-7 lg:px-9 lg:pt-9">
        <AccountingNav />
      </div>
      {children}
    </div>
  );
}
