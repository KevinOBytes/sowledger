import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

export async function GET(req: NextRequest) {
  const base = req.nextUrl.searchParams.get("base") ?? "USD";
  const symbols = req.nextUrl.searchParams.get("symbols") ?? "USD,EUR,GBP,CAD,JPY";

  const url = new URL(env.EXCHANGE_RATE_API_URL);
  url.searchParams.set("base", base);
  url.searchParams.set("symbols", symbols);

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    return NextResponse.json({ error: "Could not load currency rates" }, { status: 502 });
  }

  const payload = await response.json();
  return NextResponse.json({
    base,
    symbols: symbols.split(","),
    fetchedAt: new Date().toISOString(),
    payload,
  });
}
