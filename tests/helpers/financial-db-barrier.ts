import { expect } from "@playwright/test";
import { sql } from "drizzle-orm";
import { db } from "../../lib/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A real held PostgreSQL lock; callers must release it in finally. */
export async function holdFinancialDatabaseLock(acquire: (tx: Transaction) => Promise<void>) {
  let ready!: (pid: number) => void;
  let unlock!: () => void;
  const reached = new Promise<number>(resolve => { ready = resolve; });
  const held = new Promise<void>(resolve => { unlock = resolve; });
  const transaction = db.transaction(async tx => {
    await acquire(tx);
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    ready(Number(result.rows[0].pid));
    await held;
  });
  const pid = await Promise.race([reached, transaction.then(() => { throw new Error("Database barrier ended before acquiring its lock."); })]);
  return { pid, release: async () => { unlock(); await transaction; } };
}

/** Includes transitive waiters (workspace lock -> entry lock), not unrelated activity. */
export async function waitForFinancialDatabaseWaiters(pid: number, minimum: number, settled: () => boolean = () => false) {
  let observed = "pending";
  await expect.poll(async () => {
    if (settled()) return observed = "settled";
    const result = await db.execute(sql`
      with recursive wait_chain(pid) as (
        select ${pid}::int
        union
        select activity.pid from pg_stat_activity activity
        join wait_chain parent on parent.pid = any(pg_blocking_pids(activity.pid))
      )
      select count(*)::int as waiting from wait_chain where pid <> ${pid}::int
    `);
    return observed = Number(result.rows[0].waiting) >= minimum ? "waiting" : "pending";
  }, { timeout: 7500, message: "The requested operations must reach the held financial database lock before release." }).not.toBe("pending");
  expect(observed, "An operation completed before the held financial lock was released.").toBe("waiting");
}
