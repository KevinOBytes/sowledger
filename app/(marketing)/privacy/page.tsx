import Link from "next/link";
import { publicPageMetadata } from "@/lib/marketing-metadata";
import { ArrowRight, Database, Mail, ShieldCheck } from "lucide-react";

const SECTIONS: [string, string][] = [
  [
    "What we collect",
    "We store your account email and display name, workspace settings, client and project records, time entries, scheduled work, billing identifiers, API key details, and messages you send to support. When you connect a service such as Google Calendar or QuickBooks, we also store encrypted credentials for the permissions you authorize.",
  ],
  [
    "How we use it",
    "We use workspace data to provide scheduling, timers, completed work logging, analytics, exports, invoices, API access, support, security monitoring, and billing operations. Google Calendar data is used exclusively to sync scheduled work blocks and import busy events to prevent double-booking. QuickBooks data is used exclusively to export the SOWLedger invoices you choose to send. We do not use third-party integration data for advertising, profiling, or any purpose beyond delivering the features you connect.",
  ],
  [
    "Third-party integrations",
    "Google Calendar connections request calendar event read/write access. Slack connections use incoming webhooks. QuickBooks connections request its accounting permission for invoice sync. Owners and managers can disconnect a service from Integrations, which disables the connection and removes its stored credentials from SOWLedger. To revoke the provider's authorization as well, remove SOWLedger in that provider's account settings.",
  ],
  [
    "What we do not store",
    "API key secrets are shown once and stored only as hashes. Stripe handles payment card details. SOWLedger stores the work records and connection details needed for sync, rather than complete raw Google or QuickBooks API responses.",
  ],
  [
    "Data sharing",
    "We do not sell or rent your workspace data or integration credentials. Data is shared with infrastructure providers to operate SOWLedger, with Stripe for payments, and with the connected services you choose to use. No workspace data is used for training machine learning models.",
  ],
  [
    "Data security",
    "Stored integration credentials are encrypted with AES-256-GCM, and API keys are stored as one-way hashes. Workspace membership, roles, and API permissions control access to records and actions. Sensitive settings require manager or owner access; subscription changes require an owner.",
  ],
  [
    "Data exports and portability",
    "Workspace owners and managers can export records in CSV or JSON. Exports exclude secrets and include a SHA-256 checksum. Review files before sharing them: a JSON export can include workspace records beyond a filtered set of time entries. You own your workspace data and can contact support to request a full export or deletion.",
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

export const metadata = publicPageMetadata(
  "/privacy",
  "Privacy Policy - SOWLedger",
  "SOWLedger privacy policy covering workspace data, Google Calendar integration, QuickBooks integration, API key handling, Stripe payment boundaries, data security, user rights, exports, retention, and contact guidance.",
);

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
              Last updated October 9, 2026
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
              SOWLedger stores your work records, encrypted integration
              credentials, and hashed API keys. Stripe handles payments.
              Connected services exchange the data needed for the features you
              authorize. You can export records in the app or contact support
              to request deletion.
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
                Include your workspace name and account email. Do not include API
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
