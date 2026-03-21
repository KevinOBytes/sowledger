"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Clock, FolderKanban, CalendarDays, Settings, LogOut } from "lucide-react";

export function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { name: "Timer", href: "/", icon: Clock },
    { name: "Projects", href: "/projects", icon: FolderKanban },
    { name: "Calendar", href: "/calendar", icon: CalendarDays },
    { name: "Settings", href: "/settings/actions", icon: Settings },
  ];

  return (
    <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-800 bg-[#050914]">
      {/* Brand */}
      <div className="flex h-16 shrink-0 items-center px-6">
        <span className="text-xl font-bold tracking-tight text-white">Timely</span>
        <span className="ml-2 rounded-full bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-cyan-400 uppercase">Pro</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 px-4 py-4">
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all ${
                isActive
                  ? "bg-cyan-500/10 text-cyan-400"
                  : "text-slate-400 hover:bg-slate-800/50 hover:text-slate-100"
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}`} />
              {item.name}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-slate-800 p-4">
        <Link
          href="/api/auth/logout"
          className="group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-all hover:bg-red-500/10 hover:text-red-400"
        >
          <LogOut className="h-4 w-4 text-slate-500 group-hover:text-red-400" />
          Sign out
        </Link>
      </div>
    </aside>
  );
}
