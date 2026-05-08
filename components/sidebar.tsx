"use client";

import { useEffect, useState, type ComponentType } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Bell,
  Building2,
  CalendarDays,
  CheckSquare,
  Clock,
  Code2,
  FileDown,
  FolderKanban,
  LayoutList,
  LogOut,
  Plus,
  Plug,
  Receipt,
  Settings,
  Tag,
  UserRound,
  Users,
  Webhook,
} from "lucide-react";

import { BILLABLED_WORKFLOW_STAGES } from "@/components/app-page-shell";
import { ManualTimeDialog } from "@/components/manual-time-dialog";

type NavItem = {
  name: string;
  description?: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  prefix?: string;
  exact?: boolean;
  showBadge?: boolean;
};

type NavSection = {
  label: string;
  summary: string;
  items: NavItem[];
};

function routeIsActive(pathname: string, item: NavItem) {
  if (item.exact) return pathname === item.href;
  if (pathname === item.href) return true;
  const prefix = item.prefix ?? `${item.href}/`;
  return pathname.startsWith(prefix);
}

function navItemLabel(item: NavItem, unreadCount: number) {
  return item.showBadge && unreadCount > 0 ? `${item.name}, ${unreadCount} unread` : item.name;
}

const workflowSteps = BILLABLED_WORKFLOW_STAGES.map((stage) => stage.label);

const navSections: NavSection[] = [
  {
    label: "Plan",
    summary: "Shape work before time is captured.",
    items: [
      { name: "Dashboard", description: "Today, focus timer, quick log", href: "/dashboard", icon: Clock },
      { name: "Calendar", description: "Schedule work and calendar time", href: "/calendar", icon: CalendarDays },
      { name: "Planner", description: "Capacity and work allocation", href: "/planner", icon: Users },
      { name: "Projects", description: "Tasks, boards, billing context", href: "/projects", icon: FolderKanban },
      { name: "Clients", description: "Client records and billing proof", href: "/clients", icon: Building2 },
    ],
  },
  {
    label: "Track and log",
    summary: "Capture live and completed work.",
    items: [
      { name: "Activity", description: "Review and correct entries", href: "/activity", icon: LayoutList },
      { name: "Tags", description: "Label work for reports", href: "/settings/tags", icon: Tag },
    ],
  },
  {
    label: "Review",
    summary: "Turn time into operational signal.",
    items: [
      { name: "Analytics", description: "Plan vs actual, utilization, output", href: "/reports", icon: BarChart3 },
      { name: "Notifications", description: "Unread review queue", href: "/notifications", icon: Bell, showBadge: true },
    ],
  },
  {
    label: "Approve and bill",
    summary: "Move proof into invoice-ready output.",
    items: [
      { name: "Approvals", description: "Approve or reject time", href: "/approvals", icon: CheckSquare },
      { name: "Invoices", description: "Proof packs and billing records", href: "/invoices", icon: Receipt },
      { name: "Exports", description: "CSV and JSON with digest", href: "/exports", icon: FileDown },
    ],
  },
  {
    label: "Integrate",
    summary: "Connect Billabled to external systems.",
    items: [
      { name: "Integrations", description: "Calendar, Slack, accounting", href: "/integrations", icon: Plug },
      { name: "Developers", description: "API keys, scopes, docs", href: "/settings/developers", icon: Code2 },
      { name: "Webhooks", description: "Event delivery controls", href: "/settings/webhooks", icon: Webhook },
    ],
  },
  {
    label: "Workspace",
    summary: "Operate the workspace and plan.",
    items: [
      { name: "People", description: "Members and client contacts", href: "/people", icon: UserRound },
      { name: "Workspace", description: "Profile and workspace defaults", href: "/settings", icon: Settings, exact: true },
      { name: "Billing", description: "Plan and subscription", href: "/settings/billing", icon: Receipt },
    ],
  },
];

