export const metadata = { title: "Terms - Billabled" };

const TERMS = [
  ["Service use", "Billabled provides workspace tools for planning, timers, completed work logs, analytics, invoices, exports, and API integrations. You are responsible for the accuracy of data entered into your workspace."],
  ["Accounts and access", "Use a valid email and keep workspace access limited to authorized users. Owners and managers control higher-risk actions such as billing, approvals, exports, API keys, and webhooks."],
  ["Customer data", "You retain responsibility for customer data in your workspace. Do not upload secrets or regulated data unless your agreement and configuration explicitly allow it."],
  ["Availability", "We aim to keep the service available, but beta and early production access may include maintenance windows, product changes, and usage limits."],
  ["Acceptable use", "Do not abuse public APIs, bypass rate limits, attempt workspace isolation failures, or use Billabled to process unlawful, harmful, or unauthorized data."],
  ["Changes", "Product functionality, limits, pricing, and these terms may change. Material paid-plan changes should be communicated before they affect active customers."],
];

export default function TermsPage() {
  return (
    <main className="bg-[#f6f3ee] px-6 pb-20 pt-32 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Legal</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Terms of service</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">Last updated May 4, 2026. This launch-ready summary should be reviewed by counsel before broad paid advertising.</p>
        <div className="mt-10 space-y-4">
          {TERMS.map(([title, body]) => (
            <section key={title} className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
              <h2 className="text-2xl font-semibold">{title}</h2>
              <p className="mt-2 leading-7 text-slate-600">{body}</p>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
