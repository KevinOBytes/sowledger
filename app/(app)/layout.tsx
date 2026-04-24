import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  try {
    const session = await requireSession();
    if (session.role === "client") {
      redirect("/client");
    }
  } catch {
    redirect("/login");
  }

  return (
    <div className="app-shell-bg flex min-h-screen text-[#17211d]">
      <Sidebar />
      <div className="relative w-full flex-1 overflow-x-hidden pb-[80px] md:ml-72 md:pb-0">
        {children}
      </div>
    </div>
  );
}