const mobileNav: NavItem[] = [
  { name: "Timer", href: "/dashboard", icon: Clock },
  { name: "Calendar", href: "/calendar", icon: CalendarDays },
  { name: "Activity", href: "/activity", icon: LayoutList },
  { name: "Analytics", href: "/reports", icon: BarChart3 },
  { name: "More", href: "/settings", icon: Settings, prefix: "/settings", showBadge: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [manualOpen, setManualOpen] = useState(false);

  useEffect(() => {
    async function fetchNotifications() {
      try {
        const res = await fetch("/api/notifications");
        if (res.ok) {
          const data = await res.json();
          const unread = data.notifications?.filter((n: { read: boolean }) => !n.read).length || 0;
          setUnreadCount(unread);
        }
      } catch {
        // Notification count should never block navigation rendering.
      }
    }
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 flex-col border-r border-stone-200/80 bg-[#fffdf8]/95 shadow-[16px_0_50px_rgba(65,52,37,0.08)] backdrop-blur md:flex">
        <div className="border-b border-stone-200/70 px-5 py-5">
          <Link href="/dashboard" className="flex items-center transition hover:opacity-80">
            <Image src="/logo.png" alt="Billabled" width={30} height={30} className="mr-3 rounded-lg" unoptimized />
            <div>
              <p className="text-lg font-semibold tracking-tight text-[#17211d]">Billabled</p>
              <p className="text-xs font-medium text-stone-500">Internal billing control surface</p>
            </div>
          </Link>
          <div className="mt-4 rounded-2xl border border-teal-100 bg-teal-50/70 p-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-teal-800">Workflow</p>
            <ol className="mt-2 grid grid-cols-2 gap-1.5" aria-label={workflowSteps.join(", ")}>
              {workflowSteps.map((step) => (
                <li key={step} className="rounded-xl bg-white/80 px-2 py-1 text-center text-[10px] font-bold leading-tight text-teal-900 shadow-sm shadow-teal-950/5">
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-3 py-4" aria-label="Internal application navigation">
          {navSections.map((section) => (
            <section key={section.label} className="mb-5">
              <div className="px-2 pb-2">
                <h2 className="text-[11px] font-bold uppercase tracking-[0.22em] text-stone-400">{section.label}</h2>
                <p className="mt-1 text-[11px] leading-4 text-stone-400">{section.summary}</p>
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = routeIsActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={navItemLabel(item, unreadCount)}
                      className={`group flex items-center justify-between gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "bg-[#163c36] text-white shadow-sm shadow-teal-950/10"
                          : "text-stone-600 hover:bg-[#f2ece2] hover:text-[#17211d]"
                      }`}
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span
                          className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
                            isActive ? "bg-white/10 text-teal-100" : "bg-white text-stone-400 shadow-sm shadow-stone-950/5 group-hover:text-teal-700"
                          }`}
                        >
                          <Icon className="h-4 w-4" aria-hidden="true" />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate">{item.name}</span>
                          {item.description && (
                            <span aria-hidden="true" className={`mt-0.5 block truncate text-[11px] font-medium ${isActive ? "text-teal-100/80" : "text-stone-400"}`}>
                              {item.description}
                            </span>
                          )}
                        </span>
                      </span>
                      {item.showBadge && unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </nav>

        <div className="border-t border-stone-200/70 p-4">
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-[#163c36] px-3 py-2.5 text-sm font-bold text-white shadow-sm shadow-teal-950/10 transition hover:bg-[#23544b]"
          >
            <Plus className="h-4 w-4" />
            Quick time entry
          </button>
          <Link href="/support/api" className="mb-2 flex items-center gap-3 rounded-2xl bg-teal-50 px-3 py-2.5 text-sm font-semibold text-teal-800 transition hover:bg-teal-100">
            <Code2 className="h-4 w-4" />
            API guide
          </Link>
          <Link
            href="/api/auth/logout"
            className="group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-stone-500 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4 text-stone-400 group-hover:text-rose-500" />
            Sign out
          </Link>
        </div>
      </aside>

      <nav
        className="fixed bottom-0 left-0 z-50 grid w-full grid-cols-5 gap-1 border-t border-stone-200 bg-[#fffdf8]/95 px-2 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-12px_35px_rgba(65,52,37,0.08)] backdrop-blur md:hidden"
        aria-label="Mobile application navigation"
      >
        {mobileNav.map((item) => {
          const isActive = routeIsActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              aria-label={navItemLabel(item, unreadCount)}
              className={`relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 transition ${
                isActive ? "bg-[#163c36] text-white" : "text-stone-500 hover:text-[#17211d]"
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="max-w-full truncate text-[10px] font-semibold">{item.name}</span>
              {item.showBadge && unreadCount > 0 && (
                <span className="absolute right-2 top-1 flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] font-bold text-white shadow-sm ring-2 ring-white" />
              )}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        onClick={() => setManualOpen(true)}
        className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#163c36] text-white shadow-xl shadow-teal-950/20 transition hover:bg-[#23544b] md:hidden"
        aria-label="Quick time entry"
      >
        <Plus className="h-6 w-6" />
      </button>

      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}
