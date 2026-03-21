import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ensure the user is actually authenticated before rendering the shell
  try {
    await requireSession();
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-[#050914] text-slate-200">
      <Sidebar />
      <div className="flex-1 relative ml-64 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
