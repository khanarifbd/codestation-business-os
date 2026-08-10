import Link from "next/link";

export default function CompanyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-neutral-100">
      <div className="border-b bg-white">
        <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-5 py-2.5 sm:px-8 lg:px-10">
          <Link
            href="/dashboard/company"
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Master Setup
          </Link>
          <Link
            href="/dashboard/company/defaults"
            className="rounded-lg px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            System Defaults
          </Link>
          <Link
            href="/dashboard/activity-logs"
            className="ml-auto rounded-lg px-3 py-2 text-sm text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
          >
            Activity Logs
          </Link>
        </div>
      </div>
      {children}
    </div>
  );
}
