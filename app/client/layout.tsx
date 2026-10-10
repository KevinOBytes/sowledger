import { requireSession, UnauthorizedError } from "@/lib/auth";
import { WorkspaceLoadError } from "@/components/workspace-load-error";
import { WorkspaceSwitcher } from "@/components/workspace-switcher";
import { redirect, unstable_rethrow } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { LogOut } from "lucide-react";

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UnauthorizedError) redirect("/login");
    console.error("Client workspace could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <WorkspaceLoadError />;
  }
  if (session.role !== "client") redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-[#f6f3ee] text-slate-950">
      <header className="sticky top-0 z-50 flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-stone-200/70 bg-[#fffdf8]/90 px-4 py-3 shadow-sm shadow-stone-900/5 backdrop-blur sm:px-6">
        <div className="flex items-center gap-2 text-cyan-700">
          <Image src="/logo.png" alt="SOWLedger" width={28} height={28} className="rounded-md" unoptimized />
          <span className="text-lg font-bold tracking-tight text-slate-950">SOWLedger <span className="font-medium text-cyan-700">Client</span></span>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="w-40 sm:w-48"><WorkspaceSwitcher /></div>
          <span className="hidden text-sm font-medium text-stone-500 sm:block">{session.email}</span>
          <Link href="/api/auth/logout" aria-label="Sign out" className="flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-3 py-1.5 text-sm font-bold text-stone-600 transition hover:border-rose-200 hover:text-rose-700">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Sign out</span>
          </Link>
        </div>
      </header>
      <main className="w-full flex-1 p-4 sm:p-8 md:p-12">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
