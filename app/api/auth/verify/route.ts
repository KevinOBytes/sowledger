import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink, setSessionCookie } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      const url = new URL("/login", req.url);
      url.searchParams.set("error", "missing_link");
      return NextResponse.redirect(url);
    }

    const { user, workspace, membership } = await consumeMagicLink(token);
    await setSessionCookie({
      sub: user.id,
      email: user.email,
      workspaceId: workspace.id,
      role: membership.role,
    });

    return NextResponse.redirect(new URL("/dashboard", req.url));
  } catch (error) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", (error as Error).message || "Could not verify sign-in link");
    return NextResponse.redirect(url);
  }
}
