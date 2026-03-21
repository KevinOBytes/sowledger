import { NextResponse } from "next/server";
import { ForbiddenError, requireRole, requireSession, UnauthorizedError } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { store } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("owner", session.role);

    if (!isAdminEmail(session.email)) {
      throw new ForbiddenError("Admin access requires a @kevinbytes.com email address.");
    }

    const users = [...store.users.values()].map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName ?? null,
      timezone: u.timezone,
      createdAt: u.createdAt,
    }));

    const workspaces = [...store.workspaces.values()].map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      baseCurrency: w.baseCurrency,
      createdAt: w.createdAt,
      memberCount: store.memberships.filter((m) => m.workspaceId === w.id).length,
    }));

    const memberships = store.memberships.map((m) => ({
      userId: m.userId,
      workspaceId: m.workspaceId,
      role: m.role,
    }));

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: store.users.size,
        totalWorkspaces: store.workspaces.size,
        totalEntries: store.entries.size,
        totalMemberships: store.memberships.length,
      },
      users,
      workspaces,
      memberships,
    });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
