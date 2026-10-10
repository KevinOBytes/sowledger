// Run local checks with an explicitly selected, disposable Neon branch.
// Credentials stay in child-process memory; this script never writes an env file.
import { execFileSync, spawn } from "node:child_process";

const separator = process.argv.indexOf("--");
const command = separator >= 0 ? process.argv.slice(separator + 1) : [];
const project = process.env.SOWLEDGER_TEST_PROJECT;
const branchId = process.env.SOWLEDGER_TEST_BRANCH;
const cli = process.env.NEON_CLI_PATH || "neonctl";
if (!project || !branchId || command.length === 0) {
  console.error("Set SOWLEDGER_TEST_PROJECT and SOWLEDGER_TEST_BRANCH, then pass -- <command>.");
  process.exit(1);
}

function neon(args) {
  const executable = cli.endsWith(".js") ? process.execPath : cli;
  const prefix = cli.endsWith(".js") ? [cli] : [];
  return execFileSync(executable, [...prefix, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

try {
  const branches = JSON.parse(neon(["branches", "list", "--project-id", project, "--output", "json"]));
  const branch = branches.find((candidate) => candidate.id === branchId);
  if (!branch || branch.primary || branch.default || branch.protected || !branch.name.startsWith("codex-sowledger-repair-")) {
    throw new Error("The selected database is not a disposable SOWLedger repair branch.");
  }
  const databaseUrl = neon(["connection-string", branchId, "--project-id", project, "--database-name", "neondb", "--role-name", "sowledger_app", "--ssl", "verify-full"]);
  const childEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    NEON_DATABASE_URL: databaseUrl,
    DATABASE_MIGRATION_URL: "",
    SOWLEDGER_TEST_DATABASE: "true",
    NEXT_PUBLIC_APP_URL: "http://localhost:3008",
    AUTH_COOKIE_SECRET: "sowledger-isolated-test-cookie-secret",
    AUDIT_SIGNING_SECRET: "sowledger-isolated-test-audit-secret",
    AUTH_SHARED_KEY: "sowledger-isolated-test-auth-key",
    CRON_SECRET: "sowledger-isolated-test-cron-secret",
    ALLOW_SELF_REGISTRATION: "true",
    ALLOW_BOOTSTRAP_OWNER: "true",
  };
  // Define these even when absent from the shell: Next may subsequently load
  // .env.local, but it will not overwrite explicitly empty process variables.
  const disabledKeys = [
    "RESEND_API_KEY", "RESEND_LOGIN_FROM", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRO_PRICE_ID", "STRIPE_SMB_PRICE_ID", "STRIPE_ENTERPRISE_PRICE_ID",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY", "GOOGLE_CALENDAR_CLIENT_ID",
    "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI",
    "SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_REDIRECT_URI",
    "QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET", "QUICKBOOKS_REDIRECT_URI",
    "QUICKBOOKS_ENVIRONMENT", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN",
    "KV_REST_API_URL", "KV_REST_API_TOKEN", "NEXT_PUBLIC_GA_MEASUREMENT_ID",
    "NEXT_PUBLIC_DATADOG_APPLICATION_ID", "NEXT_PUBLIC_DATADOG_CLIENT_TOKEN",
    "NEXT_PUBLIC_DATADOG_SITE", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_DSN",
    "SENTRY_AUTH_TOKEN", "SENTRY_ORG", "SENTRY_PROJECT",
  ];
  for (const key of disabledKeys) childEnv[key] = "";
  // Also clear matching inherited extensions and future provider variables.
  for (const key of Object.keys(childEnv)) {
    if (/^(RESEND_|STRIPE_|NEXT_PUBLIC_STRIPE_|GOOGLE_CALENDAR_|SLACK_|QUICKBOOKS_|SENTRY_|NEXT_PUBLIC_SENTRY_|NEXT_PUBLIC_GA_|NEXT_PUBLIC_DATADOG_|UPSTASH_|KV_|REDIS_)/.test(key)) childEnv[key] = "";
  }
  console.log(`Using isolated database branch ${branch.name} (${branch.id}).`);
  const child = spawn(command[0], command.slice(1), { env: childEnv, stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => { console.error("Could not start the test command."); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
} catch (error) {
  console.error(error instanceof Error && error.message.startsWith("The selected database") ? error.message : "Could not prepare the isolated test database. Check the Neon CLI access and selected branch.");
  process.exitCode = 1;
}
