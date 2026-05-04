import Link from "next/link";

export const metadata = { title: "Contact - Billabled" };

export default function ContactPage() {
  return (
    <main className="bg-[#f6f3ee] px-6 pb-20 pt-32 text-slate-950">
      <div className="mx-auto max-w-4xl">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Support</p>
        <h1 className="mt-4 text-5xl font-semibold tracking-tight sm:text-7xl">Contact Billabled</h1>
        <p className="mt-5 text-lg leading-8 text-slate-600">For launch support, include your workspace name, account email, the page or endpoint involved, and any safe reproduction details.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">Product and account support</h2>
            <p className="mt-2 leading-7 text-slate-600">Use this for signup, workspace setup, billing, exports, invoices, and onboarding questions.</p>
            <a href="mailto:support@billabled.com" className="mt-5 inline-flex rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">support@billabled.com</a>
          </div>
          <div className="rounded-[28px] border border-stone-200 bg-white p-6 shadow-sm">
            <h2 className="text-2xl font-semibold">API and security</h2>
            <p className="mt-2 leading-7 text-slate-600">For API usage, webhook behavior, or security concerns, include endpoint paths, timestamps, and safe metadata.</p>
            <Link href="/support/api" className="mt-5 inline-flex rounded-full border border-stone-200 px-5 py-3 text-sm font-bold text-slate-800 hover:border-cyan-200 hover:text-cyan-700">Open API guide</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
