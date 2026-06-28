import Link from "next/link";
import { ArrowLeft, ArrowRight, Code2, FileDown, KeyRound, LockKeyhole, Server, ShieldCheck, Webhook } from "lucide-react";

const ENDPOINTS = [
  ["GET", "/api/v1/clients", "Read clients"],
  ["POST", "/api/v1/clients", "Create a client with write:clients"],
  ["GET", "/api/v1/projects", "Read projects"],
  ["POST", "/api/v1/projects", "Create a project with write:projects"],
  ["GET", "/api/v1/tags", "Read workspace tags"],
  ["GET", "/api/v1/tasks", "Read project tasks"],
  ["GET", "/api/v1/schedule", "Read scheduled work"],
  ["POST", "/api/v1/schedule", "Create scheduled work with write:schedule"],
  ["GET", "/api/v1/time-entries", "Read time entries"],
  ["POST", "/api/v1/time-entries", "Create completed work with write:time"],
  ["GET", "/api/v1/analytics", "Read analytics summaries"],
  ["GET", "/api/v1/invoices", "Read invoices"],
  ["GET", "/api/v1/proof-packs?invoiceId=...", "Read digest-backed invoice proof packs with read:proof-packs"],
  ["GET", "/api/v1/revenue-intelligence", "Read retainer risk and recovery summaries with read:revenue-intelligence"],
  ["GET", "/api/v1/export", "Download CSV or JSON exports with export:data"],
];

const SCOPES = [
  "read:clients", "write:clients", "read:projects", "write:projects", "read:tags", "write:tags",
  "read:tasks", "write:tasks", "read:schedule", "write:schedule", "read:time", "write:time",
  "read:analytics", "read:invoices", "read:proof-packs", "read:revenue-intelligence", "export:data",
];

const EXTENSIONS = [
  ["Native integrations", "Connect Google Calendar, Slack, and QuickBooks in the app, then use API keys for long-tail systems."],
  ["Proof packs", "Fetch client-ready invoice evidence for issued invoices and approval workflows."],
  ["Revenue intelligence", "Read retainer risk, missing billable, and recovery summaries for operating reviews."],
  ["Exports", "Pull CSV or JSON exports with integrity headers where supported."],
  ["Webhooks", "Connect project, time, invoice, and approval events to agency systems."],
];

export const metadata = {
  title: "API Usage - SOWLedger Support",
  description: "Build on SOWLedger with scoped API keys for proof packs, revenue intelligence, exports, webhooks, and workspace operations.",
};

export default function ApiSupportPage() {
  return (
    <div className="bg-background text-slate-950">
      <section className="border-b border-border px-4 pb-12 pt-12 sm:px-6 lg:pt-16">
        <div className="mx-auto max-w-6xl">
          <Link href="/support" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-600"><ArrowLeft className="h-4 w-4" />Support home</Link>
          <div className="mt-8 grid min-w-0 gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div className="min-w-0">
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">API usage</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Build on SOWLedger.</h1>
              <p className="mt-5 text-lg text-slate-600">Use scoped workspace API keys to read and write operational data, pull invoice proof, and monitor revenue risk without exposing billing, invites, or destructive admin actions.</p>
            </div>
            <div className="min-w-0 rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><KeyRound className="h-6 w-6" /></div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-2xl font-semibold">Authentication</h2>
                  <p className="mt-2 text-sm text-slate-600">Send API keys as bearer tokens. Keys are generated in Settings - Developers and are shown once.</p>
                  <pre className="mt-4 min-w-0 max-w-full overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs text-cyan-100 sm:text-sm"><code>{`Authorization: Bearer $SOWLEDGER_API_KEY`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-4 py-10 sm:px-6">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><ShieldCheck className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Scoped access</h2><p className="mt-2 text-sm text-slate-600">Each endpoint checks a specific read or write scope. Missing scopes return 403.</p></div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><LockKeyhole className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Hashed secrets</h2><p className="mt-2 text-sm text-slate-600">SOWLedger stores a hash, prefix, creator, expiry, revoke status, and last-used timestamp, never raw keys.</p></div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5"><Server className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Usage tracking</h2><p className="mt-2 text-sm text-slate-600">Requests record endpoint, method, status, timestamp, key ID, user agent, and a safe IP hash.</p></div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><Webhook className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">API extends the workflow</h2></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Use API v1 after the work record is corrected: send proof packs to client systems, pull revenue intelligence into reviews, export operational data, and listen for workflow events.</p>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {EXTENSIONS.map(([title, body]) => (
              <div key={title} className="rounded-xl border border-border bg-background/60 p-4">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50 p-4 text-sm leading-6 text-cyan-950">
            <p className="font-bold">Native app integrations</p>
            <p className="mt-1">Use <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs">/integrations</code> inside the authenticated app for Google Calendar sync, Slack alerts, and QuickBooks invoice push. OAuth routes stay session-authenticated and store provider credentials encrypted.</p>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">Example requests</h2></div>
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
            <pre className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow_example_replace_me"
curl https://your-domain.com/api/v1/projects \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
            <pre className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow_example_replace_me"
curl "https://your-domain.com/api/v1/export?format=json&projectId=proj_123" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
          <div className="flex items-center gap-3"><FileDown className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">Proof and revenue intelligence</h2></div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Agency integrations can fetch invoice proof packs for client-facing evidence and revenue intelligence for retainer leak, missing billable, and recovery workflows. Proof-pack responses are designed for digest-backed invoice support; exports continue to include the <code className="break-all rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-700">x-sowledger-export-sha256</code> integrity header.</p>
          <div className="mt-5 grid min-w-0 gap-4 lg:grid-cols-2">
            <pre className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow_example_replace_me"
curl "https://your-domain.com/api/v1/proof-packs?invoiceId=inv_123" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
            <pre className="min-w-0 max-w-full overflow-x-auto rounded-3xl bg-slate-950 p-5 text-xs text-cyan-100 sm:text-sm"><code>{`export SOWLEDGER_API_KEY="sow_example_replace_me"
curl "https://your-domain.com/api/v1/revenue-intelligence" \
  --oauth2-bearer "$SOWLEDGER_API_KEY"`}</code></pre>
          </div>
        </div>
      </section>

      <section className="px-4 py-8 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-2xl border border-border bg-surface shadow-sm shadow-stone-900/5">
          <div className="border-b border-slate-100 px-6 py-4"><h2 className="text-2xl font-semibold">Version 1 endpoints</h2></div>
          <div className="max-w-full overflow-x-auto">
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
        </div>
      </section>

      <section className="px-4 pb-20 pt-8 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 rounded-2xl bg-slate-950 p-8 text-white shadow-sm md:flex-row md:items-center md:justify-between">
          <div>
          <h2 className="text-3xl font-semibold">What v1 intentionally excludes</h2>
          <p className="mt-3 text-slate-300">Public API v1 excludes billing changes, user invites, subscription management, and destructive workspace administration. Those actions remain inside authenticated app UI workflows.</p>
          </div>
          <Link href="/security" className="inline-flex items-center justify-center gap-2 rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-200">
            Review trust center
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </div>
  );
}
