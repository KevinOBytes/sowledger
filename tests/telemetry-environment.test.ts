import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import React, { type ReactElement, type ReactNode } from "react";
import ts from "typescript";

const root = process.cwd();
const nativeRequire = createRequire(path.join(root, "package.json"));
type Environment = Record<string, string | undefined>;
type Element = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;

// Run actual source, replacing only imports and process/console boundaries.
// No provider component, CLI, network, database or child process is initialized.
function executeSource(filename: string, modules: Record<string, unknown>, processBoundary: unknown, consoleBoundary: unknown) {
  const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), {
    // A .mjs filename makes TypeScript retain ESM despite CommonJS output;
    // changing only this compiler label leaves the executed source untouched.
    fileName: filename.endsWith(".mjs") ? `${filename}.ts` : filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "module", "exports", "process", "console", code)((specifier: string) => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected dependency: ${specifier}`);
    return modules[specifier];
  }, loaded, loaded.exports, processBoundary, consoleBoundary);
  return loaded.exports;
}

const noLogging = Object.fromEntries(["log", "warn", "error", "info", "debug"].map(method => [method, () => {
  assert.fail(`Unexpected ${method} logging`);
}]));
function childBoundary() { assert.fail("Child components must not initialize during layout checks"); }
const components = {
  Analytics: function Analytics() { childBoundary(); },
  DatadogInit: function DatadogInit() { childBoundary(); },
  Toaster: function Toaster() { childBoundary(); },
  CookieConsent: function CookieConsent() { childBoundary(); },
  AnalyticsWrapper: function AnalyticsWrapper() { childBoundary(); },
  OptionalAnalytics: function OptionalAnalytics() { childBoundary(); },
};
type LayoutModule = {
  default: (props: { children: ReactNode }) => Element;
  metadata: Record<string, unknown>;
  viewport: Record<string, unknown>;
};
function layoutFixture(env: Environment) {
  const processBoundary = { env: Object.freeze({ ...env }) };
  const metadata = executeSource("lib/marketing-metadata.ts", {}, processBoundary, noLogging);
  return executeSource("app/layout.tsx", {
    "react/jsx-runtime": nativeRequire("react/jsx-runtime"),
    "@vercel/analytics/next": { Analytics: components.Analytics },
    "@/components/DatadogInit": { __esModule: true, default: components.DatadogInit },
    sonner: { Toaster: components.Toaster },
    "@/components/cookie-consent": { CookieConsent: components.CookieConsent },
    "@/components/analytics-wrapper": { AnalyticsWrapper: components.AnalyticsWrapper },
    "@/components/optional-analytics": { OptionalAnalytics: components.OptionalAnalytics },
    "@/lib/marketing-metadata": metadata,
    "./globals.css": {},
  }, processBoundary, noLogging) as LayoutModule;
}
function elements(node: ReactNode): Element[] {
  const result: Element[] = [];
  React.Children.forEach(node, child => {
    if (!React.isValidElement(child)) return;
    const element = child as Element;
    result.push(element, ...elements(element.props.children));
  });
  return result;
}

// Removing any gate clause, using VERCEL_ENV instead, or treating "false" as
// disposable must change at least one actual React tree below.
const mountCases: Array<{ name: string; env: Environment; count: number }> = [
  { name: "unset local defaults", env: {}, count: 0 },
  { name: "development with deployment indicator", env: { NODE_ENV: "development", VERCEL: "1" }, count: 0 },
  { name: "test with deployment indicator", env: { NODE_ENV: "test", VERCEL: "1" }, count: 0 },
  { name: "production without deployment indicator", env: { NODE_ENV: "production" }, count: 0 },
  { name: "production with empty indicator", env: { NODE_ENV: "production", VERCEL: "" }, count: 0 },
  { name: "production with zero indicator", env: { NODE_ENV: "production", VERCEL: "0" }, count: 0 },
  { name: "production with non-one indicator", env: { NODE_ENV: "production", VERCEL: "true" }, count: 0 },
  { name: "production deployment", env: { NODE_ENV: "production", VERCEL: "1" }, count: 1 },
  { name: "disposable production deployment", env: { NODE_ENV: "production", VERCEL: "1", SOWLEDGER_TEST_DATABASE: "true" }, count: 0 },
  { name: "preview deployment with unset disposable marker", env: { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview" }, count: 1 },
  { name: "preview deployment with false disposable marker", env: { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", SOWLEDGER_TEST_DATABASE: "false" }, count: 1 },
  { name: "custom deployment with unset disposable marker", env: { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "custom" }, count: 1 },
  { name: "custom deployment with false disposable marker", env: { NODE_ENV: "production", VERCEL: "1", VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "custom", SOWLEDGER_TEST_DATABASE: "false" }, count: 1 },
];
for (const row of mountCases) {
  test(`actual layout passes the Vercel deployment gate into consent boundary: ${row.name}`, () => {
    const loaded = layoutFixture(row.env);
    const tree = loaded.default({ children: React.createElement("main", null, "Page content") });
    const all = elements(tree);
    assert.equal(all.filter(element => element.type === components.Analytics).length, 0, "Layout must never bypass browser consent with a direct Analytics child");
    const optional = all.filter(element => element.type === components.OptionalAnalytics);
    assert.equal(optional.length, 1, "One shared optional-analytics boundary is required");
    assert.equal(optional[0].props.vercelEnabled, row.count === 1, "Preserve every existing deployment gate in addition to consent");
  });
}

test("Analytics gating preserves children, shell, Toaster, GA, Datadog, consent, metadata and viewport", () => {
  const child = React.createElement("main", { id: "page-content" }, "Page content");
  const baseline = layoutFixture({});
  for (const env of [{}, { NODE_ENV: "production", VERCEL: "1" }]) {
    for (const gaConfigured of [false, true]) {
      const loaded = layoutFixture({ ...env, ...(gaConfigured ? { NEXT_PUBLIC_GA_MEASUREMENT_ID: "synthetic-ga-id" } : {}) });
      const tree = loaded.default({ children: child });
      assert.equal(tree.type, "html");
      assert.equal(tree.props.lang, "en");
      assert.equal(tree.props.className, "h-full antialiased");
      const body = tree.props.children as Element;
      assert.equal(body.type, "body");
      assert.equal(body.props.className, "min-h-full flex flex-col font-sans");
      const shell = React.Children.toArray(body.props.children).filter(node => React.isValidElement(node)) as Element[];
      assert.deepEqual(shell.filter(element => ![components.OptionalAnalytics].includes(element.type as typeof components.OptionalAnalytics)).map(element => element.type), ["main", components.Toaster, components.CookieConsent]);
      assert.equal((body.props.children as ReactNode[])[0], child, "Preserve the exact children object");
      assert.deepEqual(shell.find(element => element.type === components.Toaster)?.props, {
        theme: "light", richColors: true, position: "bottom-right", closeButton: true,
        toastOptions: { closeButtonAriaLabel: "Dismiss notification", classNames: { closeButton: "h-7! w-7!" } },
      });
      const optional = shell.find(element => element.type === components.OptionalAnalytics);
      assert.ok(optional, "Optional vendors must share the consent boundary");
      assert.equal(optional.props.gaId, gaConfigured ? "synthetic-ga-id" : undefined, "Preserve GA configuration decision");
      assert.deepEqual(loaded.metadata, baseline.metadata);
      assert.deepEqual(loaded.viewport, baseline.viewport);
    }
  }
  assert.equal(baseline.metadata.title, "SOWLedger | Time tracking and invoicing for client work");
  assert.equal((baseline.metadata.metadataBase as URL).href, "https://www.sowledger.com/");
  assert.deepEqual(baseline.viewport, { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f2ea", colorScheme: "light" });
});

type Branch = { id: string; name: string; primary: boolean; default: boolean; protected: boolean };
type Callback = (...args: unknown[]) => void;
const repairBranch: Branch = { id: "branch-fixture", name: "codex-sowledger-repair-fixture", primary: false, default: false, protected: false };
const deploymentNames = ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "NEXT_PUBLIC_VERCEL_OBSERVABILITY_BASEPATH", "NEXT_PUBLIC_VERCEL_OBSERVABILITY_CLIENT_CONFIG"];
function wrapperFixture(overrides: Environment = {}, branches: Branch[] = [repairBranch], argv = ["node", "with-test-database.mjs", "--", "fixture-command", "fixture-argument"]) {
  const env: Environment = { SOWLEDGER_TEST_PROJECT: "project-fixture", SOWLEDGER_TEST_BRANCH: repairBranch.id, ...overrides };
  const originalEnv = { ...env };
  const cliCalls: Array<{ executable: string; args: string[]; options: unknown }> = [];
  const spawns: Array<{ command: string; args: string[]; env: Environment; stdio: string }> = [];
  const processHandlers = new Map<string, Callback>();
  const childHandlers = new Map<string, Callback>();
  const killed: unknown[] = [];
  const logs: unknown[][] = [];
  const errors: unknown[][] = [];
  const processBoundary = {
    env, argv, execPath: "/synthetic/node", exitCode: undefined as number | undefined,
    exit(code: number) { throw new Error(`Unexpected immediate exit (${code})`); },
    on(event: string, callback: Callback) { assert.ok(["SIGINT", "SIGTERM"].includes(event)); processHandlers.set(event, callback); },
  };
  executeSource("scripts/with-test-database.mjs", {
    "node:child_process": {
      execFileSync(executable: string, args: string[], options: unknown) {
        cliCalls.push({ executable, args, options });
        if (args.includes("branches")) return JSON.stringify(branches);
        assert.ok(args.includes("connection-string"), "Unexpected CLI action");
        return "postgresql://sowledger_app:synthetic@disposable.invalid/neondb?sslmode=verify-full\n";
      },
      spawn(command: string, args: string[], options: { env: Environment; stdio: string }) {
        spawns.push({ command, args, ...options });
        return {
          kill(signal: unknown) { killed.push(signal); },
          on(event: string, callback: Callback) { assert.ok(["error", "exit"].includes(event)); childHandlers.set(event, callback); },
        };
      },
    },
  }, processBoundary, {
    ...noLogging,
    log(...args: unknown[]) { logs.push(args); },
    error(...args: unknown[]) { errors.push(args); },
  });
  // Do not print environment values even on assertion failure.
  assert.ok(JSON.stringify(env) === JSON.stringify(originalEnv), "Parent environment mutated");
  return { env, cliCalls, spawns, processBoundary, processHandlers, childHandlers, killed, logs, errors };
}
function assertPrepared(f: ReturnType<typeof wrapperFixture>) {
  assert.deepEqual(f.errors, [], "Unexpected wrapper error/logging");
  assert.deepEqual(f.logs, [["Using isolated database branch codex-sowledger-repair-fixture (branch-fixture)."]]);
  assert.equal(f.cliCalls.length, 2);
  assert.deepEqual(f.cliCalls[0].args, ["branches", "list", "--project-id", "project-fixture", "--output", "json"]);
  assert.deepEqual(f.cliCalls[1].args, ["connection-string", "branch-fixture", "--project-id", "project-fixture", "--database-name", "neondb", "--role-name", "sowledger_app", "--ssl", "verify-full"]);
  for (const call of f.cliCalls) assert.deepEqual(call.options, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(f.spawns.length, 1);
  assert.equal(f.spawns[0].command, "fixture-command");
  assert.deepEqual(f.spawns[0].args, ["fixture-argument"]);
  assert.equal(f.spawns[0].stdio, "inherit");
  const env = f.spawns[0].env;
  assert.ok(env.SOWLEDGER_TEST_DATABASE === "true", "Disposable marker must be true");
  assert.ok(env.DATABASE_URL === "postgresql://sowledger_app:synthetic@disposable.invalid/neondb?sslmode=verify-full", "Select restricted fixture URL");
  assert.ok(env.NEON_DATABASE_URL === env.DATABASE_URL, "Runtime URLs must match");
  assert.ok(env.DATABASE_MIGRATION_URL === "", "Migration URL must be cleared");
  for (const key of ["RESEND_API_KEY", "STRIPE_SECRET_KEY", "GOOGLE_CALENDAR_CLIENT_SECRET", "SLACK_CLIENT_SECRET", "QUICKBOOKS_CLIENT_SECRET", "NEXT_PUBLIC_GA_MEASUREMENT_ID", "NEXT_PUBLIC_DATADOG_CLIENT_TOKEN", "NEXT_PUBLIC_SENTRY_DSN", "SENTRY_AUTH_TOKEN", "UPSTASH_REDIS_REST_URL", "KV_REST_API_TOKEN"]) {
    assert.ok(Object.hasOwn(env, key) && env[key] === "", `Existing provider clearing must retain ${key}`);
  }
}

for (const inherited of [false, true]) {
  test(`actual wrapper explicitly clears deployment and observability settings when ${inherited ? "inherited" : "absent"}`, () => {
    const f = wrapperFixture({
      ...(inherited ? Object.fromEntries(deploymentNames.map(name => [name, "synthetic-deployment-setting"])) : {}),
      NEXT_PUBLIC_VERCEL_OBSERVABILITY_FUTURE_SETTING: "synthetic-observability-setting",
      VERCEL_UNRELATED_SETTING: "synthetic-preserved-setting",
      NODE_ENV: "production", DATABASE_MIGRATION_URL: "synthetic-maintenance-setting",
      STRIPE_FUTURE_SETTING: "synthetic-provider-setting", REDIS_FUTURE_SETTING: "synthetic-provider-setting",
    });
    assertPrepared(f);
    const env = f.spawns[0].env;
    for (const key of deploymentNames) assert.ok(Object.hasOwn(env, key) && env[key] === "", `Must explicitly clear ${key}`);
    for (const key of ["NEXT_PUBLIC_VERCEL_OBSERVABILITY_FUTURE_SETTING", "STRIPE_FUTURE_SETTING", "REDIS_FUTURE_SETTING"]) assert.ok(env[key] === "", `Must mask inherited ${key}`);
    assert.ok(env.VERCEL_UNRELATED_SETTING === "synthetic-preserved-setting", "Do not broadly clear VERCEL names");
    assert.ok(env.NODE_ENV === "production", "Preserve NODE_ENV");
  });
}

test("actual wrapper retains CLI default and JS selection, NODE_ENV default, signals and child exit/error propagation", () => {
  for (const cli of [undefined, "/synthetic/neon-cli.js"]) {
    const f = wrapperFixture(cli ? { NEON_CLI_PATH: cli } : {});
    // The JS CLI prefix is deliberately stripped only from captured test calls.
    if (cli) for (const call of f.cliCalls) { assert.equal(call.executable, "/synthetic/node"); assert.equal(call.args.shift(), cli); }
    else for (const call of f.cliCalls) assert.equal(call.executable, "neonctl");
    assertPrepared(f);
    assert.ok(!Object.hasOwn(f.spawns[0].env, "NODE_ENV"), "Do not add a NODE_ENV default");
    for (const signal of ["SIGINT", "SIGTERM"]) f.processHandlers.get(signal)!(signal);
    assert.deepEqual(f.killed, ["SIGINT", "SIGTERM"]);
    f.childHandlers.get("exit")!(23, null);
    assert.equal(f.processBoundary.exitCode, 23);
    f.childHandlers.get("exit")!(null, "SIGTERM");
    assert.equal(f.processBoundary.exitCode, 1);
    f.childHandlers.get("exit")!(0, null);
    assert.equal(f.processBoundary.exitCode, 0);
    f.childHandlers.get("error")!(new Error("Synthetic spawn error"));
    assert.equal(f.processBoundary.exitCode, 1);
    assert.deepEqual(f.errors, [["Could not start the test command."]]);
  }
});

test("actual wrapper rejects missing, primary, default, protected and incorrectly named branches before URL selection or spawn", () => {
  for (const branches of [[], [{ ...repairBranch, primary: true }], [{ ...repairBranch, default: true }], [{ ...repairBranch, protected: true }], [{ ...repairBranch, name: "not-a-repair-branch" }]]) {
    const f = wrapperFixture({}, branches);
    assert.equal(f.cliCalls.length, 1);
    assert.equal(f.spawns.length, 0);
    assert.equal(f.processBoundary.exitCode, 1);
    assert.deepEqual(f.logs, []);
    assert.deepEqual(f.errors, [["The selected database is not a disposable SOWLedger repair branch."]]);
  }
});
