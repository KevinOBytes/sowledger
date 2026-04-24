import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Client } from "pg";
import { config as loadEnv } from "dotenv";

loadEnv();

const migrationFile = resolve(process.argv[2] || "db/migrations/0003_product_completion.sql");
const migrationId = process.argv[3] || migrationFile.split("/").at(-1)?.replace(/\.sql$/, "") || "manual";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

if (!existsSync(migrationFile)) {
  console.error(`Migration file not found: ${migrationFile}`);
  process.exit(1);
}

const sql = readFileSync(migrationFile, "utf8");
const checksum = createHash("sha256").update(sql).digest("hex");
const backupPath = resolve(process.env.MIGRATION_BACKUP_PATH || `/tmp/billabled-schema-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
mkdirSync(dirname(backupPath), { recursive: true });

function pgDumpEnv(connectionString) {
  const parsed = new URL(connectionString);
  return {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGDATABASE: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    PGSSLMODE: parsed.searchParams.get("sslmode") || "require",
  };
}

let catalogBackupRequired = false;
try {
  execFileSync("pg_dump", ["--schema-only", "--no-owner", "--no-privileges", "--file", backupPath], {
    env: pgDumpEnv(databaseUrl),
    stdio: "ignore",
  });
  console.log(`Schema backup written to ${backupPath}`);
} catch {
  catalogBackupRequired = true;
  console.warn("pg_dump schema backup unavailable; falling back to catalog snapshot.");
}

const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();
  await client.query("SET search_path TO public");
  if (catalogBackupRequired) {
    const tables = await client.query("SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name");
    const columns = await client.query("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position");
    const indexes = await client.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname");
    const constraints = await client.query("SELECT conname, contype, conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname");
    const catalogPath = backupPath.replace(/\.sql$/, ".catalog.json");
    writeFileSync(catalogPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      tables: tables.rows,
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
    }, null, 2));
    console.log(`Catalog schema snapshot written to ${catalogPath}`);
  }

  await client.query(`
    CREATE TABLE IF NOT EXISTS billabled_migrations (
      id text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `);

  const existing = await client.query("SELECT checksum FROM billabled_migrations WHERE id = $1", [migrationId]);
  if (existing.rowCount && existing.rows[0].checksum === checksum) {
    console.log(`Migration ${migrationId} already applied; checksum matches.`);
    process.exit(0);
  }
  if (existing.rowCount && existing.rows[0].checksum !== checksum) {
    throw new Error(`Migration ${migrationId} was already applied with a different checksum.`);
  }

  await client.query("BEGIN");
  await client.query(sql);
  await client.query("INSERT INTO billabled_migrations (id, checksum) VALUES ($1, $2)", [migrationId, checksum]);
  await client.query("COMMIT");
  console.log(`Migration ${migrationId} applied successfully.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => null);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
} finally {
  await client.end().catch(() => null);
}
