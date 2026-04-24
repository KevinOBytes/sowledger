import Link from "next/link";
import { ArrowLeft, Code2, KeyRound, LockKeyhole, Server, ShieldCheck } from "lucide-react";

const ENDPOINTS = [
  ["GET", "/api/v1/clients", "Read clients"],
  ["POST", "/api/v1/clients", "Create a client with write:clients"],
  ["GET", "/api/v1/projects", "Read projects"],
  ["POST", "/api/v1/projects", "Create a project with write:projects"],
  ["GET", "/api/v1/tags", "Read workspace tags"],
  ["GET", "/api/v1/tasks", "Read project tasks"],
  ["GET", "/api/v1/schedule", "Read scheduled work blocks"],
  ["POST", "/api/v1/schedule", "Create scheduled work with write:schedule"],
  ["GET", "/api/v1/time-entries", "Read time entries"],
  ["POST", "/api/v1/time-entries", "Create manual time with write:time"],
  ["GET", "/api/v1/analytics", "Read analytics summaries"],
  ["GET", "/api/v1/invoices", "Read invoices"],
  ["GET", "/api/v1/export", "Download CSV or JSON exports with export:data"],
];

const SCOPES = [
  "read:clients", "write:clients", "read:projects", "write:projects", "read:tags", "write:tags",
  "read:tasks", "write:tasks", "read:schedule", "write:schedule", "read:time", "write:time",
  "read:analytics", "read:invoices", "export:data",
];

export const metadata = { title: "API Usage - Billabled Support" };

export default function ApiSupportPage() {
  return (
    <div className="bg-[#f6f3ee] text-slate-950">
      <section className="px-6 pb-12 pt-28">
        <div className="mx-auto max-w-6xl">
          <Link href="/support" className="inline-flex items-center gap-2 text-sm font-bold text-cyan-800 hover:text-cyan-600"><ArrowLeft className="h-4 w-4" />Support home</Link>
          <div className="mt-8 grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">API usage</p>
              <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Build on Billabled.</h1>
              <p className="mt-5 text-lg text-slate-600">Use scoped workspace API keys to read and write operational data without exposing billing, invites, or destructive admin actions.</p>
            </div>
            <div className="rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><KeyRound className="h-6 w-6" /></div>
                <div>
                  <h2 className="text-2xl font-semibold">Authentication</h2>
                  <p className="mt-2 text-sm text-slate-600">Send API keys as bearer tokens. Keys are generated in <Link href="/settings/developers" className="font-bold text-cyan-800">Settings - Developers</Link> and are shown once.</p>
                  <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-cyan-100"><code>{`Authorization: Bearer blb_your_api_key`}</code></pre>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto grid max-w-6xl gap-5 md:grid-cols-3">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm"><ShieldCheck className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Scoped access</h2><p className="mt-2 text-sm text-slate-600">Each endpoint checks a specific read or write scope. Missing scopes return 403.</p></div>
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm"><LockKeyhole className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Hashed secrets</h2><p className="mt-2 text-sm text-slate-600">Billabled stores a hash, prefix, creator, expiry, revoke status, and last-used timestamp, never raw keys.</p></div>
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm"><Server className="h-6 w-6 text-cyan-700" /><h2 className="mt-4 text-xl font-semibold">Usage tracking</h2><p className="mt-2 text-sm text-slate-600">Requests record endpoint, method, status, timestamp, key ID, user agent, and a safe IP hash.</p></div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-6xl rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><Code2 className="h-5 w-5 text-cyan-700" /><h2 className="text-2xl font-semibold">Example requests</h2></div>
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            <pre className="overflow-x-auto rounded-3xl bg-slate-950 p-5 text-sm text-cyan-100"><code>{`curl https://your-domain.com/api/v1/projects \
  -H "Authorization: Bearer blb_your_api_key"`}</code></pre>
            <pre className="overflow-x-auto rounded-3xl bg-slate-950 p-5 text-sm text-cyan-100"><code>{`curl "https://your-domain.com/api/v1/export?format=json&projectId=proj_123" \
  -H "Authorization: Bearer blb_your_api_key"`}</code></pre>
          </div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[36px] border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-6 py-4"><h2 className="text-2xl font-semibold">Version 1 endpoints</h2></div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Method</th><th className="px-6 py-3">Path</th><th className="px-6 py-3">Use</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {ENDPOINTS.map(([method, path, description]) => <tr key={`${method}-${path}`}><td className="px-6 py-3 font-mono font-bold text-cyan-800">{method}</td><td className="px-6 py-3 font-mono text-xs text-slate-700">{path}</td><td className="px-6 py-3 text-slate-600">{description}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="px-6 py-8">
        <div className="mx-auto max-w-6xl rounded-[36px] border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-2xl font-semibold">Available scopes</h2>
          <div className="mt-4 flex flex-wrap gap-2">
            {SCOPES.map((scope) => <span key={scope} className="rounded-full bg-cyan-50 px-3 py-1.5 text-xs font-bold text-cyan-800">{scope}</span>)}
          </div>
        </div>
      </section>

      <section className="px-6 py-16">
        <div className="mx-auto max-w-6xl rounded-[36px] bg-slate-950 p-8 text-white shadow-sm">
          <h2 className="text-3xl font-semibold">What v1 intentionally excludes</h2>
          <p className="mt-3 text-slate-300">Public API v1 excludes billing changes, user invites, subscription management, and destructive workspace administration. Those actions remain inside authenticated app UI workflows.</p>
        </div>
      </section>
    </div>
  );
}
