export const WORKFLOW = [
  { step: "Plan your day", detail: "Set aside time for project work, meetings, and follow-up on your calendar." },
  { step: "Track as you work", detail: "Start a timer for the task at hand. Keep separate timers when you switch between projects." },
  { step: "Add missed time", detail: "Log completed work by hand or turn a finished calendar block into a time entry." },
  { step: "Review the week", detail: "Check planned hours against actual time and see how much of your work is billable." },
  { step: "Approve and invoice", detail: "Review entries, approve billable time, and create an invoice or export the details." },
  { step: "Connect your tools", detail: "Use the API and webhooks to bring work records into your reporting and other systems." },
];

interface WorkflowSectionProps {
  headline: string;
  subhead: string;
}

export function WorkflowSection({ headline, subhead }: WorkflowSectionProps) {
  return (
    <section id="workflow" className="scroll-mt-20 border-b border-border bg-surface px-4 py-14 sm:px-6">
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
