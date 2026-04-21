import { NextRequest, NextResponse } from "next/server";
import { requireRole, requireSession } from "@/lib/auth";
import { store } from "@/lib/store";

function dateKey(iso: string) {
  return iso.slice(0, 10);
}

export async function GET(req: NextRequest) {
  try {
    const session = await requireSession();
    requireRole("member", session.role);

    const from = req.nextUrl.searchParams.get("from");
    const to = req.nextUrl.searchParams.get("to");
    const fromTs = from ? new Date(from).getTime() : Date.now() - 1000 * 60 * 60 * 24 * 14;
    const toTs = to ? new Date(to).getTime() : Date.now() + 1000 * 60 * 60 * 24;

    const entries = [...store.entries.values()]
      .filter((entry) => entry.workspaceId === session.workspaceId)
      .filter((entry) => {
        const ts = new Date(entry.startedAt).getTime();
        return ts >= fromTs && ts <= toTs;
      })
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());

    const grouped = entries.reduce<Record<string, typeof entries>>((acc, entry) => {
      const key = dateKey(entry.startedAt);
      acc[key] ??= [];
      acc[key].push(entry);
      return acc;
    }, {});

    return NextResponse.json({ ok: true, entries, grouped });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 401 });
  }
}
