import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { listWorkspaceTags, store } from "@/lib/store";
import { normalizeTags } from "@/lib/validators";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const tags = listWorkspaceTags(session.workspaceId);
    return NextResponse.json({ ok: true, tags });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const body = await req.json() as { fromTag?: string; toTag?: string };
    if (!body.fromTag || !body.toTag) {
      return NextResponse.json({ error: "fromTag and toTag are required" }, { status: 400 });
    }

    const from = body.fromTag.trim().toLowerCase();
    const to = body.toTag.trim().toLowerCase();
    if (!from || !to) return NextResponse.json({ error: "Tags cannot be empty" }, { status: 400 });

    let changedEntries = 0;
    for (const entry of store.entries.values()) {
      if (entry.workspaceId !== session.workspaceId) continue;
      if (entry.tags.includes(from)) {
        entry.tags = normalizeTags(entry.tags.map((tag) => (tag === from ? to : tag)));
        changedEntries += 1;
      }
    }

    for (const user of store.users.values()) {
      user.preferredTags = normalizeTags(user.preferredTags.map((tag) => (tag === from ? to : tag)));
    }

    return NextResponse.json({ ok: true, fromTag: from, toTag: to, changedEntries });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);

    const tag = req.nextUrl.searchParams.get("tag")?.trim().toLowerCase();
    if (!tag) return NextResponse.json({ error: "tag is required" }, { status: 400 });

    let changedEntries = 0;
    for (const entry of store.entries.values()) {
      if (entry.workspaceId !== session.workspaceId) continue;
      if (entry.tags.includes(tag)) {
        entry.tags = entry.tags.filter((existing) => existing !== tag);
        changedEntries += 1;
      }
    }

    for (const user of store.users.values()) {
      user.preferredTags = user.preferredTags.filter((existing) => existing !== tag);
    }

    return NextResponse.json({ ok: true, removedTag: tag, changedEntries });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}
