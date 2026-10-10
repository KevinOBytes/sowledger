import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink, ForbiddenError, setSessionCookie, UnauthorizedError } from "@/lib/auth";

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

    return NextResponse.redirect(new URL(membership.role === "client" ? "/client" : "/dashboard", req.url));
  } catch (error) {
    const url = new URL("/login", req.url);
    if (error instanceof UnauthorizedError || error instanceof ForbiddenError) {
      url.searchParams.set("error", error.message);
    } else {
      console.error("Sign-in verification failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
      url.searchParams.set("error", "service_unavailable");
    }
    return NextResponse.redirect(url);
  }
}
