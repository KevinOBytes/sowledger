import Link from "next/link";
import { ArrowRight, Code2, CreditCard, LifeBuoy, Mail, ShieldCheck, Sparkles } from "lucide-react";

const CONTACT_TASKS = [
  {
    title: "Product and account support",
    body: "Send workspace name, account email, page involved, browser, timestamp, and safe reproduction steps.",
    href: "/support",
    label: "Open support",
    icon: LifeBuoy,
  },
  {
    title: "Billing",
    body: "Send workspace name, account email, selected plan, Stripe receipt, date, and the billing behavior you expected.",
    href: "/billing-policy",
    label: "Read billing policy",
    icon: CreditCard,
  },
  {
    title: "API and security",
    body: "Send endpoint paths, request IDs if available, timestamps, scopes involved, and safe metadata. Never send API keys or bearer tokens.",
    href: "/support/api",
    label: "Open API guide",
    icon: Code2,
  },
  {
    title: "Sales and onboarding",
    body: "Send team size, current billing workflow, invoice/export needs, API or webhook requirements, and target onboarding timing.",
    href: "/#pricing",
    label: "View plans",
    icon: Sparkles,
  },
];

export const metadata = {
  title: "Contact - Billabled",
  description: "Contact Billabled for product support, billing, API/security questions, sales, and onboarding without sending secrets.",
};

export default function ContactPage() {
  return (
    <div className="bg-background px-4 pb-20 pt-12 text-slate-950 sm:px-6 lg:pt-16">
      <div className="mx-auto max-w-7xl">
        <section className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-surface px-4 py-1.5 text-sm font-bold text-cyan-800 shadow-sm">
              <Mail className="h-4 w-4" />
              Contact
            </p>
            <h1 className="mt-6 text-4xl font-semibold tracking-tight sm:text-6xl">Contact Billabled with the right context.</h1>
            <p className="mt-5 max-w-3xl text-lg leading-8 text-slate-700">
              Use one support address for product, account, billing, API, security, sales, and onboarding questions. Include safe context so the issue can be reproduced without exposing secrets.
            </p>
          </div>
          <div className="rounded-2xl border border-border bg-surface p-6 shadow-xl shadow-stone-900/10">
            <h2 className="text-2xl font-semibold">Email support</h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Keep API keys, bearer tokens, passwords, card numbers, and private customer data out of the initial message.
            </p>
            <a href="mailto:support@billabled.com" className="mt-5 inline-flex items-center justify-center gap-2 rounded-full bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">
              support@billabled.com
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </section>

        <section className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {CONTACT_TASKS.map((task) => {
            const Icon = task.icon;
            return (
              <section key={task.title} className="rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5">
                <Icon className="h-6 w-6 text-cyan-700" />
                <h2 className="mt-4 text-xl font-semibold">{task.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{task.body}</p>
                <Link href={task.href} className="mt-5 inline-flex items-center gap-2 text-sm font-bold text-cyan-800 transition hover:text-cyan-600">
                  {task.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </section>
            );
          })}
        </section>

        <section className="mt-10 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="rounded-2xl bg-slate-950 p-7 text-white shadow-sm">
            <ShieldCheck className="h-6 w-6 text-cyan-300" />
            <h2 className="mt-4 text-3xl font-semibold">Security reports</h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              Include the affected route, workspace context, timestamp, and safe reproduction details. Do not include full key values, tokens, passwords, or payment data.
            </p>
          </div>
          <div className="grid gap-3 rounded-2xl border border-border bg-surface p-6 shadow-sm shadow-stone-900/5 sm:grid-cols-2">
            <Link href="/security" className="rounded-xl border border-border bg-background/60 p-4 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700">Security posture</Link>
            <Link href="/support/api" className="rounded-xl border border-border bg-background/60 p-4 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700">API support</Link>
            <Link href="/support" className="rounded-xl border border-border bg-background/60 p-4 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700">Support home</Link>
            <Link href="/billing-policy" className="rounded-xl border border-border bg-background/60 p-4 text-sm font-bold text-slate-800 transition hover:border-cyan-300 hover:text-cyan-700">Billing policy</Link>
          </div>
        </section>
      </div>
    </div>
  );
}
