import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Ensure the user is actually authenticated before rendering the shell
  try {
    const session = await requireSession();
    if (session.role === "client") {
      redirect("/client");
    }
  } catch {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen bg-[#050914] text-slate-200">
      <Sidebar />
      <div className="flex-1 relative md:ml-64 w-full pb-[80px] md:pb-0 overflow-x-hidden">
        {children}
      </div>
    </div>
  );
}
