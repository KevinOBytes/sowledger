import Link from "next/link";
import { publicPageMetadata } from "@/lib/marketing-metadata";
import { ArrowLeft, ArrowRight, Code2, FileDown, KeyRound, LockKeyhole, Server, ShieldCheck, Webhook } from "lucide-react";

const ENDPOINTS = [
  ["GET", "/api/v1/clients", "Read clients"],
  ["POST", "/api/v1/clients", "Create a client with write:clients"],
  ["GET", "/api/v1/projects", "Read projects"],
  ["POST", "/api/v1/projects", "Create a project with write:projects"],
  ["GET", "/api/v1/tags", "Read workspace tags"],
  ["POST", "/api/v1/tags", "Create a tag with write:tags"],
  ["GET", "/api/v1/tasks", "Read project tasks"],
  ["POST", "/api/v1/tasks", "Create a project task with write:tasks"],
  ["GET", "/api/v1/schedule", "Read scheduled work"],
  ["POST", "/api/v1/schedule", "Create scheduled work with write:schedule"],
  ["GET", "/api/v1/time-entries", "Read time entries"],
  ["POST", "/api/v1/time-entries", "Create a completed draft or submitted entry with write:time"],
  ["GET", "/api/v1/analytics", "Read analytics summaries"],
  ["GET", "/api/v1/invoices", "Read invoices"],
  ["GET", "/api/v1/proof-packs?invoiceId=...", "Read an invoice's linked time and audit details with read:proof-packs"],
  ["GET", "/api/v1/revenue-intelligence", "Read budget, unlogged-time, and unbilled-time checks with read:revenue-intelligence"],
  ["GET", "/api/v1/export", "Download CSV or JSON exports with export:data"],
];

const SCOPES = [
  "read:clients", "write:clients", "read:projects", "write:projects", "read:tags", "write:tags",
  "read:tasks", "write:tasks", "read:schedule", "write:schedule", "read:time", "write:time",
  "read:analytics", "read:invoices", "read:proof-packs", "read:revenue-intelligence", "export:data", "impersonate:user",
];

const EXTENSIONS = [
  ["Work records", "Read or update clients, projects, tasks, scheduled work, and completed time entries."],
  ["Invoice details", "Read the entries, hours, rates, and audit events behind an invoice."],
  ["Review checks", "Bring budget and time-entry checks into your own reporting process. These are review prompts, not forecasts."],
  ["Exports", "Download time-entry CSVs or workspace JSON data with a SHA-256 checksum."],
  ["Webhooks", "Configure event notifications in Settings → Webhooks to keep another system up to date."],
];

export const metadata = publicPageMetadata(
  "/support/api",
  "API documentation | SOWLedger",
  "Use SOWLedger API keys to read and update work records, retrieve invoice details, and export workspace data.",
);

