import { NextResponse } from "next/server";
import { ForbiddenError, requireRole, requireSession, UnauthorizedError } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { db } from "@/lib/db";
import { users, workspaces, memberships, timeEntries } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("owner", session.role);

    if (!isAdminEmail(session.email)) {
      throw new ForbiddenError("Admin access requires a @kevinbytes.com email address.");
    }

    const allUsers = await db.select().from(users);
    const mappedUsers = allUsers.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName ?? null,
      timezone: u.timezone,
      createdAt: u.createdAt,
    }));

    const allMemberships = await db.select().from(memberships);

    const allWorkspaces = await db.select().from(workspaces);
    const mappedWorkspaces = allWorkspaces.map((w) => ({
      id: w.id,
      slug: w.slug,
      name: w.name,
      baseCurrency: w.baseCurrency,
      createdAt: w.createdAt,
      memberCount: allMemberships.filter((m) => m.workspaceId === w.id).length,
    }));

    const mappedMemberships = allMemberships.map((m) => ({
      userId: m.userId,
      workspaceId: m.workspaceId,
      role: m.role,
    }));

    const [{ count: entriesCount }] = await db.select({ count: sql<number>`cast(count(*) as int)` }).from(timeEntries);

    return NextResponse.json({
      ok: true,
      stats: {
        totalUsers: allUsers.length,
        totalWorkspaces: allWorkspaces.length,
        totalEntries: entriesCount,
        totalMemberships: allMemberships.length,
      },
      users: mappedUsers,
      workspaces: mappedWorkspaces,
      memberships: mappedMemberships,
    });
  } catch (error) {
    const status = error instanceof UnauthorizedError ? 401 : error instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
