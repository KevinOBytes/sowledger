export const WORKFLOW = [
  { step: "Plan work", detail: "Put intended work on the calendar before the day gets noisy." },
  { step: "Track live timers", detail: "Capture active work without losing concurrent context." },
  { step: "Log manual/calendar time", detail: "Backfill completed work and import planned blocks." },
  { step: "Review analytics", detail: "Compare plan, timer, manual, utilization, and billable output." },
  { step: "Approve/invoice/export", detail: "Move corrected work into proof packs and digest-backed exports." },
  { step: "Integrate by API", detail: "Sync scoped proof data into agency, finance, and reporting systems." },
];

interface WorkflowSectionProps {
  headline: string;
  subhead: string;
}

export function WorkflowSection({ headline, subhead }: WorkflowSectionProps) {
  return (
    <section id="workflow" className="border-b border-border bg-surface px-4 py-14 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-5 lg:grid-cols-[0.75fr_1fr] lg:items-end">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Workflow</p>
            <h2 className="mt-3 max-w-3xl text-3xl font-semibold tracking-tight sm:text-5xl">
              {headline}
            </h2>
          </div>
          <p className="max-w-2xl text-base leading-7 text-slate-600">
            {subhead}
          </p>
        </div>
        <div className="mt-8 divide-y divide-border border-y border-border">
          {WORKFLOW.map((item, index) => (
            <div key={item.step} className="grid gap-3 py-5 md:grid-cols-[6rem_18rem_1fr] md:items-center">
              <p className="font-mono text-xs font-black uppercase tracking-[0.22em] text-cyan-700">0{index + 1}</p>
              <h3 className="text-xl font-semibold">{item.step}</h3>
              <p className="text-sm leading-6 text-slate-600">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
