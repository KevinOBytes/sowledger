import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./db/schema";

type DbClient = NodePgDatabase<typeof schema>;

declare global {
  var __sowledgerDbPool: Pool | undefined;
  var __sowledgerDbClient: DbClient | undefined;
}

export function getDb(): DbClient {
  if (globalThis.__sowledgerDbClient) {
    return globalThis.__sowledgerDbClient;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to use the database");
  }

  const pool = globalThis.__sowledgerDbPool ?? new Pool({ connectionString: databaseUrl });
  const client = drizzle(pool, { schema });

  globalThis.__sowledgerDbPool = pool;
  globalThis.__sowledgerDbClient = client;
  return client;
}

const dbProxyTarget = {} as DbClient;

export const db: DbClient = new Proxy(dbProxyTarget, {
  get(_target, prop, receiver) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
