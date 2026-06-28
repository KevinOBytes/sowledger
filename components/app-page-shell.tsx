import type { ComponentType, ReactNode } from "react";
import {
  BarChart3,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Plug,
  type LucideIcon,
} from "lucide-react";

type IconComponent = ComponentType<{ className?: string }>;

type Tone = "slate" | "cyan" | "emerald" | "amber" | "rose";

function cx(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

const toneClasses: Record<Tone, { badge: string; icon: string; metric: string; rail: string }> = {
  slate: {
    badge: "border-slate-200 bg-slate-50 text-slate-600",
    icon: "bg-slate-100 text-slate-600",
    metric: "text-slate-950",
    rail: "border-slate-200 bg-white text-slate-600",
  },
  cyan: {
    badge: "border-cyan-200 bg-cyan-50 text-cyan-700",
    icon: "bg-cyan-50 text-cyan-700",
    metric: "text-cyan-700",
    rail: "border-cyan-200 bg-cyan-50 text-cyan-800",
  },
  emerald: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-700",
    icon: "bg-emerald-50 text-emerald-700",
    metric: "text-emerald-700",
    rail: "border-emerald-200 bg-emerald-50 text-emerald-800",
  },
  amber: {
    badge: "border-amber-200 bg-amber-50 text-amber-700",
    icon: "bg-amber-50 text-amber-700",
    metric: "text-amber-700",
    rail: "border-amber-200 bg-amber-50 text-amber-800",
  },
  rose: {
    badge: "border-rose-200 bg-rose-50 text-rose-700",
    icon: "bg-rose-50 text-rose-700",
    metric: "text-rose-700",
    rail: "border-rose-200 bg-rose-50 text-rose-800",
  },
};

const shellWidths = {
  standard: "max-w-6xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

export type AppPageShellProps = {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  width?: keyof typeof shellWidths;
};

export function AppPageShell({ children, className, contentClassName, width = "wide" }: AppPageShellProps) {
  return (
    <main className={cx("min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8", className)}>
      <div className={cx("mx-auto w-full space-y-6", shellWidths[width], contentClassName)}>{children}</div>
    </main>
  );
}

export type AppHeaderBadge = {
  label: string;
  tone?: Tone;
  icon?: IconComponent;
};

export type AppPageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  icon?: IconComponent;
  metadata?: AppHeaderBadge[];
  primaryAction?: ReactNode;
  secondaryAction?: ReactNode;
  className?: string;
};

export function AppPageHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  metadata,
  primaryAction,
  secondaryAction,
  className,
}: AppPageHeaderProps) {
  return (
    <header className={cx("rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm", className)}>
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow && <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">{eyebrow}</p>}
          <div className="mt-2 flex items-center gap-3">
            {Icon && (
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
                <Icon className="h-5 w-5" />
              </span>
            )}
            <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">{title}</h1>
          </div>
          {description && <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>}
          {metadata && metadata.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {metadata.map((badge) => {
                const BadgeIcon = badge.icon;
                const tone = badge.tone ?? "slate";
                return (
                  <span
                    key={badge.label}
                    className={cx(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold",
                      toneClasses[tone].badge,
                    )}
                  >
                    {BadgeIcon && <BadgeIcon className="h-3.5 w-3.5" />}
                    {badge.label}
                  </span>
                );
              })}
            </div>
          )}
        </div>
        {(primaryAction || secondaryAction) && (
          <div className="flex flex-wrap items-center gap-2">
            {secondaryAction}
            {primaryAction}
          </div>
        )}
      </div>
    </header>
  );
}

export type AppMetricCardProps = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  accent?: Tone;
  icon?: IconComponent;
  className?: string;
};

export function AppMetricCard({ label, value, detail, accent = "slate", icon: Icon, className }: AppMetricCardProps) {
  return (
    <article className={cx("rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <p className={cx("mt-2 text-3xl font-semibold tracking-tight", toneClasses[accent].metric)}>{value}</p>
          {detail && <p className="mt-1 text-sm leading-5 text-slate-500">{detail}</p>}
        </div>
        {Icon && (
          <span className={cx("flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl", toneClasses[accent].icon)}>
            <Icon className="h-5 w-5" />
          </span>
        )}
      </div>
    </article>
  );
}

export type AppEmptyStateProps = {
  icon?: IconComponent;
  title: string;
  description: string;
  action?: ReactNode;
  className?: string;
};

export function AppEmptyState({ icon: Icon, title, description, action, className }: AppEmptyStateProps) {
  return (
    <section className={cx("rounded-[32px] border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm", className)}>
      {Icon && (
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-50 text-cyan-700">
          <Icon className="h-6 w-6" />
        </div>
      )}
      <h2 className="mt-4 text-xl font-semibold text-slate-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">{description}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </section>
  );
}

export type WorkflowStageId = "plan" | "track" | "log" | "review" | "approve" | "integrate";

export type WorkflowRailItem = {
  id: WorkflowStageId;
  label: string;
  description: string;
  icon: LucideIcon;
};

export const SOWLEDGER_WORKFLOW_STAGES: WorkflowRailItem[] = [
  { id: "plan", label: "Plan", description: "Shape scheduled work", icon: CalendarDays },
  { id: "track", label: "Track", description: "Run live timers", icon: Clock3 },
  { id: "log", label: "Log", description: "Add manual or calendar time", icon: CheckCircle2 },
  { id: "review", label: "Review", description: "Correct activity and analytics", icon: BarChart3 },
  { id: "approve", label: "Approve / Invoice / Export", description: "Move proof into billing output", icon: FileCheck2 },
  { id: "integrate", label: "Integrate", description: "Connect API and webhooks", icon: Plug },
];

export type AppWorkflowRailProps = {
  current?: WorkflowStageId;
  items?: WorkflowRailItem[];
  className?: string;
};

export function AppWorkflowRail({ current, items = SOWLEDGER_WORKFLOW_STAGES, className }: AppWorkflowRailProps) {
  return (
    <section aria-label="SOWLedger workflow" className={cx("rounded-[32px] border border-slate-200 bg-white p-4 shadow-sm", className)}>
      <ol className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {items.map((item, index) => {
          const Icon = item.icon;
          const active = current === item.id;
          return (
            <li key={item.id} className="relative min-w-0" aria-current={active ? "step" : undefined}>
              {index > 0 && <span className="absolute -left-2 top-6 hidden h-px w-2 bg-slate-200 xl:block" aria-hidden="true" />}
              <div
                className={cx(
                  "h-full rounded-2xl border px-3 py-3",
                  active ? toneClasses.cyan.rail : toneClasses.slate.rail,
                )}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <Icon className={cx("mt-0.5 h-4 w-4 shrink-0", active ? "text-cyan-700" : "text-slate-400")} />
                  <span className="min-w-0 break-words text-sm font-bold leading-5">{item.label}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">{item.description}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
