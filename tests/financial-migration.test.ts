import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../lib/db/schema";

const migration = "db/migrations/0011_runtime_schema.sql";
const checksum = createHash("sha256").update(readFileSync(migration)).digest("hex");
// The only substituted boundary is PostgreSQL: never open a socket or read .env.
const pgStub = `export class Client {
  queries = [];
  async connect() {}
  async query(sql, params) {
    this.queries.push({sql, params});
    if (sql.includes('current_database()')) return {rows:[{database_name:'neondb',role_name:'maintenance',schema_exists:false}]};
    if (sql.includes('has_schema_privilege')) return {rows:[{schema_usage:true,schema_create:true}]};
    if (sql.startsWith('SELECT checksum')) return {rowCount:process.env.TEST_CHECKSUM ? 1 : 0,rows:process.env.TEST_CHECKSUM ? [{checksum:process.env.TEST_CHECKSUM}] : []};
    if (process.env.TEST_FAIL_DDL && sql.includes('-- SOWLedger shares')) throw new Error('controlled DDL failure');
    return {rows:[],rowCount:0};
  }
  async end() { console.log('QUERIES:'+JSON.stringify(this.queries)); }
}`;
const data = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
const loader = data(`export async function resolve(specifier,context,next) {
  if (specifier === 'pg') return {url:${JSON.stringify(data(pgStub))},shortCircuit:true};
  if (specifier === 'dotenv') return {url:${JSON.stringify(data("export function config() { if (process.env.TEST_FORBID_DOTENV) throw new Error('dotenv target rehydration forbidden'); }"))},shortCircuit:true};
  return next(specifier,context);
}`);
function run(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, ["--no-warnings", "--loader", loader, "scripts/run-safe-migration.mjs", ...args], {
    encoding: "utf8",
    env: { NODE_ENV: "test", PATH: "/nonexistent", DATABASE_MIGRATION_URL: "postgresql://maintenance:fake@branch.invalid/neondb", MIGRATION_BACKUP_PATH: "/tmp/sowledger-financial-test.catalog.sql", ...extra },
  });
  const line = result.stdout.split("\n").find((line) => line.startsWith("QUERIES:"));
  return { ...result, queries: line ? JSON.parse(line.slice(8)) as {sql: string; params?: string[]}[] : [] };
}

