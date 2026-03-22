import { setSessionCookie } from "@/lib/auth";
import { ensureUser, ensureWorkspace, ensureMembership } from "@/lib/store";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  
  console.log("HELLO FROM API TEST LOGIN");
  
  const { searchParams } = new URL(request.url);
  const planParam = searchParams.get("plan") || "free";
  const plan = planParam as "free" | "pro" | "smb" | "enterprise";
  
  try {
    const email = "test-e2e@example.com";
    const user = await ensureUser(email);
    const workspace = await ensureWorkspace("test-workspace-e2e");
    await ensureMembership(user.id, workspace.id, "owner");
    
    // Set the requested plan for paywall testing
    await db.update(workspaces).set({ plan }).where(eq(workspaces.id, workspace.id));
    
    // Cleanup prior test state to prevent 402 limits limits
    const { projects, projectTasks, timeEntries } = await import("@/lib/db/schema");
    await db.delete(projectTasks).where(eq(projectTasks.workspaceId, workspace.id));
    await db.delete(projects).where(eq(projects.workspaceId, workspace.id));
    await db.delete(timeEntries).where(eq(timeEntries.workspaceId, workspace.id));
    
    await setSessionCookie({
      sub: user.id,
      email: user.email,
      workspaceId: workspace.id,
      role: "owner"
    });
    
    return NextResponse.json({ success: true, userId: user.id, workspaceId: workspace.id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
