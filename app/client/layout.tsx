import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { LogOut, Zap } from "lucide-react";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
    if (session.role !== "client") {
      redirect("/");
    }
  } catch {
    redirect("/login");
  }

  return (
    <div className="min-h-screen bg-[#050914] text-slate-200 flex flex-col font-sans">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/5 bg-slate-900/50 px-6 backdrop-blur sticky top-0 z-50">
        <div className="flex items-center gap-2 text-cyan-500">
          <Zap className="h-6 w-6" />
          <span className="text-lg font-bold tracking-wider text-white">Timely <span className="text-cyan-500 font-medium">Client</span></span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-400 hidden sm:block">{session.email}</span>
          <Link href="/api/auth/logout" className="flex items-center gap-2 rounded-lg bg-slate-800/50 px-3 py-1.5 text-sm font-medium text-slate-400 transition hover:bg-rose-500/10 hover:text-rose-400">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </Link>
        </div>
      </header>
      <main className="flex-1 w-full p-4 sm:p-8 md:p-12">
        <div className="mx-auto max-w-6xl w-full">
           {children}
        </div>
      </main>
    </div>
  );
}
