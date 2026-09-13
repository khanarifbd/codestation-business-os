import Link from "next/link";

const sections = [
  {
    title: "Using CodeStation AI Business OS",
    body: [
      "CodeStation AI Business OS is a multi-tenant business management platform for managing clients, sales, projects, inventory, finance, accounting, people operations, payroll and reports. You are responsible for using the service lawfully and for ensuring that the information you enter is accurate and appropriate for your organization.",
      "You must keep your credentials secure and ensure that users you invite have appropriate access. Organization administrators are responsible for role and permission assignments within their tenant.",
    ],
  },
  {
    title: "Accounts and authentication",
    body: [
      "You may authenticate using supported email/password credentials or Google Sign-In. Google Sign-In is used only as an authentication method unless a separate feature explicitly requests additional Google permissions.",
      "You may not attempt to access another organization's data, bypass security controls, misuse another person's account or interfere with the operation of the service.",
    ],
  },
  {
    title: "Business and financial records",
    body: [
      "Business OS provides tools to help organizations record operational and accounting information. You remain responsible for reviewing the accuracy of financial, tax, payroll and legal information and for obtaining professional advice where required.",
      "Financial and audit records may be protected from deletion or alteration in order to preserve historical integrity and comply with applicable requirements.",
    ],
  },
  {
    title: "Availability and changes",
    body: [
      "We may improve, update or modify the service over time. We aim to preserve customer data and working business flows when making changes, but features may evolve as the platform develops.",
      "We may suspend access when necessary to protect the service, investigate misuse, comply with law or address security risks.",
    ],
  },
  {
    title: "Intellectual property",
    body: [
      "CodeStation AI retains ownership of the Business OS software, design, platform technology and related intellectual property. You retain ownership of the business data you or your authorized users submit to your organization workspace, subject to the rights needed for us to provide the service.",
    ],
  },
  {
    title: "Limitation and responsibility",
    body: [
      "To the extent permitted by applicable law, the service is provided without guarantees that it will be error-free or uninterrupted. You are responsible for business decisions made using the platform and for maintaining any additional records required by your industry or jurisdiction.",
    ],
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-5 py-10 text-neutral-950 sm:px-8 lg:px-10">
      <article className="mx-auto max-w-4xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="border-b border-neutral-200 pb-7">
          <Link href="/" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">
            ← CodeStation AI Business OS
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight">Terms of Service</h1>
          <p className="mt-3 text-sm text-neutral-500">Last updated: August 18, 2026</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-neutral-600">
            These Terms of Service govern access to and use of CodeStation AI Business OS. By using
            the service, you agree to these terms on behalf of yourself and, where applicable, the
            organization you represent.
          </p>
        </div>

        <div className="space-y-8 py-8">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <div className="mt-3 space-y-3 text-sm leading-7 text-neutral-600">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}

          <section>
            <h2 className="text-xl font-semibold">Privacy</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-600">
              Our handling of personal information, including Google Sign-In identity data, is
              described in the{" "}
              <Link href="/privacy" className="font-semibold text-neutral-950 underline underline-offset-4">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Contact</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-600">
              Questions about these terms can be sent to{" "}
              <a className="font-semibold text-neutral-950 underline underline-offset-4" href="mailto:info@codestationai.com">
                info@codestationai.com
              </a>
              , or through our <Link href="/contact" className="font-semibold text-neutral-950 underline underline-offset-4">Contact page</Link>.
            </p>
          </section>
        </div>

        <footer className="flex flex-wrap gap-4 border-t border-neutral-200 pt-6 text-sm">
          <Link href="/" className="font-semibold">Home</Link>
          <Link href="/contact" className="font-semibold">Contact Us</Link>
          <Link href="/support" className="font-semibold">Help & Support</Link>
          <Link href="/privacy" className="font-semibold">Privacy Policy</Link>
          <Link href="/login" className="font-semibold">Sign in</Link>
        </footer>
      </article>
    </main>
  );
}
