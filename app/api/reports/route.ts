import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { timeEntries, projects, users } from "@/lib/db/schema";
import { eq, and, gte, inArray, lt } from "drizzle-orm";
import { loadEligiblePlannedWork } from "@/lib/planned-work";
import { workflowErrorResponse } from "@/lib/workflow-validation";
import { checkedTimeZone, dateKeyInZone, overlappingSeconds, parseDateRange } from "@/lib/date-input";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    const searchParams = req.nextUrl.searchParams;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");
    const scope = searchParams.get("scope") ?? "mine";
    const projectId = searchParams.get("projectId");
    if (!["mine", "team"].includes(scope)) return NextResponse.json({ error: "Choose a valid report scope." }, { status: 400 });
    const { start, end } = parseDateRange(startDate, endDate);
    const timeZone = checkedTimeZone(searchParams.get("timeZone"));

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
    if (start) {
      conditions.push(gte(timeEntries.startedAt, start));
    }
    if (end) {
      conditions.push(lt(timeEntries.startedAt, end));
    }

    const filtered = await db.select().from(timeEntries).where(and(...conditions));
    const scheduled = await loadEligiblePlannedWork(session.workspaceId, { userId: scope === "team" ? null : session.sub, projectId, start, end });
    
    // Process aggregations
    let totalDurationSeconds = 0;
    let totalBillableAmount = 0;
    let manualSeconds = 0;
    let timerSeconds = 0;
    let calendarSeconds = 0;

    const byDate: Record<string, number> = {};
    const byProject: Record<string, number> = {};
    const byUser: Record<string, number> = {};

    for (const entry of filtered) {
      if (!entry.durationSeconds) continue;
      
      totalDurationSeconds += entry.durationSeconds;
      if (entry.source === "manual") manualSeconds += entry.durationSeconds;
      if (entry.source === "web") timerSeconds += entry.durationSeconds;
      if (entry.source === "calendar") calendarSeconds += entry.durationSeconds;

      if (entry.hourlyRate) {
        totalBillableAmount += (entry.durationSeconds / 3600) * entry.hourlyRate;
      }

      const dayParams = dateKeyInZone(entry.startedAt, timeZone);
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
      return sum + overlappingSeconds(block.startsAt, block.endsAt, start, end);
    }, 0);
    const missedBlocks = scheduled.filter((block) => block.status === "planned" && new Date(block.endsAt).getTime() < Date.now()).length;

    return NextResponse.json({
      ok: true,
      scope,
      timeZone,
      totalHours: totalDurationSeconds / 3600,
      totalBillableAmount,
      plannedHours: plannedSeconds / 3600,
      manualHours: manualSeconds / 3600,
      timerHours: timerSeconds / 3600,
      calendarHours: calendarSeconds / 3600,
      utilization: plannedSeconds > 0 ? totalDurationSeconds / plannedSeconds : null,
      missedBlocks,
      dailyTrend,
      projectDistribution,
      userDistribution,
    });
  } catch (error) {
    return workflowErrorResponse(error, "Could not load analytics. Please try again.");
  }
}
