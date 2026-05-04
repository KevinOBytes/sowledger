import Link from "next/link";

export const metadata = { title: "Security - Billabled" };

const POSTURE = [
  "Workspace isolation is mandatory for app queries and public API calls.",
  "API keys are scoped, revocable, expirable, usage-tracked, shown once, and stored hashed.",
  "Stripe checkout accepts internal plan IDs, not arbitrary client-submitted price IDs.",
  "Exports avoid secrets and include x-billabled-export-sha256 integrity headers where supported.",
  "Stripe webhooks and API v1 routes stay public at the proxy layer but authenticate inside the route handlers.",
  "Production migrations should run through the safe migration script with backup or catalog snapshot evidence.",
];

export default function SecurityPage() {
  return (
    <main className="bg-[#f6f3ee] px-6 pb-20 pt-32 text-slate-950">
      <div className="mx-auto max-w-5xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Security posture</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Built around workspace boundaries.</h1>
        <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-600">Billabled is early-stage software, so this page states the practical security posture customers need to understand before trusting it with operational time and billing data.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          {POSTURE.map((item) => (
            <div key={item} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <p className="leading-7 text-slate-700">{item}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-[32px] bg-slate-950 p-6 text-white shadow-sm">
          <h2 className="text-2xl font-semibold">Report a security concern</h2>
          <p className="mt-2 text-slate-300">Send the affected workspace, endpoint, timestamp, and safe reproduction details. Do not include secrets in the initial report.</p>
          <Link href="/contact" className="mt-5 inline-flex rounded-full bg-cyan-300 px-5 py-3 text-sm font-bold text-slate-950 hover:bg-cyan-200">Contact support</Link>
        </div>
      </div>
    </main>
  );
}
