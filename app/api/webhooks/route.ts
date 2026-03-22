import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { webhooks } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    
    const workspaceWebhooks = await db.select().from(webhooks).where(eq(webhooks.workspaceId, session.workspaceId));
    return NextResponse.json({ ok: true, webhooks: workspaceWebhooks });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const body = await req.json() as { url: string; events: string[] };

    if (!body.url || !body.url.startsWith("https://")) {
      return NextResponse.json({ error: "A valid HTTPS URL is required." }, { status: 400 });
    }

    const [hook] = await db.insert(webhooks).values({
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      url: body.url,
      events: body.events && body.events.length > 0 ? body.events : ["*"],
    }).returning();

    return NextResponse.json({ ok: true, webhook: hook });
  } catch {
    return NextResponse.json({ error: "Failed to create webhook" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    
    if (id) {
       await db.delete(webhooks).where(eq(webhooks.id, id));
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
