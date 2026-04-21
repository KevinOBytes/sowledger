"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ProfileMenuProps = {
  email: string;
  isAdmin: boolean;
};

export function ProfileMenu({ email, isAdmin }: ProfileMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initials = email
    .split("@")[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-sm font-semibold text-white ring-2 ring-transparent transition hover:ring-cyan-400 focus:outline-none focus:ring-cyan-400"
        aria-label="Open profile menu"
        aria-expanded={open}
      >
        {initials}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-52 rounded-xl border border-slate-700 bg-slate-900 py-1 shadow-xl">
          {/* User info */}
          <div className="border-b border-slate-700 px-4 py-3">
            <p className="truncate text-xs font-medium text-white">{email}</p>
            {isAdmin && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-cyan-900/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-400">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                  <path fillRule="evenodd" d="M8 1a5 5 0 1 1 0 10A5 5 0 0 1 8 1Zm0 2a3 3 0 1 0 0 6A3 3 0 0 0 8 3ZM3.25 11.5a.75.75 0 0 0 0 1.5h9.5a.75.75 0 0 0 0-1.5h-9.5Z" clipRule="evenodd" />
                </svg>
                Admin
              </span>
            )}
          </div>

          {/* Menu items */}
          <div className="py-1">
            {isAdmin && (
              <button
                onClick={() => { setOpen(false); router.push("/admin"); }}
                className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-cyan-500">
                  <path fillRule="evenodd" d="M9.293 2.293a1 1 0 0 1 1.414 0l7 7A1 1 0 0 1 17 11h-1v6a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3a1 1 0 0 0-1-1H9a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-6H3a1 1 0 0 1-.707-1.707l7-7Z" clipRule="evenodd" />
                </svg>
                Admin Dashboard
              </button>
            )}

            <button
              onClick={() => { setOpen(false); router.push("/settings"); }}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400">
                <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .205 1.251l-1.18 2.044a1 1 0 0 1-1.186.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.992 6.992 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
              </svg>
              User Settings
            </button>
          </div>

          <div className="border-t border-slate-700 py-1">
            <button
              onClick={handleLogout}
              className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800 hover:text-rose-400"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400">
                <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
              </svg>
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
