import "server-only";

import { redirect } from "next/navigation";
import { requireSession, UnauthorizedError } from "@/lib/auth";

/** Page-only boundary: layouts can redirect after child payloads have rendered. */
export async function requireTeamPageSession() {
  let session: Awaited<ReturnType<typeof requireSession>>;
  try {
    // Keep current membership/role verification and workspace identity in auth.
    session = await requireSession();
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error;
    redirect("/login");
  }

  // Keep redirects outside the session catch; never swallow Next control flow.
  if (session.role === "client") redirect("/client");
  if (session.role !== "member" && session.role !== "manager" && session.role !== "owner") redirect("/login");
  return session;
}
