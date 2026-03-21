import { NextRequest, NextResponse } from "next/server";

const AUTH_COOKIE_NAME = "timely_session";

/** Paths that are always public (no authentication required). */
const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/_next/", "/favicon.ico"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths without a session.
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const hasSession = Boolean(req.cookies.get(AUTH_COOKIE_NAME)?.value);
  if (!hasSession) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
