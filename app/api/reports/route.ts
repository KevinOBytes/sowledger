import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projects, users, scheduledWorkBlocks } from "@/lib/db/schema";
import { eq, and, gte, inArray, lt } from "drizzle-orm";

function endExclusive(value: string) {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const searchParams = req.nextUrl.searchParams;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const scope = searchParams.get("scope") ?? "mine";
    const projectId = searchParams.get("projectId");

    if (scope === "team") {
      requireRole("manager", session.role);
    } else {
      requireRole("member", session.role);
    }

    const conditions = [eq(timeEntries.workspaceId, session.workspaceId)];
    if (scope !== "team") {
      conditions.push(eq(timeEntries.userId, session.sub));
    }
    if (projectId) {
      conditions.push(eq(timeEntries.projectId, projectId));
    }
    if (startDate) {
      conditions.push(gte(timeEntries.startedAt, new Date(startDate)));
    }
    if (endDate) {
      conditions.push(lt(timeEntries.startedAt, endExclusive(endDate)));
    }

    const filtered = await db.select().from(timeEntries).where(and(...conditions));
    const scheduleConditions = [eq(scheduledWorkBlocks.workspaceId, session.workspaceId)];
    if (scope !== "team") scheduleConditions.push(eq(scheduledWorkBlocks.userId, session.sub));
    if (projectId) scheduleConditions.push(eq(scheduledWorkBlocks.projectId, projectId));
    if (startDate) scheduleConditions.push(gte(scheduledWorkBlocks.startsAt, new Date(startDate)));
    if (endDate) scheduleConditions.push(lt(scheduledWorkBlocks.startsAt, endExclusive(endDate)));
    const scheduled = await db.select().from(scheduledWorkBlocks).where(and(...scheduleConditions));
    
    // Process aggregations
    let totalDurationSeconds = 0;
    let totalBillableAmount = 0;
    let manualSeconds = 0;
    let timerSeconds = 0;

    const byDate: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const entry of filtered) {
      if (!entry.durationSeconds) continue;
      
      totalDurationSeconds += entry.durationSeconds;
      if (entry.source === "manual") manualSeconds += entry.durationSeconds;
      if (entry.source === "web") timerSeconds += entry.durationSeconds;

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
    const userList = userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)) : [];
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

    const plannedSeconds = scheduled.reduce((sum, block) => {
      return sum + Math.max(0, (new Date(block.endsAt).getTime() - new Date(block.startsAt).getTime()) / 1000);
    }, 0);
    const missedBlocks = scheduled.filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() < Date.now()).length;

    return NextResponse.json({
      ok: true,
      scope,
      totalHours: totalDurationSeconds / 3600,
      totalBillableAmount,
      plannedHours: plannedSeconds / 3600,
      manualHours: manualSeconds / 3600,
      timerHours: timerSeconds / 3600,
      utilization: plannedSeconds > 0 ? totalDurationSeconds / plannedSeconds : null,
      missedBlocks,
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
