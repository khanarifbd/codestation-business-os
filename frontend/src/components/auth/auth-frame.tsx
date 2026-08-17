import Link from "next/link";
import { ArrowUpRight, Building2, Check, Globe2, ShieldCheck } from "lucide-react";

export function AuthFrame({
  eyebrow,
  title,
  description,
  asideTitle,
  asideDescription,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  asideTitle: string;
  asideDescription: string;
  children: React.ReactNode;
}) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f5f5f3] px-4 py-4 text-neutral-950 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(255,255,255,0.95),transparent_28%),radial-gradient(circle_at_88%_90%,rgba(228,228,226,0.9),transparent_30%)]" />

      <div className="relative mx-auto grid min-h-[calc(100vh-2rem)] max-w-[1240px] overflow-hidden rounded-[30px] border border-black/[0.07] bg-white shadow-[0_28px_90px_rgba(0,0,0,0.08)] sm:min-h-[calc(100vh-3rem)] lg:min-h-[calc(100vh-4rem)] lg:grid-cols-[0.92fr_1.08fr]">
        <aside className="relative hidden overflow-hidden bg-neutral-950 p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-12">
          <div className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute -right-10 -top-10 size-52 rounded-full border border-white/10" />
          <div className="pointer-events-none absolute bottom-16 left-10 h-px w-44 bg-gradient-to-r from-white/30 to-transparent" />

          <div className="relative flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-2xl border border-white/10 bg-white text-neutral-950 shadow-lg shadow-black/20">
              <Building2 className="size-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/45">CodeStation AI</p>
              <p className="mt-0.5 text-lg font-semibold tracking-tight">Business OS</p>
            </div>
          </div>

          <div className="relative max-w-lg">
            <div className="mb-6 flex flex-wrap gap-2">
              {["CRM", "Projects", "Finance", "Reports"].map((item) => (
                <span key={item} className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/70">
                  {item}
                </span>
              ))}
            </div>
            <h1 className="max-w-md text-[42px] font-semibold leading-[1.06] tracking-[-0.04em] xl:text-[48px]">
              {asideTitle}
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-7 text-white/52">{asideDescription}</p>

            <div className="mt-9 grid gap-3 text-sm text-white/70">
              <div className="flex items-center gap-3"><span className="flex size-6 items-center justify-center rounded-full bg-white/10"><Check className="size-3.5" /></span>Tenant-isolated company workspace</div>
              <div className="flex items-center gap-3"><span className="flex size-6 items-center justify-center rounded-full bg-white/10"><Check className="size-3.5" /></span>Multi-currency finance and accounting</div>
              <div className="flex items-center gap-3"><span className="flex size-6 items-center justify-center rounded-full bg-white/10"><Check className="size-3.5" /></span>Auditable business operations</div>
            </div>
          </div>

          <div className="relative flex items-center justify-between text-xs text-white/35">
            <div className="flex items-center gap-2"><ShieldCheck className="size-4" /> Secure workspace</div>
            <div className="flex items-center gap-2"><Globe2 className="size-4" /> Built for global teams</div>
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-white">
          <div className="flex items-center justify-between border-b border-neutral-100 px-6 py-5 lg:hidden">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-neutral-950 text-white"><Building2 className="size-4" /></div>
              <div><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-neutral-400">CodeStation AI</p><p className="text-sm font-semibold">Business OS</p></div>
            </div>
            <Link href="/" className="flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-950">Home <ArrowUpRight className="size-3.5" /></Link>
          </div>

          <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10 lg:px-14 xl:px-20">
            <div className="w-full max-w-[440px]">
              <div className="mb-8">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-neutral-400">{eyebrow}</p>
                <h2 className="mt-3 text-[34px] font-semibold tracking-[-0.035em] text-neutral-950 sm:text-[38px]">{title}</h2>
                <p className="mt-3 max-w-md text-sm leading-6 text-neutral-500">{description}</p>
              </div>
              {children}
            </div>
          </div>

          <div className="hidden items-center justify-between border-t border-neutral-100 px-10 py-5 text-xs text-neutral-400 sm:flex lg:px-14 xl:px-20">
            <span>© CodeStation AI</span>
            <span>One workspace for your business</span>
          </div>
        </section>
      </div>
    </main>
  );
}