export default function ApiSupportPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto max-w-6xl">
          <Link href="/support" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-600"><ArrowLeft className="h-4 w-4" />Support home</Link>
          <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">API documentation</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Connect your work records.</h1>
              <p className="mt-5 text-lg text-slate-600">Use a workspace API key to read or update work records, retrieve invoice details, and download exports. Choose only the permissions your integration needs.</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><KeyRound className="h-6 w-6" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold">Authentication</h2>
                  <p className="mt-2 text-sm text-slate-600">Owners and managers can create keys in Settings → Developers. Copy the key when it is shown, store it securely, and send it as a bearer token. Keep it out of browser code and source control.</p>
                  <pre tabIndex={0} role="region" aria-label="Authorization header example" className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700 sm:text-sm"><code>{`Authorization: Bearer $SOWLEDGER_API_KEY`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><ShieldCheck className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Choose permissions</h2><p className="mt-2 text-sm text-slate-600">Each endpoint checks a read or write scope. Missing permissions return 403; missing, expired, or revoked keys return 401.</p></div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><LockKeyhole className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Manage access</h2><p className="mt-2 text-sm text-slate-600">Set an expiry, rotate a key, or revoke it in Developers. SOWLedger stores a hash of the key rather than its full secret value.</p></div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><Server className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Review usage</h2><p className="mt-2 text-sm text-slate-600">Developers shows recent requests, including the endpoint, method, response status, and time. Use these records when troubleshooting a connection.</p></div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><Webhook className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">What you can connect</h2></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Use the API for your reporting and internal tools. Review the records and permissions before forwarding workspace data to another service.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {EXTENSIONS.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-border bg-background/60 p-4">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950">
            <p className="font-bold">Google Calendar, Slack, and QuickBooks</p>
            <p className="mt-1">Open Integrations in the app to check provider availability and connect an account. Provider configuration and workspace authorization are required before sync, notifications, or invoice export can run. QuickBooks connections may be in sandbox mode; check the connection before using it for live billing.</p>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">Example requests</h2></div>
          <p className="mt-3 text-sm leading-6 text-slate-600">Set the key in your local environment and replace example IDs with records from your workspace. A project filter narrows time entries, projects, tasks, and schedule data; a JSON export can still include other workspace-wide records. Use a time-entry CSV when that is all you intend to share.</p>
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
            <pre tabIndex={0} role="region" aria-label="Read projects request example" className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow-example_replace_me"
curl https://your-domain.com/api/v1/projects \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
            <pre tabIndex={0} role="region" aria-label="Export records request example" className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow-example_replace_me"
curl "https://your-domain.com/api/v1/export?format=json&projectId=proj_123" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><FileDown className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">Invoice details and time review</h2></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">The proof-packs endpoint returns invoice details, linked time entries, and audit events. Revenue-intelligence returns budget and time-entry review checks; it does not manage recurring retainers or predict recovered revenue. CSV and JSON exports include the <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">x-sowledger-export-sha256</code> checksum header.</p>
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
            <pre tabIndex={0} role="region" aria-label="Read invoice details request example" className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow-example_replace_me"
curl "https://your-domain.com/api/v1/proof-packs?invoiceId=inv_123" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
            <pre tabIndex={0} role="region" aria-label="Read time review checks request example" className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-700 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow-example_replace_me"
curl "https://your-domain.com/api/v1/revenue-intelligence" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-stone-900/5">
          <div className="border-b border-slate-100 px-6 py-4"><h2 className="text-2xl font-semibold">Version 1 endpoints</h2></div>
          <p className="px-6 py-4 text-sm leading-6 text-slate-600">Writable resources also support PATCH with the relevant record ID. DELETE archives clients, projects, and tags; removes tasks; or cancels scheduled blocks. Deleting time entries and writing invoices through API v1 are not supported. Time-entry creation requires a user ID and both start and stop times; it does not start or stop a live timer.</p>
          <div tabIndex={0} role="region" aria-label="API version 1 endpoints" className="max-w-full overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cyan-700">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Method</th><th className="px-6 py-3">Path</th><th className="px-6 py-3">Use</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ENDPOINTS.map(([method, path, description]) => <tr key={`${method}-${path}`}><td className="px-6 py-3 font-mono font-bold text-cyan-800">{method}</td><td className="px-6 py-3 font-mono text-xs text-slate-700">{path}</td><td className="px-6 py-3 text-slate-600">{description}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <h2 className="text-2xl font-semibold">Available scopes</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {SCOPES.map((scope) => <span key={scope} className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">{scope}</span>)}
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-600">Creating schedule blocks or time entries for someone other than the key&apos;s creator also requires <code>impersonate:user</code>. Grant this only when your integration needs to act for other workspace members.</p>
        </div>
      </section>

      <section className="px-4 pb-20 pt-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 rounded-2xl bg-slate-950 p-8 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
          <h2 className="text-3xl font-semibold">Actions that still happen in the app</h2>
          <p className="mt-3 text-slate-300">Approve time, create or change invoices, invite users, and manage the subscription in SOWLedger. API v1 does not expose those actions or destructive workspace administration.</p>
          </div>
          <Link href="/security" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200">
            Read about security
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
