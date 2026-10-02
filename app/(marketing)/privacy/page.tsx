import Link from "next/link";
import { ArrowRight, Database, Mail, ShieldCheck } from "lucide-react";

const SECTIONS: [string, string][] = [
  [
    "What we collect",
    "Account email, display name, workspace metadata, clients, projects, time records, schedule records, billing identifiers, API key metadata, integration connection metadata, and support messages you submit. When you connect third-party services (such as Google Calendar or QuickBooks), we store encrypted OAuth tokens scoped to the permissions you grant.",
  ],
  [
    "How we use it",
    "We use workspace data to provide scheduling, timers, completed work logging, analytics, exports, invoices, API access, support, security monitoring, and billing operations. Google Calendar data is used exclusively to sync scheduled work blocks and import busy events to prevent double-booking. QuickBooks data is used exclusively to push approved invoices. We do not use third-party integration data for advertising, profiling, or any purpose beyond delivering the features you connect.",
  ],
  [
    "Third-party integrations",
    "SOWLedger connects to Google Calendar, Slack, and QuickBooks when you explicitly authorize the connection. We request only the minimum OAuth scopes needed: calendar event read/write for Google Calendar, incoming webhook delivery for Slack, and invoice create/read for QuickBooks. You can disconnect any integration at any time from your workspace settings, which revokes SOWLedger's access and deletes stored tokens.",
  ],
  [
    "What we do not store",
    "API key secrets are shown once and stored only as salted hashes. Payment card details are handled entirely by Stripe and never touch SOWLedger servers. Raw Google or QuickBooks API responses are not persisted beyond the sync operation that processes them.",
  ],
  [
    "Data sharing",
    "We do not sell, rent, or share your workspace data or integration tokens with third parties. Data is shared only with infrastructure providers (database hosting, deployment platform) strictly to operate the service, and with Stripe to process payments. No workspace data is used for training machine learning models.",
  ],
  [
    "Data security",
    "Integration credentials are encrypted at rest using AES-256. All data in transit uses TLS 1.2 or higher. API keys are hashed with a secure one-way algorithm. Workspace data is isolated by workspace ID in every query. Access to administrative functions requires manager or owner roles.",
  ],
  [
    "Data exports and portability",
    "Workspace owners and managers can export operational data in CSV or JSON at any time. Exports exclude secrets and include SHA-256 integrity headers. You own your workspace data and can request a full export or deletion at any time.",
  ],
  [
    "Your rights",
    "You may access, correct, export, or request deletion of your personal data by contacting support. If you are in the EU, UK, or California, you have additional rights under GDPR, UK GDPR, and CCPA respectively, including the right to object to processing and the right to data portability. We will respond to verified requests within 30 days.",
  ],
  [
    "Retention",
    "Operational records stay available until deleted through product workflows or by a verified workspace request. After account deletion, data is purged within 30 days, subject to legal, billing, and security obligations.",
  ],
  [
    "Changes to this policy",
    "We may update this privacy notice from time to time. Material changes will be communicated via email to workspace owners before they take effect. Continued use of the service after notice constitutes acceptance.",
  ],
  [
    "Contact",
    "Privacy questions can be sent through the contact page or emailed to privacy@sowledger.com. Include the workspace name and the email tied to your account.",
  ],
];

export const metadata = {
  title: "Privacy Policy - SOWLedger",
  description:
    "SOWLedger privacy policy covering workspace data, Google Calendar integration, QuickBooks integration, API key handling, Stripe payment boundaries, data security, user rights, exports, retention, and contact guidance.",
};

export default function PrivacyPage() {
  return (
    <div className="bg-background px-4 pb-20 pt-12 text-slate-950 sm:px-6 lg:pt-16">
      <div className="mx-auto max-w-6xl">
        <section className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10 sm:p-8">
          <div className="flex flex-wrap items-center gap-3">
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-cyan-50 px-4 py-1.5 text-sm font-bold text-cyan-800">
              <ShieldCheck className="h-4 w-4" />
              Trust center
            </p>
            <p className="rounded-full border border-border bg-background px-4 py-1.5 text-sm font-bold text-slate-700">
              Last updated August 15, 2026
            </p>
          </div>
          <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">
            Privacy policy
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
            This policy explains what data SOWLedger collects, how we use it,
            how we handle third-party integrations like Google Calendar and
            QuickBooks, and what rights you have over your data.
          </p>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
            <Database className="h-6 w-6 text-cyan-700" />
            <h2 className="mt-4 text-2xl font-semibold">Summary</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              SOWLedger stores operational workspace data, encrypted integration
              tokens, and hashed API keys. Payments are handled by Stripe.
              Integration data (Google Calendar, QuickBooks) is used only to
              deliver the features you connect and is never sold or shared. You
              can export or delete your data at any time.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">
                Workspace data
              </span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">
                Encrypted tokens
              </span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">
                Hashed keys
              </span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">
                Stripe payments
              </span>
              <span className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">
                No data selling
              </span>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {SECTIONS.map(([title, body]) => (
              <section
                key={title}
                className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"
              >
                <h2 className="text-xl font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>
              </section>
            ))}
          </div>
        </section>

        <section className="mt-6 flex flex-col gap-4 rounded-2xl bg-slate-950 p-6 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <Mail className="mt-1 h-5 w-5 text-cyan-300" />
            <div>
              <h2 className="text-2xl font-semibold">Privacy questions</h2>
              <p className="mt-1 text-sm text-slate-300">
                Include workspace context and account email. Do not include API
                keys or card data.
              </p>
            </div>
          </div>
          <Link
            href="/contact"
            className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200"
          >
            Contact support
            <ArrowRight className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </div>
  );
}
