import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projects, users } from "@/lib/db/schema";
import { eq, and, gte, lte } from "drizzle-orm";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const searchParams = req.nextUrl.searchParams;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");

    const conditions = [eq(timeEntries.workspaceId, session.workspaceId)];
    if (startDate) {
      conditions.push(gte(timeEntries.startedAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lte(timeEntries.stoppedAt, new Date(endDate)));
    }

    const filtered = await db.select().from(timeEntries).where(and(...conditions));
    
    // Process aggregations
    let totalDurationSeconds = 0;
    let totalBillableAmount = 0;

    const byDate: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const entry of filtered) {
      if (!entry.durationSeconds) continue;
      
      totalDurationSeconds += entry.durationSeconds;

      if (entry.hourlyRate) {
        totalBillableAmount += (entry.durationSeconds / 3600) * entry.hourlyRate;
      }

      const dayParams = entry.startedAt.toISOString().split("T")[0];
      byDate[dayParams] = (byDate[dayParams] || 0) + entry.durationSeconds;

      if (entry.projectId) {
        byProject[entry.projectId] = (byProject[entry.projectId] || 0) + entry.durationSeconds;
      }

      byUser[entry.userId] = (byUser[entry.userId] || 0) + entry.durationSeconds;
    }

    const projectIds = Object.keys(byProject);
    const projectList = projectIds.length > 0 ? await db.select().from(projects).where(eq(projects.workspaceId, session.workspaceId)) : [];
    const projectMap = new Map(projectList.map(p => [p.id, p]));

    const userIds = Object.keys(byUser);
    const userList = userIds.length > 0 ? await db.select().from(users) : [];
    const userMap = new Map(userList.map(u => [u.id, u]));

    const dailyTrend = Object.entries(byDate)
      .map(([date, seconds]) => ({ date, hours: seconds / 3600 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const projectDistribution = Object.entries(byProject).map(([projectId, seconds]) => {
      const proj = projectMap.get(projectId);
      return {
        projectId,
        name: proj?.name || "Unknown Project",
        hours: seconds / 3600,
      };
    });

    const userDistribution = Object.entries(byUser).map(([userId, seconds]) => {
      const u = userMap.get(userId);
      return {
        userId,
        email: u?.email || "Unknown User",
        hours: seconds / 3600,
      };
    });

    return NextResponse.json({
      ok: true,
      totalHours: totalDurationSeconds / 3600,
      totalBillableAmount,
      dailyTrend,
      projectDistribution,
      userDistribution,
    });
  } catch (error) {
    const err = error as Record<string, unknown>;
    const status = err.code === "FORBIDDEN" || err.status === 403 ? 403 : 401;
    return NextResponse.json({ error: (error as Error).message }, { status });
  }
}
