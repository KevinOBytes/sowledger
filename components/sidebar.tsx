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
  Receipt,
  Settings,
  Tag,
  Users,
  Webhook,
} from "lucide-react";

import { ManualTimeDialog } from "@/components/manual-time-dialog";

type NavItem = {
  name: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
  prefix?: string;
  showBadge?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

function routeIsActive(pathname: string, item: NavItem) {
  if (pathname === item.href) return true;
  const prefix = item.prefix ?? `${item.href}/`;
  return pathname.startsWith(prefix);
}

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

  const navSections: NavSection[] = [
    {
      label: "Work",
      items: [
        { name: "Dashboard", href: "/dashboard", icon: Clock },
        { name: "Calendar", href: "/calendar", icon: CalendarDays },
        { name: "Activity", href: "/activity", icon: LayoutList },
      ],
    },
    {
      label: "Analyze",
      items: [
        { name: "Analytics", href: "/reports", icon: BarChart3 },
        { name: "Approvals", href: "/approvals", icon: CheckSquare },
        { name: "Invoices", href: "/invoices", icon: Receipt },
        { name: "Exports", href: "/exports", icon: FileDown },
      ],
    },
    {
      label: "Manage",
      items: [
        { name: "Projects", href: "/projects", icon: FolderKanban },
        { name: "Clients", href: "/clients", icon: Building2 },
        { name: "Planner", href: "/planner", icon: Users },
        { name: "Notifications", href: "/notifications", icon: Bell, showBadge: true },
      ],
    },
    {
      label: "Integrate",
      items: [
        { name: "Developers", href: "/settings/developers", icon: Code2 },
        { name: "Webhooks", href: "/settings/webhooks", icon: Webhook },
      ],
    },
    {
      label: "Settings",
      items: [
        { name: "Workspace", href: "/settings", icon: Settings },
        { name: "Billing", href: "/settings/billing", icon: Receipt },
        { name: "Tags", href: "/settings/tags", icon: Tag },
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

  return (
    <>
      <aside className="fixed inset-y-0 left-0 z-50 hidden w-72 flex-col border-r border-slate-200 bg-white/95 shadow-[16px_0_50px_rgba(15,23,42,0.06)] backdrop-blur md:flex">
        <div className="border-b border-slate-100 px-6 py-5">
          <Link href="/dashboard" className="flex items-center transition hover:opacity-80">
            <Image src="/logo.png" alt="Billabled" width={30} height={30} className="mr-3 rounded-lg" unoptimized />
            <div>
              <p className="text-lg font-semibold tracking-tight text-slate-950">Billabled</p>
              <p className="text-xs font-medium text-slate-400">Plan, track, invoice</p>
            </div>
          </Link>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
          {navSections.map((section) => (
            <div key={section.label} className="mb-5">
              <p className="px-2 pb-2 text-[11px] font-bold uppercase tracking-[0.22em] text-slate-400">{section.label}</p>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const isActive = routeIsActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`group flex items-center justify-between rounded-2xl px-3 py-2.5 text-sm font-semibold transition ${
                        isActive
                          ? "bg-slate-950 text-white shadow-sm"
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <Icon className={`h-4 w-4 ${isActive ? "text-cyan-300" : "text-slate-400 group-hover:text-cyan-700"}`} />
                        {item.name}
                      </span>
                      {item.showBadge && unreadCount > 0 && (
                        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                          {unreadCount}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => setManualOpen(true)}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-3 py-2.5 text-sm font-bold text-white transition hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Quick entry
          </button>
          <Link href="/support/api" className="mb-2 flex items-center gap-3 rounded-2xl bg-cyan-50 px-3 py-2.5 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100">
            <Code2 className="h-4 w-4" />
            API guide
          </Link>
          <Link
            href="/api/auth/logout"
            className="group flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-500 transition hover:bg-rose-50 hover:text-rose-600"
          >
            <LogOut className="h-4 w-4 text-slate-400 group-hover:text-rose-500" />
            Sign out
          </Link>
        </div>
      </aside>

      <nav className="fixed bottom-0 left-0 z-50 flex w-full items-center justify-around border-t border-slate-200 bg-white/95 px-2 py-3 pb-safe shadow-[0_-12px_35px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
        {mobileNav.map((item) => {
          const isActive = routeIsActive(pathname, item);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 transition ${
                isActive ? "bg-slate-950 text-white" : "text-slate-500 hover:text-slate-950"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span className="text-[10px] font-semibold">{item.name}</span>
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
        className="fixed bottom-24 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-xl shadow-slate-950/20 transition hover:bg-slate-800 md:hidden"
        aria-label="Quick time entry"
      >
        <Plus className="h-6 w-6" />
      </button>

      <ManualTimeDialog open={manualOpen} onOpenChange={setManualOpen} />
    </>
  );
}
