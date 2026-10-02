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
const databaseUrl = process.env.DATABASE_MIGRATION_URL;
const databaseSchema = "sowledger";
const journalSchema = "sowledger_migrations";

if (!databaseUrl) {
  console.error("DATABASE_MIGRATION_URL is required; use the direct Neon maintenance connection.");
  process.exit(1);
}

try {
  const parsedDatabaseUrl = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    console.error("DATABASE_MIGRATION_URL must be a valid PostgreSQL URL.");
    process.exit(1);
  }
  if (parsedDatabaseUrl.hostname.includes("-pooler.")) {
    console.error("DATABASE_MIGRATION_URL must use a direct, unpooled Neon connection.");
    process.exit(1);
  }
} catch {
  console.error("DATABASE_MIGRATION_URL must be a valid PostgreSQL URL.");
  process.exit(1);
}

if (!existsSync(migrationFile)) {
  console.error(`Migration file not found: ${migrationFile}`);
  process.exit(1);
}

const sql = readFileSync(migrationFile, "utf8");
const checksum = createHash("sha256").update(sql).digest("hex");
const backupPath = resolve(process.env.MIGRATION_BACKUP_PATH || `/tmp/sowledger-schema-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`);
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
    PGSSLMODE: parsed.searchParams.get("sslmode") || "verify-full",
  };
}

let inTransaction = false;
const client = new Client({ connectionString: databaseUrl });

try {
  await client.connect();

  const target = await client.query(`
    SELECT
      current_database() AS database_name,
      current_user AS role_name,
      to_regnamespace($1) IS NOT NULL AS schema_exists
  `, [databaseSchema]);
  const targetInfo = target.rows[0];
  console.log(`Migration target: ${targetInfo.database_name} / ${databaseSchema} as ${targetInfo.role_name}`);
  if (!targetInfo.schema_exists) console.log(`Schema ${databaseSchema} does not exist yet; the migration will create it after the preflight backup.`);

  let catalogBackupRequired = false;
  try {
    execFileSync("pg_dump", [
      "--schema-only",
      "--schema", databaseSchema,
      "--no-owner",
      "--no-privileges",
      "--file", backupPath,
    ], {
      env: pgDumpEnv(databaseUrl),
      stdio: "ignore",
    });
    console.log(`Schema backup written to ${backupPath}`);
  } catch {
    catalogBackupRequired = true;
    console.warn("pg_dump schema backup unavailable; falling back to catalog snapshot.");
  }

  if (catalogBackupRequired) {
    const tables = await client.query("SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name", [databaseSchema]);
    const columns = await client.query("SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, ordinal_position", [databaseSchema]);
    const indexes = await client.query("SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY tablename, indexname", [databaseSchema]);
    const constraints = await client.query("SELECT conname, contype, conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace = to_regnamespace($1) ORDER BY conrelid::regclass::text, conname", [databaseSchema]);
    const catalogPath = backupPath.replace(/\.sql$/, ".catalog.json");
    writeFileSync(catalogPath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      schema: databaseSchema,
      tables: tables.rows,
      columns: columns.rows,
      indexes: indexes.rows,
      constraints: constraints.rows,
    }, null, 2));
    console.log(`Catalog schema snapshot written to ${catalogPath}`);
  }

  // The destination database is shared. Create and inspect only SOWLedger's
  // namespaces; never grant or alter privileges on another application's schema.
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${databaseSchema}`);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${journalSchema}`);
  const privileges = await client.query(`
    SELECT
      has_schema_privilege(current_user, $1, 'USAGE') AS schema_usage,
      has_schema_privilege(current_user, $1, 'CREATE') AS schema_create
  `, [databaseSchema]);
  const privilegeInfo = privileges.rows[0];
  if (!privilegeInfo.schema_usage || !privilegeInfo.schema_create) {
    throw new Error(`Migration role must have USAGE and CREATE on the ${databaseSchema} schema.`);
  }

  await client.query("BEGIN");
  inTransaction = true;
  await client.query("SELECT pg_advisory_xact_lock(hashtext('sowledger-schema-migrations'))");
  await client.query(`SET LOCAL search_path TO ${databaseSchema}, pg_catalog`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${journalSchema}.schema_migrations (
      version text PRIMARY KEY,
      checksum text NOT NULL,
      applied_at timestamp NOT NULL DEFAULT now()
    )
  `);

  const existing = await client.query(`SELECT checksum FROM ${journalSchema}.schema_migrations WHERE version = $1`, [migrationId]);
  if (existing.rowCount && existing.rows[0].checksum === checksum) {
    await client.query("COMMIT");
    inTransaction = false;
    console.log(`Migration ${migrationId} already applied; checksum matches.`);
  } else {
    if (existing.rowCount && existing.rows[0].checksum !== checksum) {
      throw new Error(`Migration ${migrationId} was already applied with a different checksum.`);
    }

    await client.query(sql);
    await client.query(`INSERT INTO ${journalSchema}.schema_migrations (version, checksum) VALUES ($1, $2)`, [migrationId, checksum]);
    await client.query("COMMIT");
    inTransaction = false;
    console.log(`Migration ${migrationId} applied successfully.`);
  }
} catch (error) {
  if (inTransaction) await client.query("ROLLBACK").catch(() => null);
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.end().catch(() => null);
}
