import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink, setSessionCookie } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

    const { user, workspace, membership } = await consumeMagicLink(token);
    await setSessionCookie({
      sub: user.id,
      email: user.email,
      workspaceId: workspace.id,
      role: membership.role,
    });

    return NextResponse.redirect(new URL("/dashboard", req.url));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
