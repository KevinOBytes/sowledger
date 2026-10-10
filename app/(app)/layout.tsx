import { Sidebar } from "@/components/sidebar";
import { requireSession, UnauthorizedError } from "@/lib/auth";
import { WorkspaceLoadError } from "@/components/workspace-load-error";
import { redirect, unstable_rethrow } from "next/navigation";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session: Awaited<ReturnType<typeof requireSession>>;

  try {
    session = await requireSession();
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof UnauthorizedError) redirect("/login");
    console.error("Workspace session could not be loaded", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return <WorkspaceLoadError />;
  }

  if (session.role === "client") {
    redirect("/client");
  }

  return (
    <div className="app-shell-bg flex min-h-screen text-[#17211d]">
      <Sidebar />
      <div className="relative min-h-screen w-full flex-1 overflow-x-hidden pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:ml-72 md:pb-0">
        {children}
      </div>
    </div>
  );
}
