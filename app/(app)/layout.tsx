import { Sidebar } from "@/components/sidebar";
import { requireSession } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { redirect } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof requireSession>>;

  try {
    session = await requireSession();
  } catch {
    redirect("/login");
  }

  if (session.role === "client") {
    redirect("/client");
  }

  return (
    <div className="app-shell-bg flex min-h-screen text-[#17211d]">
      <Sidebar isSiteAdmin={isAdminEmail(session.email)} />
      <div className="relative min-h-screen w-full flex-1 overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:ml-72 md:pb-0">
        {children}
      </div>
    </div>
  );
}
