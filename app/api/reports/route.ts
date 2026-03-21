import { NextRequest, NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store } from "@/lib/store";

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const searchParams = req.nextUrl.searchParams;
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");

    // Gather all time entries for the workspace
    const workspaceEntries = Array.from(store.entries.values()).filter(
      (e) => e.workspaceId === session.workspaceId
    );

    // Filter by dates if provided
    let filtered = workspaceEntries;
    if (startDate) {
      filtered = filtered.filter((e) => new Date(e.startedAt) >= new Date(startDate));
    }
    if (endDate) {
      filtered = filtered.filter((e) => {
        if (!e.stoppedAt) return false;
        return new Date(e.stoppedAt) <= new Date(endDate);
      });
    }

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

      const dayParams = entry.startedAt.split("T")[0];
      byDate[dayParams] = (byDate[dayParams] || 0) + entry.durationSeconds;

      if (entry.projectId) {
        byProject[entry.projectId] = (byProject[entry.projectId] || 0) + entry.durationSeconds;
      }

      byUser[entry.userId] = (byUser[entry.userId] || 0) + entry.durationSeconds;
    }

    // Format for Recharts consumption
    const dailyTrend = Object.entries(byDate)
      .map(([date, seconds]) => ({ date, hours: seconds / 3600 }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const projectDistribution = Object.entries(byProject).map(([projectId, seconds]) => {
      const proj = store.projects.get(projectId);
      return {
        projectId,
        name: proj?.name || "Unknown Project",
        hours: seconds / 3600,
      };
    });

    const userDistribution = Object.entries(byUser).map(([userId, seconds]) => {
      const u = store.users.get(userId);
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
