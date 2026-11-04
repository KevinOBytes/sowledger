import { readRequestJson, workflowErrorResponse, WorkflowError } from "@/lib/workflow-validation";
import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { listWorkspaceTags } from "@/lib/store";
import { db } from "@/lib/db";
import { timeEntries, users, memberships } from "@/lib/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { normalizeTags } from "@/lib/validators";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const tags = await listWorkspaceTags(session.workspaceId);
    return NextResponse.json({ ok: true, tags });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't load your tags. Please try again.", { route: "/api/tags", method: "GET" });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await readRequestJson(req) as { fromTag?: string; toTag?: string };
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new WorkflowError("Send a JSON object.", 400);
    if (!body.fromTag || !body.toTag) {
      return NextResponse.json({ error: "fromTag and toTag are required" }, { status: 400 });
    }

    const from = body.fromTag.trim().toLowerCase();
    const to = body.toTag.trim().toLowerCase();
    if (!from || !to) return NextResponse.json({ error: "Tags cannot be empty" }, { status: 400 });

    let changedEntries = 0;
    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, session.workspaceId));
    
    for (const entry of entries) {
      if (entry.tags && entry.tags.includes(from)) {
        const newTags = normalizeTags(entry.tags.map((tag) => (tag === from ? to : tag)));
        await db.update(timeEntries).set({ tags: newTags }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId)));
        changedEntries += 1;
      }
    }

    const mems = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, session.workspaceId));
    const userIds = mems.map(m => m.userId);

    if (userIds.length > 0) {
      const workspaceUsers = await db.select().from(users).where(inArray(users.id, userIds));
      for (const user of workspaceUsers) {
        if (user.preferredTags && user.preferredTags.includes(from)) {
           const newPreferred = normalizeTags(user.preferredTags.map((tag) => (tag === from ? to : tag)));
           await db.update(users).set({ preferredTags: newPreferred }).where(eq(users.id, user.id));
        }
      }
    }

    return NextResponse.json({ ok: true, fromTag: from, toTag: to, changedEntries });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the tag changes were saved. Check your tags before trying again.", { route: "/api/tags", method: "PATCH" });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase();
    if (!tag) return NextResponse.json({ error: "tag is required" }, { status: 400 });

    let changedEntries = 0;
    const entries = await db.select().from(timeEntries).where(eq(timeEntries.workspaceId, session.workspaceId));
    for (const entry of entries) {
      if (entry.tags && entry.tags.includes(tag)) {
        const newTags = entry.tags.filter((existing) => existing !== tag);
        await db.update(timeEntries).set({ tags: newTags }).where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, session.workspaceId)));
        changedEntries += 1;
      }
    }

    const mems = await db.select({ userId: memberships.userId }).from(memberships).where(eq(memberships.workspaceId, session.workspaceId));
    const userIds = mems.map(m => m.userId);

    if (userIds.length > 0) {
      const workspaceUsers = await db.select().from(users).where(inArray(users.id, userIds));
      for (const user of workspaceUsers) {
        if (user.preferredTags && user.preferredTags.includes(tag)) {
          const newPreferred = user.preferredTags.filter((existing) => existing !== tag);
          await db.update(users).set({ preferredTags: newPreferred }).where(eq(users.id, user.id));
        }
      }
    }

    return NextResponse.json({ ok: true, removedTag: tag, changedEntries });
  } catch (error) {
    return workflowErrorResponse(error, "We couldn't confirm the tag was removed. Check your tags before trying again.", { route: "/api/tags", method: "DELETE" });
  }
}