test("dry-run rolls back migration DDL and journal instead of committing", () => {
  const result = run([migration, "financial-test", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.queries.some(({sql}) => sql.startsWith("INSERT INTO sowledger_migrations")));
  assert.equal(result.queries.at(-1)?.sql, "ROLLBACK");
  assert.ok(!result.queries.some(({sql}) => sql === "COMMIT"));
});
test("schema creation is inside the same transaction and advisory lock as journal and DDL", () => {
  const result = run([migration, "financial-test"]);
  assert.equal(result.status, 0, result.stderr);
  const sql = result.queries.map((query) => query.sql);
  const firstCreate = sql.findIndex((query) => query.startsWith("CREATE SCHEMA"));
  assert.ok(sql.indexOf("BEGIN") < firstCreate);
  assert.ok(sql.findIndex((query) => query.includes("pg_advisory_xact_lock")) < firstCreate);
  assert.equal(sql.at(-1), "COMMIT");
});
test("dry-run flag before positionals retains the selected file and ID", () => {
  const result = run(["--dry-run", migration, "exact-id"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.queries.find(({sql}) => sql.startsWith("INSERT INTO"))?.params?.[0], "exact-id");
  assert.equal(result.queries.at(-1)?.sql, "ROLLBACK");
});
test("checksum match skips DDL and journal insertion; mismatch refuses and rolls back", () => {
  const same = run([migration, "financial-test"], { TEST_CHECKSUM: checksum });
  assert.equal(same.status, 0, same.stderr);
  assert.ok(!same.queries.some(({sql}) => sql.startsWith("INSERT INTO") || sql.includes("-- SOWLedger shares")));
  const changed = run([migration, "financial-test"], { TEST_CHECKSUM: "different" });
  assert.equal(changed.status, 1);
  assert.match(changed.stderr, /different checksum/);
  assert.equal(changed.queries.at(-1)?.sql, "ROLLBACK");
});
test("DDL errors roll back and unknown arguments are rejected before connecting", () => {
  const result = run([migration, "financial-test"], { TEST_FAIL_DDL: "1" });
  assert.equal(result.status, 1);
  assert.equal(result.queries.at(-1)?.sql, "ROLLBACK");
  const unknown = run([migration, "financial-test", "--unsafe"]);
  assert.equal(unknown.status, 1);
  assert.equal(unknown.queries.length, 0);
});
test("isolated maintenance runner never rehydrates .env runtime or provider credentials", () => {
  const result = run([migration, "financial-test", "--dry-run"], { SOWLEDGER_TEST_DATABASE: "true", TEST_FORBID_DOTENV: "1" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.queries.at(-1)?.sql, "ROLLBACK");
});

async function launcher() {
  const loaded = await import(resolve("scripts/with-test-migration.mjs")).catch(() => ({}));
  assert.equal(typeof loaded.prepareTestMigration, "function", "disposable migration launcher must expose its real preparation boundary");
  return loaded;
}
const branch = { id: "br-disposable", name: "codex-sowledger-repair-fixture", primary: false, default: false, protected: false, expires_at: "2099-01-01T00:00:00Z" };
const selection = { SOWLEDGER_TEST_PROJECT: "project-fixture", SOWLEDGER_TEST_BRANCH: "br-disposable", SOWLEDGER_TEST_MIGRATION_ROLE: "maintenance", MIGRATION_BACKUP_PATH: "/tmp/approved-backup.sql" };
test("financial ORM tables preserve workspace storage boundaries and release completeness", () => {
  const tables = schema as Record<string, unknown>;
  for (const name of ["workspaceBillingState", "billingPaymentFailures", "stripeWebhookEvents", "invoiceLifecycle"]) {
    assert.ok(tables[name], `${name} must exist`);
    const config = getTableConfig(tables[name] as Parameters<typeof getTableConfig>[0]);
    assert.equal(config.schema, "sowledger");
    assert.ok(config.foreignKeys.some((fk) => fk.reference().foreignColumns[0].name === "id" && getTableConfig(fk.reference().foreignTable).name === "workspaces"));
  }
  const lifecycle = getTableConfig(tables.invoiceLifecycle as Parameters<typeof getTableConfig>[0]);
  assert.ok(lifecycle.foreignKeys.some((fk) => fk.reference().columns.map((column) => column.name).join(",") === "invoice_id,workspace_id"));
  assert.ok(lifecycle.checks.some((check) => check.name === "invoice_lifecycle_release_complete"));
  assert.ok(getTableConfig(schema.invoices).indexes.some((index) => index.config.unique && index.config.columns.length === 2));
  assert.ok(schema.invoices.status.enumValues?.includes("void" as never));
});
test("launcher validates fresh disposable metadata before retrieving direct maintenance credentials", async () => {
  const { prepareTestMigration } = await launcher();
  const calls: string[][] = [];
  const prepared = await prepareTestMigration({ env: { ...selection, DATABASE_URL: "production", DATABASE_MIGRATION_URL: "production", STRIPE_SECRET_KEY: "secret", GOOGLE_CALENDAR_CLIENT_SECRET: "secret" }, args: ["--dry-run"], neon: (args: string[]) => {
    calls.push(args);
    if (args[0] === "branches") return JSON.stringify([branch]);
    if (args[0] === "roles") return JSON.stringify([{ name: "maintenance" }, { name: "sowledger_app" }]);
    return "postgresql://maintenance:fake@branch.invalid/neondb?sslmode=verify-full";
  }});
  assert.deepEqual(prepared.command, ["npm", "run", "db:migrate:product", "--", "db/migrations/0012_billing_invoice_lifecycle.sql", "--dry-run"]);
  assert.equal(prepared.env.DATABASE_URL, "");
  assert.equal(prepared.env.NEON_DATABASE_URL, "");
  assert.equal(prepared.env.STRIPE_SECRET_KEY, "");
  assert.equal(prepared.env.GOOGLE_CALENDAR_CLIENT_SECRET, "");
  assert.match(prepared.env.DATABASE_MIGRATION_URL, /^postgresql:\/\/maintenance:/);
  assert.ok(calls.some((args) => args.includes("--role-name") && args.includes("maintenance")));
});
test("launcher allows only exact reviewed 0012 or 0013 selectors, with 0012 the unchanged default", async () => {
  const { prepareTestMigration } = await launcher();
  for (const [selector, path] of [[undefined, "db/migrations/0012_billing_invoice_lifecycle.sql"], ["0012", "db/migrations/0012_billing_invoice_lifecycle.sql"], ["0013", "db/migrations/0013_billing_failure_evidence.sql"]]) {
    const result = await prepareTestMigration({ env: { ...selection, ...(selector ? { SOWLEDGER_TEST_MIGRATION_ID: selector } : {}) }, args: ["--dry-run"], neon: (args: string[]) => args[0] === "branches" ? JSON.stringify([branch]) : args[0] === "roles" ? JSON.stringify([{ name: "maintenance" }]) : "postgresql://maintenance:fake@branch.invalid/neondb?sslmode=verify-full" });
    assert.deepEqual(result.command, ["npm", "run", "db:migrate:product", "--", path, "--dry-run"]);
  }
});
test("unknown or path-like migration selectors reject before any CLI or credential retrieval", async () => {
  const { prepareTestMigration } = await launcher();
  for (const selector of ["", "0014", "../0013", "db/migrations/0013_billing_failure_evidence.sql", "0013 --unsafe", "0013\n", "constructor", "toString", "__proto__"]) {
    const calls: string[] = [];
    await assert.rejects(() => prepareTestMigration({ env: { ...selection, SOWLEDGER_TEST_MIGRATION_ID: selector }, args: [], neon: () => { calls.push("unexpected"); return ""; } }));
    assert.deepEqual(calls, []);
  }
});
test("unknown-anchor evidence schema is nullable and additive 0013 dry-run rolls back its own journal", () => {
  assert.equal(schema.billingPaymentFailures.firstFailedAt.notNull, false);
  const result = run(["db/migrations/0013_billing_failure_evidence.sql", "0013-evidence-test", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const changes = result.queries.filter(({ sql }) => sql.includes("ALTER TABLE sowledger.billing_payment_failures"));
  assert.equal(changes.length, 1);
  assert.match(changes[0].sql, /ALTER COLUMN first_failed_at DROP NOT NULL;/);
  assert.equal(result.queries.find(({ sql }) => sql.startsWith("INSERT INTO sowledger_migrations"))?.params?.[0], "0013-evidence-test");
  assert.equal(result.queries.at(-1)?.sql, "ROLLBACK");
});
test("launcher rejects primary/default/protected/expired/non-disposable/missing metadata without credential retrieval", async () => {
  const { prepareTestMigration } = await launcher();
  for (const candidate of [{ ...branch, primary: true }, { ...branch, default: true }, { ...branch, protected: true }, { ...branch, expires_at: "2000-01-01" }, { ...branch, expires_at: null }, { ...branch, primary: undefined }, { ...branch, name: "production" }]) {
    const calls: string[] = [];
    await assert.rejects(() => prepareTestMigration({ env: selection, args: [], neon: (args: string[]) => { calls.push(args[0]); return JSON.stringify([candidate]); }}));
    assert.deepEqual(calls, ["branches"]);
  }
});
test("launcher refuses missing selection, runtime role, pooled/wrong-role URLs, and arbitrary child commands", async () => {
  const { prepareTestMigration } = await launcher();
  for (const env of [{ ...selection, SOWLEDGER_TEST_PROJECT: "" }, { ...selection, SOWLEDGER_TEST_MIGRATION_ROLE: "sowledger_app" }, { ...selection, MIGRATION_BACKUP_PATH: "" }]) {
    await assert.rejects(() => prepareTestMigration({ env, args: [], neon: () => { throw new Error("must not reach CLI"); } }));
  }
  for (const url of ["postgresql://sowledger_app:fake@branch.invalid/neondb?sslmode=verify-full", "postgresql://maintenance:fake@branch-pooler.invalid/neondb?sslmode=verify-full", "postgresql://maintenance:fake@branch.invalid/anotherdb?sslmode=verify-full"]) {
    await assert.rejects(() => prepareTestMigration({ env: selection, args: [], neon: (args: string[]) => args[0] === "branches" ? JSON.stringify([branch]) : args[0] === "roles" ? JSON.stringify([{ name: "maintenance" }]) : url }));
  }
  await assert.rejects(() => prepareTestMigration({ env: selection, args: ["--", "sh", "-c", "unsafe"], neon: () => { throw new Error("must not reach CLI"); } }));
});

test("launcher rejects missing or invalid TLS on otherwise-valid direct maintenance URLs", async () => {
  const { prepareTestMigration } = await launcher();
  for (const suffix of ["", "?sslmode=disable", "?sslmode=require", "?sslmode=verify-ca"]) {
    await assert.rejects(() => prepareTestMigration({ env: selection, args: [], neon: (args: string[]) => args[0] === "branches" ? JSON.stringify([branch]) : args[0] === "roles" ? JSON.stringify([{ name: "maintenance" }]) : `postgresql://maintenance:fake@branch.invalid/neondb${suffix}` }));
  }
});

test("real launcher CLI spawns only reviewed npm workflow with no shell, runtime URL, providers or injection options", () => {
  const childProcess = data(`import {EventEmitter} from 'node:events';
    export function execFileSync(executable,args) {
      if (args[0] === 'branches') return ${JSON.stringify(JSON.stringify([branch]))};
      if (args[0] === 'roles') return '[{"name":"maintenance"}]';
      if (args[0] === 'connection-string' && args[1] === 'br-disposable') return 'postgresql://maintenance:fake@branch.invalid/neondb?sslmode=verify-full';
      throw new Error('unexpected CLI command');
    }
    export function spawn(command,args,options) {
      console.log('CHILD:'+JSON.stringify({command,args,options}));
      const child = new EventEmitter(); child.kill=()=>{};
      setTimeout(()=>child.emit('exit',0,null),0); return child;
    }`);
  const cliLoader = data(`export async function resolve(specifier,context,next) {
    if (specifier === 'node:child_process') return {url:${JSON.stringify(childProcess)},shortCircuit:true};
    return next(specifier,context);
  }`);
  const result = spawnSync(process.execPath, ["--no-warnings", "--loader", cliLoader, "scripts/with-test-migration.mjs", "--dry-run"], {
    encoding: "utf8", env: { NODE_ENV: "test", ...selection, DATABASE_URL: "production", NEON_DATABASE_URL: "production", DATABASE_MIGRATION_URL: "production", STRIPE_SECRET_KEY: "secret", GOOGLE_CALENDAR_CLIENT_SECRET: "secret", npm_config_script_shell: "/unsafe-shell" },
  });
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((line) => line.startsWith("CHILD:"));
  assert.ok(line);
  const child = JSON.parse(line.slice(6));
  assert.equal(child.command, "npm");
  assert.deepEqual(child.args, ["run", "db:migrate:product", "--", "db/migrations/0012_billing_invoice_lifecycle.sql", "--dry-run"]);
  assert.equal(child.options.cwd, process.cwd());
  assert.equal(child.options.shell, false);
  assert.equal(child.options.env.DATABASE_URL, "");
  assert.equal(child.options.env.NEON_DATABASE_URL, "");
  assert.equal(child.options.env.STRIPE_SECRET_KEY, "");
  assert.equal(child.options.env.GOOGLE_CALENDAR_CLIENT_SECRET, "");
  assert.equal(child.options.env.npm_config_script_shell, undefined);
  assert.equal(child.options.env.NODE_OPTIONS, undefined);
  assert.equal(child.options.env.npm_config_ignore_scripts, "true");
});
