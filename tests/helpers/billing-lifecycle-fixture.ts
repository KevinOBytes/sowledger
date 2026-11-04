/* eslint-disable @typescript-eslint/no-explicit-any -- Actual-source loader; only Stripe/env are replaced. */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformSync } from "esbuild";
import { db } from "../../lib/db";
import { sql } from "drizzle-orm";

export function billingFixture() {
  const native = createRequire(path.join(process.cwd(), "package.json"));
  const cache: Record<string, any> = {};
  const subscriptions = new Map<string, any>(), invoices = new Map<string, any>(), sessions = new Map<string, any>();
  const state = { event: null as any, signature: "valid-synthetic", fail: false, reads: 0, beforeRead: null as null | (() => Promise<void>), clockOffsetMs: 0, commitFault: null as null | "postgres-division-by-zero" };
  // Only this loaded handler sees the controlled clock; no process-global patch.
  class FixtureDate extends Date { static now() { return Date.now() + state.clockOffsetMs; } }
  const database = new Proxy(db, { get(target, key, receiver) {
    if (key !== "transaction") return Reflect.get(target, key, receiver);
    return (callback: Parameters<typeof db.transaction>[0]) => db.transaction(async tx => {
      const result = await callback(tx);
      if (state.commitFault === "postgres-division-by-zero") await tx.execute(sql`select 1 / 0`);
      return result;
    });
  } });
  async function retrieve(map: Map<string, any>, id: string, _params: unknown, options: any) {
    if (!(options?.timeout > 0 && options.timeout <= 5000) || options?.maxNetworkRetries !== 0) throw new Error("unbounded provider read");
    state.reads++;
    await state.beforeRead?.();
    if (state.fail) throw new Error("controlled private provider failure");
    const value = map.get(id); if (!value) throw new Error("missing synthetic provider object");
    return structuredClone(value);
  }
  const provider = {
    webhooks: { constructEvent(_body: unknown, signature: string) { if (signature !== "valid-synthetic") throw new Error("private-signature-detail"); return state.event; } },
    subscriptions: { retrieve: (id: string, params: unknown, options: unknown) => retrieve(subscriptions, id, params, options) },
    invoices: {
      retrieve: (id: string, params: unknown, options: unknown) => retrieve(invoices, id, params, options),
      list: async (params: any, options: any) => { state.reads++; if (!(options?.timeout > 0 && options.timeout <= 5000) || options?.maxNetworkRetries !== 0) throw new Error("unbounded list"); return { data: [...invoices.values()].filter(invoice => invoice.status === "paid" && invoice.parent?.subscription_details?.subscription === params.subscription).slice(0, params.limit) }; },
    },
    checkout: { sessions: { retrieve: (id: string, params: unknown, options: unknown) => retrieve(sessions, id, params, options) } },
  };
  function load(id: string, from = ""): any {
    if (id.startsWith(".")) id = "@/" + path.posix.normalize(path.posix.join(path.posix.dirname(from.slice(2)), id));
    if (id === "@/lib/stripe") return { stripe: provider };
    if (id === "@/lib/env") return { env: { STRIPE_WEBHOOK_SECRET: "synthetic-only" } };
    if (id === "@/lib/db") return { db: database };
    if (id === "next/headers") return { headers: async () => new Headers({ "stripe-signature": state.signature }) };
    if (cache[id]) return cache[id];
    if (!id.startsWith("@/")) return native(id);
    const loaded = { exports: {} as any }; cache[id] = loaded.exports;
    const source = readFileSync(path.join(process.cwd(), `${id.slice(2)}.ts`), "utf8");
    const code = transformSync(source, { loader: "ts", format: "cjs" }).code;
    new Function("require", "module", "exports", "process", "Date", code)((name: string) => load(name, id), loaded, loaded.exports, { env: { STRIPE_PRO_PRICE_ID: "price_synthetic_pro" } }, FixtureDate);
    return cache[id] = loaded.exports;
  }
  return { state, subscriptions, invoices, sessions, load, async deliver(event: any, signature = "valid-synthetic") {
    state.event = event;
    state.signature = signature;
    return load("@/app/api/webhooks/stripe/route").POST(new Request("https://fixture.test/api/webhooks/stripe", { method: "POST", headers: { "stripe-signature": signature }, body: "synthetic" })) as Promise<Response>;
  } };
}
