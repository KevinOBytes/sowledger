import { NextResponse } from "next/server";
import { requireSession, requireRole } from "@/lib/auth";
import { store, type WebhookIntegration } from "@/lib/store";

export async function GET() {
  try {
    const session = await requireSession();
    requireRole("manager", session.role);
    
    const webhooks = Array.from(store.webhooks.values()).filter(w => w.workspaceId === session.workspaceId);
    return NextResponse.json({ ok: true, webhooks });
  } catch (error) {
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

    const hook: WebhookIntegration = {
      id: crypto.randomUUID(),
      workspaceId: session.workspaceId,
      url: body.url,
      events: body.events && body.events.length > 0 ? body.events : ["*"],
      createdAt: new Date().toISOString()
    };

    store.webhooks.set(hook.id, hook);
    return NextResponse.json({ ok: true, webhook: hook });
  } catch (error) {
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
       const hook = store.webhooks.get(id);
       if (hook && hook.workspaceId === session.workspaceId) {
           store.webhooks.delete(id);
       }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}
