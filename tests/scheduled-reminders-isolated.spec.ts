import { UnauthorizedError, ForbiddenError, WorkspaceCapacityError } from "../lib/auth";
import * as workflow from "../lib/workflow-validation";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { eq, inArray } from "drizzle-orm";
import { transformSync } from "esbuild";
import { NextRequest } from "next/server";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Counts = { reminded: number; failed: number; skipped: number; deferred: number; recordingFailures: number };

async function fixture() {
  assert.equal(process.env.SOWLEDGER_TEST_DATABASE, "true", "Never run cron fixtures against production");
  const workspaces: string[] = [];
  const users: string[] = [];
  const channels = new Map<string, "sent" | "failed" | "skipped">();
  const sentTo: string[] = [];
  let paused: { ready: () => void; released: Promise<void> } | undefined;
  let failStamp = false;
  const database = new Proxy(db, {
    get(target, property) {
      if (property === "transaction") return (callback: (tx: Transaction) => Promise<unknown>) => target.transaction((tx) => callback(new Proxy(tx, {
        get(transaction, member) {
          if (member === "update") return (table: unknown) => {
            if (table === schema.scheduledWorkBlocks && failStamp) throw new Error("Injected reminder stamp failure");
            return Reflect.apply(transaction.update, transaction, [table]);
          };
          const value = Reflect.get(transaction, member);
          return typeof value === "function" ? value.bind(transaction) : value;
        },
      })));
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const root = process.cwd();
  const require = createRequire(path.join(root, "package.json"));
  const modules: Record<string, unknown> = {
    "@/lib/db": { db: database }, "@/lib/db/schema": schema,
    "@/lib/app-url": { getAppOrigin: () => "https://sowledger.example" },
    "@/lib/auth": { UnauthorizedError, ForbiddenError, WorkspaceCapacityError }, "@/lib/workflow-validation": workflow,
    "@/lib/security": { enforceAuthKey: async () => undefined },
    "@/lib/integrations/notifications": { dispatchIntegrationNotification: async (workspaceId: string, _event: string, _payload: unknown, options: { signal: AbortSignal }) => {
      assert.ok(options.signal instanceof AbortSignal);
      const status = channels.get(workspaceId) ?? "skipped";
      if (status === "sent") {
        if (paused) { const hold = paused; paused = undefined; hold.ready(); await hold.released; }
        sentTo.push(workspaceId);
      }
      return { sent: status === "sent" ? 1 : 0, failed: status === "failed" ? 1 : 0, skipped: status === "skipped" ? 1 : 0 };
    } },
  };
  function load(filename: string): Record<string, unknown> {
    const code = transformSync(readFileSync(path.join(root, filename), "utf8"), { loader: "ts", format: "cjs" }).code;
    const loaded = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", "console", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      if (specifier.startsWith("@/")) {
        assert.equal(specifier, "@/lib/scheduled-block-guards");
        return modules[specifier] = load(`${specifier.slice(2)}.ts`);
      }
      return require(specifier);
    }, loaded, loaded.exports, { error: () => undefined });
    return loaded.exports;
  }
  const run = load("app/api/cron/scheduled-block-reminders/route.ts").GET as (request: NextRequest) => Promise<Response>;
  return {
    channels, sentTo,
    async run() { return await (await run(new NextRequest("https://sowledger.example/api/cron/scheduled-block-reminders"))).json() as Counts; },
    failStamp() { failStamp = true; },
    holdProvider() {
      let ready!: () => void; let release!: () => void;
      const started = new Promise<void>((resolve) => { ready = resolve; });
      const released = new Promise<void>((resolve) => { release = resolve; });
      paused = { ready, released }; return { started, release };
    },
    async block() {
      const workspaceId = crypto.randomUUID(); const userId = crypto.randomUUID(); const id = crypto.randomUUID();
      workspaces.push(workspaceId); users.push(userId);
      await db.insert(schema.users).values({ id: userId, email: `reminder-${userId}@example.com` });
      await db.insert(schema.workspaces).values({ id: workspaceId, slug: `reminder-${workspaceId}`, name: "Reminder fixture" });
      await db.insert(schema.scheduledWorkBlocks).values({ id, workspaceId, userId, createdByUserId: userId, title: "Reminder fixture", startsAt: new Date(Date.now() + 5 * 60_000), endsAt: new Date(Date.now() + 30 * 60_000) });
      return { id, workspaceId, read: async () => (await db.select().from(schema.scheduledWorkBlocks).where(eq(schema.scheduledWorkBlocks.id, id)))[0] };
    },
    async cleanup() {
      if (workspaces.length) await db.delete(schema.workspaces).where(inArray(schema.workspaces.id, workspaces));
      if (users.length) await db.delete(schema.users).where(inArray(schema.users.id, users));
    },
  };
}

test.describe("scheduled reminder PostgreSQL isolation with a simulated notification provider", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Requires disposable database wrapper; never run cron on production fixtures.");

  test("workspace advisory lock prevents duplicate acceptance while a different workspace proceeds", async () => {
    const f = await fixture(); const first = await f.block(); const second = await f.block();
    f.channels.set(first.workspaceId, "sent"); f.channels.set(second.workspaceId, "sent");
    const held = f.holdProvider(); const active = f.run(); await held.started;
    try {
      const competing = await f.run();
      expect(competing.reminded).toBe(1);
      expect(competing.deferred).toBeGreaterThanOrEqual(1);
      expect(competing.failed).toBe(0);
      held.release(); await active;
      expect(f.sentTo.sort()).toEqual([first.workspaceId, second.workspaceId].sort());
      expect((await first.read()).reminderSentAt).not.toBeNull();
      expect((await second.read()).reminderSentAt).not.toBeNull();
      expect((await f.run()).reminded).toBe(0);
    } finally { held.release(); await active; await f.cleanup(); }
  });

  test("failed and absent channels never produce a persisted reminder stamp", async () => {
    const f = await fixture();
    try {
      const failed = await f.block(); const absent = await f.block();
      f.channels.set(failed.workspaceId, "failed");
      const result = await f.run();
      expect(result.reminded).toBe(0); expect(result.failed).toBe(1); expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect((await failed.read()).reminderSentAt).toBeNull(); expect((await absent.read()).reminderSentAt).toBeNull();
    } finally { await f.cleanup(); }
  });

  test("an accepted notification with a failed database stamp is reported separately and rolls back", async () => {
    const f = await fixture();
    try {
      const block = await f.block(); f.channels.set(block.workspaceId, "sent"); f.failStamp();
      const result = await f.run();
      expect(result.reminded).toBe(1); expect(result.recordingFailures).toBe(1); expect(result.failed).toBe(0);
      expect((await block.read()).reminderSentAt).toBeNull();
      expect(f.sentTo).toEqual([block.workspaceId]);
    } finally { await f.cleanup(); }
  });
});
