/* eslint-disable @typescript-eslint/no-explicit-any -- Test-process instrumentation forwards real Drizzle/pg operations unchanged. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { setImmediate as yieldLoop } from "node:timers/promises";
import ts from "typescript";
import type { PoolClient } from "pg";
import { sql } from "drizzle-orm";
import { getDb } from "../../lib/db";

export type Action = "pause" | "resume" | "stop";
export type Identity = { workspaceId: string; userId: string; entryId: string };
export type Outcome = { ok: true; value: any } | { ok: false; error: any };
const native = createRequire(path.join(process.cwd(), "tests/helpers/timer-transition-fixtures.ts"));
export function latch() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
export async function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error(label)), ms); })]); }
  finally { clearTimeout(timeout); }
}

/** Actual source, actual SQL, actual transactions. Only the helper clock and
 * Next after registration are substituted inside this test process. No auth
 * replacement, production endpoint, provider callback or fabricated row exists. */
export function operation(identity: Identity, action: Action, options: { hold?: boolean; rollback?: boolean; now: number; endedAt?: Date }) {
  const acquired = latch(), started = latch(), release = latch();
  const realDb = getDb();
  const state = { pid: 0, acquired: false, capacityAcquired: false, writes: 0, bodyFinished: false, committed: false, settled: false, now: options.now, callbacks: [] as Array<() => unknown>, events: [] as string[] };
  class Clock extends Date {
    constructor(value?: any) { super(value === undefined ? state.now : value); }
    static now() { return state.now; }
    static [Symbol.hasInstance](value: unknown) { return value instanceof Date; }
  }
  const db = {
    async transaction(body: (tx: any) => Promise<unknown>, config: Parameters<typeof realDb.transaction>[1]) {
      assert.deepEqual(config, { isolationLevel: "read committed" });
      const result = await realDb.transaction(async tx => {
        // Test-only PID query, not a production-helper query or fake row result.
        state.pid = Number((await tx.execute(sql`select pg_backend_pid() as pid`)).rows[0].pid);
        state.events.push("pid"); started.release();
        const wrapped = new Proxy(tx, { get(target, property, receiver) {
          if (property === "execute") return async (query: any) => {
            assert.equal(action, "stop", "Transitions must not acquire owner capacity or other execute locks");
            assert.equal(state.acquired, false, "Capacity must precede the stop row lock");
            const result = await target.execute(query); state.capacityAcquired = true; state.events.push("capacity"); return result;
          };
          if (property === "select") return (...args: any[]) => {
            function wrap(builder: any): any {
              return new Proxy(builder, { get(query, key, queryReceiver) {
                if (key === "for") return (...lockArgs: any[]) => {
                  assert.deepEqual(lockArgs, ["update"]);
                  const lockedQuery = query.for(...lockArgs);
                  let pending: Promise<unknown> | undefined;
                  return new Proxy(lockedQuery, { get(locked, lockKey, lockedReceiver) {
                    if (lockKey === "then") return (resolve: any, reject: any) => {
                      pending ??= (async () => {
                        const result = await locked;
                        assert.equal(result.length, 1); assert.equal(result[0].id, identity.entryId);
                        assert.equal(result[0].workspaceId, identity.workspaceId); assert.equal(result[0].userId, identity.userId);
                        if (action === "stop") assert.equal(state.capacityAcquired, true);
                        state.acquired = true; state.events.push("row"); acquired.release();
                        if (options.hold) await release.promise;
                        return result;
                      })();
                      return pending.then(resolve, reject);
                    };
                    const value = Reflect.get(locked, lockKey, lockedReceiver); return typeof value === "function" ? value.bind(locked) : value;
                  } });
                };
                const value = Reflect.get(query, key, queryReceiver);
                if (key === "then") return typeof value === "function" ? value.bind(query) : value;
                return typeof value === "function" ? (...values: any[]) => wrap(value.apply(query, values)) : value;
              } });
            }
            return wrap((target.select as any)(...args));
          };
          if (property === "update" || property === "insert") return (...values: any[]) => {
            state.writes++; return (Reflect.get(target, property) as any).apply(target, values);
          };
          const value = Reflect.get(target, property, receiver); return typeof value === "function" ? value.bind(target) : value;
        } });
        const result = await body(wrapped); state.bodyFinished = true;
        if (options.rollback) { assert.ok(state.writes > 0, "Fault must follow an actual completed mutation"); throw new Error("Disposable post-update rollback"); }
        return result;
      }, config);
      state.committed = true; state.events.push("commit"); return result;
    },
  };
  const modules: Record<string, any> = { "@/lib/db": { db }, "next/server": {
    ...native("next/server"), after: (callback: () => unknown) => { assert.equal(state.committed, true, "after must register after actual commit"); state.callbacks.push(callback); },
  } };
  const owned = new Set(["timer-transition", "timer-stop", "time-capacity", "security", "workflow-validation"]);
  function load(name: string): any {
    if (name in modules) return modules[name];
    if (!name.startsWith("@/lib/") || !owned.has(name.slice(6))) return native(name.startsWith("@/") ? `../../${name.slice(2)}` : name);
    const filename = `${name.slice(2)}.ts`, mod = { exports: {} };
    const compiled = ts.transpileModule(readFileSync(path.join(process.cwd(), filename), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    new Function("require", "module", "exports", "Date", compiled)((dependency: string) => load(dependency.startsWith("./") ? `@/lib/${dependency.slice(2)}` : dependency), mod, mod.exports, Clock);
    return modules[name] = mod.exports;
  }
  let result: Promise<Outcome> | undefined;
  return {
    state, acquired: acquired.promise, started: started.promise, release: release.release,
    run() {
      assert.equal(result, undefined, "An operation executes once");
      result = (async (): Promise<Outcome> => {
        try { const value = action === "stop"
          ? await load("@/lib/timer-stop").stopTimer({ ...identity, endedAt: options.endedAt })
          : await load("@/lib/timer-transition").transitionTimer({ ...identity, action });
          return { ok: true, value };
        } catch (error) { return { ok: false, error }; }
        finally { state.settled = true; }
      })();
      return result;
    },
  };
}

export type Operation = ReturnType<typeof operation>;
export async function reachedBlocker(observer: PoolClient, holder: Operation, waiter: Operation) {
  const until = Date.now() + 5000;
  await deadline(waiter.started, 5000, "Waiter did not obtain its own PostgreSQL connection");
  assert.notEqual(holder.state.pid, waiter.state.pid);
  const observerPid = Number((await observer.query("select pg_backend_pid() as pid")).rows[0].pid);
  assert.notEqual(observerPid, holder.state.pid); assert.notEqual(observerPid, waiter.state.pid);
  let observed = false;
  while (Date.now() < until) {
    assert.equal(waiter.state.settled, false); assert.equal(waiter.state.writes, 0);
    const blockers = (await observer.query<{ blockers: number[] }>("select pg_blocking_pids($1::int) as blockers", [waiter.state.pid])).rows[0].blockers;
    const locks = (await observer.query<{ pid: number; granted: boolean; locktype: string }>("select pid, granted, locktype from pg_locks where pid = any($1::int[]) and (database is null or database=(select oid from pg_database where datname=current_database()))", [[holder.state.pid, waiter.state.pid]])).rows;
    if (blockers.includes(holder.state.pid) && locks.some(row => row.pid === waiter.state.pid && !row.granted)) { observed = true; break; }
    await yieldLoop();
  }
  assert.equal(observed, true, "Known waiter PID must actually block on known holder PID before release");
  assert.equal(holder.state.acquired, true); assert.equal(holder.state.settled, false); assert.equal(holder.state.committed, false);
  assert.equal(holder.state.callbacks.length, 0); assert.equal(waiter.state.callbacks.length, 0);
  if (waiter.state.events.includes("capacity")) assert.equal(waiter.state.acquired, false);
}
