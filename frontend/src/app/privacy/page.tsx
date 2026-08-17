import Link from "next/link";

const sections = [
  {
    title: "Information we collect",
    body: [
      "We collect the account and business information you provide when you create or use CodeStation AI Business OS, such as your name, email address, organization details, client records, project data, invoices, payments, employee information and configuration settings.",
      "If you choose Google Sign-In, we receive identity information provided by Google for authentication, such as your Google account's unique identifier, email address, email verification state and profile name when available. We do not receive your Google password.",
    ],
  },
  {
    title: "How we use Google user data",
    body: [
      "Google Sign-In data is used only to authenticate you, create or link your Business OS account, protect account access and maintain the security and auditability of authentication events.",
      "Using Google Sign-In does not give CodeStation AI Business OS access to your Gmail, Google Drive, Google Calendar, Google Contacts or other Google services unless a separate feature explicitly requests additional permission in the future.",
    ],
  },
  {
    title: "How we use business data",
    body: [
      "We use your organization data to provide the Business OS features you request, including CRM, sales, projects, inventory, finance, accounting, HR, payroll, reports, permissions and audit records.",
      "We may use operational metadata to secure, maintain, troubleshoot and improve the service. Accounting and audit data may be retained where required for record integrity, legal obligations or legitimate business purposes.",
    ],
  },
  {
    title: "Sharing and disclosure",
    body: [
      "We do not sell your personal information or Google user data. We may share data with service providers that help us operate the platform, subject to appropriate confidentiality and security obligations, or when disclosure is required by law.",
      "Tenant data is organization-scoped. Business OS is designed to prevent one organization from accessing another organization's private data.",
    ],
  },
  {
    title: "Data retention and deletion",
    body: [
      "We retain information for as long as needed to provide the service, maintain security and audit history, comply with legal or accounting requirements, and resolve disputes.",
      "You may request account or personal-data deletion where applicable. Some financial, audit or legally required records may need to be retained even after an account is closed.",
    ],
  },
  {
    title: "Security",
    body: [
      "We use technical and organizational safeguards including authentication controls, tenant scoping, role-based permissions, audit logging and encrypted transport. No online service can guarantee absolute security, so users should also protect their credentials and devices.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-neutral-100 px-5 py-10 text-neutral-950 sm:px-8 lg:px-10">
      <article className="mx-auto max-w-4xl rounded-3xl border border-neutral-200 bg-white p-6 shadow-sm sm:p-10">
        <div className="border-b border-neutral-200 pb-7">
          <Link href="/" className="text-sm font-semibold text-neutral-500 hover:text-neutral-950">
            ← CodeStation AI Business OS
          </Link>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight">Privacy Policy</h1>
          <p className="mt-3 text-sm text-neutral-500">Last updated: August 18, 2026</p>
          <p className="mt-5 max-w-3xl text-base leading-7 text-neutral-600">
            This Privacy Policy explains how CodeStation AI Business OS collects, uses, stores and
            protects information when you use our business management platform, including when you
            choose to authenticate with Google Sign-In.
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
            <h2 className="text-xl font-semibold">Your choices and rights</h2>
            <div className="mt-3 space-y-3 text-sm leading-7 text-neutral-600">
              <p>
                Depending on your location, you may have rights to access, correct, export or delete
                personal information, or to object to or restrict certain processing. Organization
                administrators may also manage business records and user access within their tenant.
              </p>
              <p>
                Google Sign-In is optional. You may use the available email/password authentication
                flow instead where supported by your account.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold">Contact</h2>
            <p className="mt-3 text-sm leading-7 text-neutral-600">
              For privacy questions or requests, contact CodeStation AI at{" "}
              <a className="font-semibold text-neutral-950 underline underline-offset-4" href="mailto:info@codestationai.com">
                info@codestationai.com
              </a>
              .
            </p>
          </section>
        </div>

        <footer className="flex flex-wrap gap-4 border-t border-neutral-200 pt-6 text-sm">
          <Link href="/" className="font-semibold">Home</Link>
          <Link href="/terms" className="font-semibold">Terms of Service</Link>
          <Link href="/login" className="font-semibold">Sign in</Link>
        </footer>
      </article>
    </main>
  );
}
