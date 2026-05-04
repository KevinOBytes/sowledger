export const metadata = { title: "Privacy - Billabled" };

const SECTIONS = [
  ["What we collect", "Account email, workspace metadata, clients, projects, time records, schedule records, billing identifiers, API key metadata, and support messages you submit."],
  ["How we use it", "We use workspace data to provide scheduling, timers, completed work logging, analytics, exports, invoices, API access, support, security monitoring, and billing operations."],
  ["What we do not store", "API key secrets are shown once and stored only as hashes. Payment card details are handled by Stripe, not stored directly by Billabled."],
  ["Data exports", "Workspace owners and managers can export operational data in CSV or JSON. Exports exclude secrets and include integrity headers where supported."],
  ["Retention", "Operational records stay available until deleted through product workflows or by a verified workspace request, subject to legal, billing, and security obligations."],
  ["Contact", "Privacy questions can be sent through the contact page. Include the workspace name and the email tied to your account."],
];

export default function PrivacyPage() {
  return (
    <main className="bg-[#f6f3ee] px-6 pb-20 pt-32 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Trust center</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Privacy notice</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">Last updated May 4, 2026. This page summarizes the product posture for launch readiness and should be reviewed by counsel before large-scale paid acquisition.</p>
        <div className="mt-10 space-y-4">
          {SECTIONS.map(([title, body]) => (
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
