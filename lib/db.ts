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

  const databaseUrl = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("NEON_DATABASE_URL or DATABASE_URL is required to use the database");
  }

  // Remote Neon pooled connections do not reliably honor startup search_path
  // options. Tables are explicitly qualified through the Drizzle namespace.
  const pool = globalThis.__sowledgerDbPool ?? new Pool({
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 15_000,
  });
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
