import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./db/schema";

type DbClient = NodePgDatabase<typeof schema>;

declare global {
  var __timelyDbPool: Pool | undefined;
  var __timelyDbClient: DbClient | undefined;
}

export function getDb(): DbClient {
  if (globalThis.__timelyDbClient) {
    return globalThis.__timelyDbClient;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to use the database");
  }

  const pool = globalThis.__timelyDbPool ?? new Pool({ connectionString: databaseUrl });
  const client = drizzle(pool, { schema });

  globalThis.__timelyDbPool = pool;
  globalThis.__timelyDbClient = client;
  return client;
}

export const db: DbClient = new Proxy({} as DbClient, {
  get(_target, prop, receiver) {
    const client = getDb() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(client, prop, receiver);
    return typeof value === "function" ? value.bind(client) : value;
  },
});
