// Maintenance credentials exist only in the reviewed migration subprocess.
// No dotenv loading, interactive login, arbitrary command, or runtime server.
import { execFileSync, spawn } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const migrations = new Map([
  ["0012", "db/migrations/0012_billing_invoice_lifecycle.sql"],
  ["0013", "db/migrations/0013_billing_failure_evidence.sql"],
]);

export async function prepareTestMigration({ env = process.env, args = [], neon, now = Date.now() }) {
  const migration = migrations.get(env.SOWLEDGER_TEST_MIGRATION_ID ?? "0012");
  if (!migration) throw new Error("Only reviewed migration IDs 0012 and 0013 are accepted.");
  const project = env.SOWLEDGER_TEST_PROJECT;
  const branchId = env.SOWLEDGER_TEST_BRANCH;
  const role = env.SOWLEDGER_TEST_MIGRATION_ROLE;
  if (!project || !branchId || !role || role === "sowledger_app" || !env.MIGRATION_BACKUP_PATH || !isAbsolute(env.MIGRATION_BACKUP_PATH)) {
    throw new Error("Explicit project, disposable branch, non-runtime SOWLEDGER_TEST_MIGRATION_ROLE, and absolute MIGRATION_BACKUP_PATH are required.");
  }
  if (args.length > 1 || (args.length === 1 && args[0] !== "--dry-run")) {
    throw new Error("Only --dry-run is accepted; the migration workflow is fixed.");
  }
  const branches = JSON.parse(await neon(["branches", "list", "--project-id", project, "--output", "json"]));
  const branch = Array.isArray(branches) && branches.find((candidate) => candidate.id === branchId);
  const expiresAt = typeof branch?.expires_at === "string" ? Date.parse(branch.expires_at) : NaN;
  if (!branch || branch.primary !== false || branch.default !== false || branch.protected !== false || !branch.name?.startsWith("codex-sowledger-repair-") || !Number.isFinite(expiresAt) || expiresAt <= now) {
    throw new Error("The selected database is not a verified unexpired disposable SOWLedger repair branch.");
  }
  const roles = JSON.parse(await neon(["roles", "list", "--project-id", project, "--branch-id", branchId, "--output", "json"]));
  if (!Array.isArray(roles) || !roles.some((candidate) => candidate.name === role)) {
    throw new Error("The approved maintenance role does not exist on the selected branch.");
  }
  const databaseUrl = await neon(["connection-string", branchId, "--project-id", project, "--database-name", "neondb", "--role-name", role, "--ssl", "verify-full"]);
  let parsed;
  try { parsed = new URL(databaseUrl); } catch { throw new Error("Neon returned an invalid maintenance connection."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || !parsed.hostname || parsed.hostname.includes("-pooler") || decodeURIComponent(parsed.username) !== role || decodeURIComponent(parsed.pathname) !== "/neondb" || parsed.searchParams.get("sslmode") !== "verify-full" || !parsed.password) {
    throw new Error("Neon did not return the requested direct neondb maintenance connection.");
  }

  // An allowlist prevents dotenv, npm hooks, NODE_OPTIONS, PG service files,
  // and unknown future provider credentials from entering the elevated child.
  const childEnv = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SYSTEMROOT"]) {
    if (env[key]) childEnv[key] = env[key];
  }
  for (const key of Object.keys(env)) {
    if (/^(DATABASE_|NEON_DATABASE_|PG|RESEND_|STRIPE_|NEXT_PUBLIC_|GOOGLE_|SLACK_|QUICKBOOKS_|SENTRY_|UPSTASH_|KV_|REDIS_|AUTH_|CRON_|INTEGRATION_|VERCEL)/.test(key)) childEnv[key] = "";
  }
  Object.assign(childEnv, {
    DATABASE_URL: "", NEON_DATABASE_URL: "", DATABASE_MIGRATION_URL: databaseUrl,
    MIGRATION_BACKUP_PATH: env.MIGRATION_BACKUP_PATH,
    // Explicitly prevent dotenv rehydration for the reviewed runner's only DB input.
    SOWLEDGER_TEST_DATABASE: "true",
    npm_config_ignore_scripts: "true",
  });
  return { command: ["npm", "run", "db:migrate:product", "--", migration, ...args], env: childEnv, branch };
}

async function main() {
  try {
    const cli = process.env.NEON_CLI_PATH || "neonctl";
    const neon = (args) => execFileSync(cli.endsWith(".js") ? process.execPath : cli, [...(cli.endsWith(".js") ? [cli] : []), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const prepared = await prepareTestMigration({ args: process.argv.slice(2), neon });
    console.log(`Using disposable migration branch ${prepared.branch.name} (${prepared.branch.id}).`);
    const child = spawn(prepared.command[0], prepared.command.slice(1), { cwd: root, env: prepared.env, stdio: "inherit", shell: false });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("error", () => { console.error("Could not start the reviewed migration workflow."); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
  } catch {
    // CLI failures and URL parser errors can contain credentials; never relay them.
    console.error("Could not prepare the disposable migration. Check explicit selection, branch metadata, role, and backup path.");
    process.exitCode = 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
