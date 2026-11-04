import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
const origin = "http://invoice-selection.test";
let script: string, css: string;
const row = (id = "a", overrides = {}) => ({ id, workspaceId: "workspace", userEmail: "owner@example.com", projectName: `Project ${id}`, description: id, startedAt: "2026-10-31T00:00:00.000Z", durationSeconds: 1800, hourlyRate: 99.99, amount: 50, amountCents: 5000, clientId: "client", clientName: "Acme", billingAudience: "client", eligible: true, ineligibleReason: null, ...overrides });
type Row = ReturnType<typeof row>;
test.beforeAll(async () => {
  script = (await build({ absWorkingDir: root, stdin: { resolveDir: root, loader: "tsx", contents: `import { createRoot } from "react-dom/client"; import { StrictMode } from "react"; import { Toaster } from "sonner"; import InvoicesPage from "./app/(app)/invoices/page"; createRoot(document.getElementById("root")).render(<StrictMode><InvoicesPage/><Toaster/></StrictMode>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } })).outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});
async function mount(page: Page, initialMode = "success", initialRows = [row()]) {
  let mode = initialMode, reads = 0, rows = structuredClone(initialRows);
  const writes: unknown[] = [], errors: string[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/integrations") return route.fulfill({ json: { connections: [] } });
    if (req.method() === "GET") {
      reads++; const snapshot = structuredClone(rows);
      if (mode === "late-initial" && reads === 1) await gate;
      if (mode === "load-http" || mode === "refresh-http" || mode === "created-refresh-failed" && writes.length) return route.fulfill({ status: 500, json: { error: "private SQL" } });
      if (mode === "load-malformed") return route.fulfill({ json: { ok: true, invoices: [], billableEntries: [], canManage: "true" } });
      return route.fulfill({ json: { ok: true, workspaceId: "workspace", invoices: [], billableEntries: snapshot, canManage: true } });
    }
    const body = req.postDataJSON(); writes.push(body);
    if (mode === "pending") await gate;
    if (mode === "http") return route.fulfill({ status: 500, json: { error: "private SQL" } });
    if (mode === "network") return route.abort("failed");
    if (mode === "422") return route.fulfill({ status: 422, json: { error: "This total cannot be stored without changing a cent. No invoice was created and your time remains approved.", code: "INVOICE_AMOUNT_NOT_REPRESENTABLE" } });
    if (mode === "malformed") return route.fulfill({ json: { ok: true, invoice: { id: "new" } } });
    const total = body.timeEntryIds.reduce((sum: number, id: string) => sum + rows.find(r => r.id === id)!.amountCents, 0);
    const invoice = { id: "new", workspaceId: "workspace", number: "INV-20261031-NEW", projectId: null, projectName: "General", status: "draft", amount: total / 100, amountCents: total, timeEntryIds: body.timeEntryIds, createdAt: "2026-10-31T00:00:00.000Z", dueDate: null, clientId: rows[0].clientId, clientName: rows[0].clientName, billingAudience: rows[0].billingAudience };
    if (mode === "wrong-workspace") invoice.workspaceId = "foreign";
    if (mode === "wrong-ids") invoice.timeEntryIds = ["other"];
    if (mode === "wrong-amount") invoice.amount += 0.01;
    rows = rows.filter(r => !body.timeEntryIds.includes(r.id));
    return route.fulfill({ json: { ok: true, invoice } });
  });
  await page.goto(`${origin}/fixture`); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  return { writes, errors, release, mode: (value: string) => { mode = value; }, rows: (value: Row[]) => { rows = value; }, reads: () => reads };
}
const create = (page: Page) => page.getByRole("button", { name: /Create draft invoice/ });
const select = (page: Page, id = "a") => page.getByRole("button", { name: new RegExp(`Project ${id}\\b`) });

test("cent previews use per-line rounding and grouping prevents incompatible additions but allows deselect", async ({ page }) => {
  await mount(page, "success", [row(), row("b"), row("internal", { clientId: null, clientName: null, billingAudience: "internal" }), row("bad", { eligible: false, amountCents: null, amount: null, clientId: null, clientName: null, billingAudience: null, ineligibleReason: "Review the saved rate." })] as unknown as Row[]);
  await expect(page.getByText("$50.00", { exact: true }).first()).toBeVisible(); await select(page).click(); await select(page, "b").click();
  await expect(page.getByText("$100.00 selected.")).toBeVisible(); await expect(select(page, "internal")).toBeDisabled(); await expect(select(page, "bad")).toBeDisabled(); await expect(page.getByText("Review the saved rate.")).toBeVisible();
  await select(page).click(); await select(page, "b").click(); await expect(select(page, "internal")).toBeEnabled(); await select(page, "internal").click(); await expect(page.getByText(/Internal — not shared in the client portal/).first()).toBeVisible();
});
for (const mode of ["load-http", "load-malformed"]) test(`${mode} shows retry, never empty-list success or invented manager rights`, async ({ page }) => {
  const f = await mount(page, mode); await expect(page.getByRole("alert")).toContainText(/could not load/i); await expect(page.getByText("No approved billables awaiting invoice.")).toHaveCount(0); f.mode("success"); await page.getByRole("button", { name: /Retry|Try again/ }).click(); await expect(select(page)).toBeEnabled(); expect(f.errors).toEqual([]);
});
for (const mode of ["http", "network", "malformed", "wrong-workspace", "wrong-ids", "wrong-amount", "422"]) test(`${mode} keeps selection without false confirmation or internal error text`, async ({ page }) => {
  const f = await mount(page, mode); await select(page).click(); await create(page).click(); await expect(page.getByRole("alert")).toContainText(mode === "422" ? /cannot be stored/ : /could not confirm/i); await expect(select(page)).toHaveAttribute("aria-pressed", "true"); await expect(page.getByRole("alert")).not.toContainText("private SQL"); expect(f.writes).toHaveLength(1);
});
test("pending snapshot disables competing actions and synchronous duplicate click submits once", async ({ page }) => {
  const f = await mount(page, "pending", [row(), row("b")]); await select(page).click(); await create(page).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); }); await expect.poll(() => f.writes.length).toBe(1); await expect(select(page)).toBeDisabled(); await expect(select(page, "b")).toBeDisabled(); await expect(page.getByRole("button", { name: "Refresh invoices" })).toBeDisabled(); f.release(); await expect(page.getByRole("status").filter({ hasText: /Draft invoice created/ }).first()).toBeVisible(); expect(f.errors).toEqual([]);
});
test("confirmed create followed by failed refresh is created-plus-retry, not a second POST", async ({ page }) => {
  const f = await mount(page, "created-refresh-failed"); await select(page).click(); await create(page).click(); await expect(page.getByRole("alert")).toContainText(/created.*refresh/i); expect(f.writes).toHaveLength(1); await expect(create(page)).toBeDisabled();
});
test("failed refresh keeps selection; successful regroup removes invalid IDs deterministically with explanation", async ({ page }) => {
  const f = await mount(page, "success", [row(), row("b")]); await select(page).click(); await select(page, "b").click(); f.mode("refresh-http"); await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(select(page)).toHaveAttribute("aria-pressed", "true"); f.mode("success"); f.rows([row(), row("b", { clientId: "other", clientName: "Other" })]); await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(select(page)).toHaveAttribute("aria-pressed", "true"); await expect(select(page, "b")).toHaveAttribute("aria-pressed", "false"); await expect(page.getByRole("status").filter({ hasText: /selection.*changed/i })).toBeVisible();
});
test("late abandoned StrictMode read cannot restore consumed selection", async ({ page }) => {
  const f = await mount(page, "late-initial"); await select(page).click(); await create(page).click(); await expect(page.getByRole("status").filter({ hasText: /Draft invoice created/ }).first()).toBeVisible(); f.release(); await expect(select(page)).toHaveCount(0); expect(f.writes).toHaveLength(1);
});
for (const width of [320, 390, 1440]) test(`keyboard selection and explanations fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); await mount(page, "success", [row("internal", { clientId: null, clientName: null, billingAudience: "internal" })]); await select(page, "internal").focus(); await page.keyboard.press("Space"); await expect(select(page, "internal")).toHaveAttribute("aria-pressed", "true"); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("100 entry bound is visible and selected rows remain removable", async ({ page }) => {
  await mount(page, "success", Array.from({ length: 101 }, (_, index) => row(String(index))));
  for (let index = 0; index < 100; index++) await select(page, String(index)).click();
  await expect(page.getByText(/100-entry limit reached/)).toBeVisible(); await expect(select(page, "100")).toBeDisabled(); await select(page, "0").click(); await expect(select(page, "100")).toBeEnabled();
});
test("safe individual cents with overflowing sum render unavailable and disable creation", async ({ page }) => {
  await mount(page, "success", [row("a", { amountCents: 9007199254740991, amount: 9007199254740991 / 100 }), row("b", { amountCents: 1, amount: 0.01 })]);
  await select(page).click(); await select(page, "b").click(); await expect(page.getByRole("alert")).toContainText(/amount unavailable/i); await expect(create(page)).toBeDisabled(); await expect(page.locator("body")).not.toContainText("NaN");
});

const savedInvoice = (id = "draft", status = "draft", audience = "internal") => ({ id, workspaceId: "workspace", number: `INV-${id}`, projectId: null, status, amount: 50, timeEntryIds: [`entry-${id}`], createdAt: "2026-10-31T00:00:00.000Z", dueDate: null, clientId: audience === "client" ? "client" : null, clientName: audience === "client" ? "Acme" : null, billingAudience: audience });
async function mountPerimeter(page: Page, records = [savedInvoice()], canManage = true, billableEntries: Row[] = []) {
  let mode = "success";
  let workspaceId = "workspace";
  const reads: string[] = [];
  const forbiddenRequests: string[] = [];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [], errors: string[] = [], confirmations: string[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { confirmations.push(dialog.message()); await dialog.accept(); });
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (/\/(proof-pack|preview|print)$/.test(url.pathname)) forbiddenRequests.push(url.pathname);
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/integrations") return route.fulfill({ json: { connections: [{ provider: "quickbooks", status: "connected" }] } });
    if (/\/(proof-pack|preview)$/.test(url.pathname)) {
      reads.push(url.pathname);
      const invoice = records.find(record => url.pathname.includes(`/${record.id}/`))!;
      if (mode === "late-proof" && invoice.id === records[0].id) await gate;
      return route.fulfill({ json: { ok: true, digest: "a".repeat(64), proofPack: { invoice, entries: [], totals: { actualSeconds: 1800, plannedSeconds: 0, auditEventCount: 0 } } } });
    }
    if (req.method() === "GET") return route.fulfill({ json: mode === "malformed-refresh" ? { ok: true } : { ok: true, workspaceId, invoices: records, billableEntries, canManage } });
    const body = req.postDataJSON(); writes.push({ path: url.pathname, body });
    if (mode === "pending") await gate;
    if (mode === "network") return route.abort("failed");
    if (mode === "http") return route.fulfill({ status: 500, json: { error: "private provider SQL" } });
    const push = url.pathname.endsWith("push-invoice");
    if (push) return route.fulfill({ json: mode === "malformed" ? { ok: true, result: { externalId: "external" } } : { ok: true, result: { externalId: "external", reused: mode === "reused" } } });
    const invoice = records.find(record => url.pathname.endsWith(`/${record.id}`))!;
    // Native PATCH returns the raw saved row, not GET audience/grouping fields.
    const { billingAudience: _audience, clientId: _client, clientName: _name, ...raw } = invoice;
    void _audience; void _client; void _name;
    const result = { ...raw, projectId: raw.projectId as string | null, status: body.status };
    if (mode === "wrong-id") result.id = "other";
    if (mode === "wrong-status") result.status = "paid";
    if (mode === "wrong-workspace") result.workspaceId = "foreign";
    if (mode === "wrong-project") result.projectId = "unrelated";
    if (mode === "malformed") return route.fulfill({ json: { ok: true, invoice: { id: invoice.id, status: body.status } } });
    if (mode === "success" || mode === "pending") invoice.status = body.status;
    return route.fulfill({ json: { ok: true, invoice: result } });
  });
  await page.goto(`${origin}/fixture`);
  await page.evaluate(() => {
    const observed = window as unknown as { proofBodiesProcessed: Record<string, boolean> };
    observed.proofBodiesProcessed = {};
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (/\/(proof-pack|preview)$/.test(response.url)) {
        const originalJson = response.json.bind(response);
        response.json = () => originalJson().then(value => {
          // The consumer's await continuation runs before the next message
          // task. Two render frames then observe any resulting React commit.
          const channel = new MessageChannel();
          channel.port1.onmessage = () => requestAnimationFrame(() => requestAnimationFrame(() => {
            observed.proofBodiesProcessed[new URL(response.url).pathname] = true;
            channel.port1.close(); channel.port2.close();
          }));
          queueMicrotask(() => channel.port2.postMessage(null));
          return value;
        });
      }
      return response;
    };
  });
  await page.addStyleTag({ content: css }); await page.addScriptTag({ content: script });
  await expect(page.getByText(records[0].number, { exact: true })).toBeVisible();
  return { writes, reads, forbiddenRequests, errors, confirmations, release, mode: (next: string) => { mode = next; }, records: (next: typeof records) => { records = next; }, workspace: (id: string) => { workspaceId = id; }, capability: (allowed: boolean) => { canManage = allowed; } };
}

async function releaseProofAndObserveProcessing(page: Page, release: () => void, invoiceId: string) {
  const pathname = `/api/invoices/${invoiceId}/proof-pack`;
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === pathname);
  release();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  expect(await response.finished()).toBeNull();
  expect((await response.json()).proofPack.invoice.id).toBe(invoiceId);
  await expect.poll(() => page.evaluate(path => (window as unknown as { proofBodiesProcessed: Record<string, boolean> }).proofBodiesProcessed[path], pathname)).toBe(true);
}
const invoiceCard = (page: Page, id: string) => page.locator("article").filter({ has: page.getByText(`INV-${id}`, { exact: true }) });

for (const width of [320, 390, 1440]) test(`review-only duplicate saved history preserves details, totals and healthy actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const duplicate = { ...savedInvoice("duplicate", "sent", "unknown"), amount: 7.89, timeEntryIds: ["old-b", "old-a", "old-b"] };
  const f = await mountPerimeter(page, [savedInvoice("healthy", "sent"), duplicate], true, [row()]);
  const card = invoiceCard(page, "duplicate");
  await expect(card).toContainText("This saved invoice needs review. Some time entries are listed more than once. We haven't changed the invoice.");
  await expect(card).toContainText("Actions are unavailable for this record here. Ask a workspace manager to review the saved time entries.");
  await expect(card.getByRole("button")).toHaveCount(0); await expect(card.getByRole("link")).toHaveCount(0);
  const details = card.locator("summary"); await details.focus(); await page.keyboard.press("Enter");
  await expect(card.getByText("duplicate", { exact: true })).toBeVisible();
  await expect(card.locator("ol > li")).toHaveText(["old-b", "old-a", "old-b"]);
  await expect(page.getByText("Saved totals include invoices that need review.")).toBeVisible();
  await expect(page.getByText("$57.89 across active invoices.", { exact: true })).toBeVisible();
  await expect(invoiceCard(page, "healthy").getByRole("button", { name: "Mark as paid" })).toBeEnabled();
  await invoiceCard(page, "healthy").getByRole("button", { name: "Open proof pack" }).click(); await expect(page.getByRole("heading", { name: "INV-healthy" })).toBeVisible();
  await select(page).click(); await expect(create(page)).toBeEnabled();
  expect(f.writes).toEqual([]); expect(f.reads).toEqual(["/api/invoices/healthy/proof-pack"]); expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const change of ["duplicate", "removed", "workspace"] as const) test(`successful ${change} refresh invalidates selected pending proof and ignores its late response`, async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("first", "sent"), savedInvoice("second", "sent")]); f.mode("late-proof");
  await invoiceCard(page, "first").getByRole("button", { name: "Open proof pack" }).click(); await expect(page.getByText("Building proof pack...")).toBeVisible();
  if (change === "duplicate") f.records([{ ...savedInvoice("first", "sent", "unknown"), timeEntryIds: ["e", "e"] }, savedInvoice("second", "sent")]);
  if (change === "removed") f.records([savedInvoice("second", "sent")]);
  if (change === "workspace") { f.workspace("other"); f.records([{ ...savedInvoice("first", "sent"), workspaceId: "other" }]); }
  await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(page.getByText("Select an invoice to review its supporting time entries.")).toBeVisible();
  await releaseProofAndObserveProcessing(page, f.release, "first");
  expect(f.reads).toHaveLength(1);
  await expect(page.getByRole("heading", { name: "INV-first" })).toHaveCount(0); await expect(page.getByText("Building proof pack...")).toHaveCount(0); expect(f.errors).toEqual([]);
});
test("malformed duplicate refresh keeps last healthy list/selection/proof, while valid duplicate refresh clears already loaded proof", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("first", "sent")], true, [row()]);
  await select(page).click(); await page.getByRole("button", { name: "Open proof pack" }).click(); await expect(page.getByRole("heading", { name: "INV-first" })).toBeVisible();
  f.records([{ ...savedInvoice("first", "sent", "client"), timeEntryIds: ["e", "e"] }]);
  await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(page.getByRole("alert")).toContainText(/last list and selection/);
  await expect(page.getByRole("heading", { name: "INV-first" })).toBeVisible(); await expect(select(page)).toHaveAttribute("aria-pressed", "true");
  f.records([{ ...savedInvoice("first", "sent", "unknown"), timeEntryIds: ["e", "e"] }]);
  await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(page.getByRole("heading", { name: "INV-first" })).toHaveCount(0); await expect(select(page)).toHaveAttribute("aria-pressed", "true");
});
test("stale direct action handlers cannot request degraded history proof, status or push", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("first", "sent")]);
  await expect(page.getByRole("button", { name: "Push QuickBooks" })).toBeVisible();
  await invoiceCard(page, "first").evaluate(card => {
    type HandlerElement = HTMLElement & Record<string, unknown>;
    (window as unknown as { staleInvoiceActions: Array<() => void> }).staleInvoiceActions = Array.from(card.querySelectorAll("button")).map(button => {
      const key = Object.keys(button).find(key => key.startsWith("__reactProps$"))!;
      return ((button as unknown as HandlerElement)[key] as { onClick: () => void }).onClick;
    });
  });
  f.records([{ ...savedInvoice("first", "sent", "unknown"), timeEntryIds: ["e", "e"] }]);
  await page.getByRole("button", { name: "Refresh invoices" }).click(); await expect(invoiceCard(page, "first")).toContainText("This saved invoice needs review.");
  await page.evaluate(() => { for (const action of (window as unknown as { staleInvoiceActions: Array<() => void> }).staleInvoiceActions) action(); });
  await page.waitForTimeout(80); expect(f.writes).toEqual([]); expect(f.reads).toEqual([]); expect(f.confirmations).toEqual([]); expect(f.errors).toEqual([]);
});
test("singleton history uses human portal copy and top-aligned columns without changing proof formatting", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); await mountPerimeter(page);
  await expect(page.getByText("1 invoice", { exact: true })).toBeVisible();
  await expect(page.getByText("Review the time and rates behind each saved total. Clients see their own sent or paid invoices in the portal. Internal invoices are not shared there.")).toBeVisible();
  await page.getByRole("button", { name: "Review draft" }).click(); await expect(page.getByRole("heading", { name: "INV-draft" })).toBeVisible();
  const panels = page.locator("section.grid > div"); const a = await panels.nth(0).boundingBox(), b = await panels.nth(1).boundingBox(); expect(a!.y).toBe(b!.y); expect(a!.height).toBeLessThan(b!.height);
  await expect(page.getByText("0.5h", { exact: true }).first()).toBeVisible();
});
for (const width of [320, 390]) test(`billable duration presentation preserves positive short time and amounts at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const cases: Array<[number | null, string]> = [[0, "0 sec"], [0.5, "<1 sec"], [1, "1 sec"], [1.25, "1.25 sec"], [36, "36 sec"], [60, "1 min"], [90, "1.5 min"], [1800, "30 min"], [3600, "1 hr"], [5400, "1.5 hr"], [null, "Time unavailable"], [-1, "Time unavailable"]];
  await mount(page, "success", cases.map(([durationSeconds], index) => row(`case-${index}`, { durationSeconds, eligible: false, amount: null, amountCents: null, billingAudience: null, clientId: null, clientName: null, ineligibleReason: "Needs review" })) as unknown as Row[]);
  for (const [, label] of cases) await expect(page.getByText(`${label} × $99.99/hr`, { exact: true }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("perimeter offers only monotonic status actions and sent/paid push; members have no mutations", async ({ page }) => {
  await mountPerimeter(page, [savedInvoice(), savedInvoice("sent", "sent"), savedInvoice("paid", "paid"), savedInvoice("unknown", "unknown")]);
  await expect(invoiceCard(page, "draft").getByRole("button", { name: "Mark as sent" })).toBeVisible();
  await expect(invoiceCard(page, "draft").getByRole("button", { name: "Push QuickBooks" })).toHaveCount(0);
  await expect(invoiceCard(page, "draft")).toContainText(/review.*mark.*sent/i);
  await expect(invoiceCard(page, "sent").getByRole("button", { name: "Mark as paid" })).toBeVisible();
  await expect(invoiceCard(page, "paid").getByRole("button", { name: /Mark as/ })).toHaveCount(0);
  await expect(invoiceCard(page, "unknown").getByRole("button", { name: /Mark as|Push QuickBooks/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Push QuickBooks" })).toHaveCount(2);
});
const memberProofExplanation = "Full invoice proof packs and printouts are available to workspace owners and managers.";
for (const width of [320, 1280]) test(`member own invoice summary remains usable without full-document actions at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")], false, [row("own")]);
  await expect(invoiceCard(page, "sent")).toContainText("INV-sent");
  await expect(invoiceCard(page, "sent")).toContainText("$50.00");
  await expect(page.getByText(memberProofExplanation, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Open proof pack|Mark as|Push QuickBooks/ })).toHaveCount(0);
  await expect(create(page)).toBeDisabled();
  await expect(page.getByRole("link", { name: /Print/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Print/i })).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh invoices" }).click();
  await expect(invoiceCard(page, "sent")).toContainText("sent");
  expect(f.forbiddenRequests).toEqual([]); expect(f.writes).toEqual([]); expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
for (const width of [320, 1280]) test(`manager full proof and print controls remain available at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")]);
  await expect(page.getByRole("link", { name: "Print", exact: true })).toHaveAttribute("href", "/api/invoices/sent/print");
  await expect(page.getByRole("button", { name: "Mark as paid" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Push QuickBooks" })).toBeEnabled();
  await page.getByRole("button", { name: "Open proof pack" }).click();
  await expect(page.getByRole("heading", { name: "INV-sent" })).toBeVisible();
  expect(f.reads).toEqual(["/api/invoices/sent/proof-pack"]); expect(f.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("losing management clears rendered proof and stale full-document click handlers", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")]);
  await page.getByRole("button", { name: "Open proof pack" }).click();
  await expect(page.getByRole("heading", { name: "INV-sent" })).toBeVisible();
  await expect(page.getByText(/Details SHA-256:/)).toBeVisible();
  await page.getByRole("button", { name: "Open proof pack" }).evaluate(button => {
    const key = Object.keys(button).find(k => k.startsWith("__reactProps$"))!;
    (window as unknown as { staleMemberProofClick: () => void }).staleMemberProofClick = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick;
  });
  f.capability(false);
  await page.getByRole("button", { name: "Refresh invoices" }).click();
  await expect(page.getByText(memberProofExplanation, { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "INV-sent" })).toHaveCount(0);
  await expect(page.getByText(/Details SHA-256:/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open proof pack" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Print/i })).toHaveCount(0);
  await page.evaluate(() => { (window as unknown as { staleMemberProofClick: () => void }).staleMemberProofClick(); });
  await page.getByRole("button", { name: "Refresh invoices" }).click();
  expect(f.forbiddenRequests).toEqual(["/api/invoices/sent/proof-pack"]); expect(f.errors).toEqual([]);
});
test("losing management ignores an already pending proof response", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")]); f.mode("late-proof");
  await page.getByRole("button", { name: "Open proof pack" }).click();
  await expect.poll(() => f.reads.length).toBe(1);
  f.capability(false); await page.getByRole("button", { name: "Refresh invoices" }).click();
  await expect(page.getByText(memberProofExplanation, { exact: true })).toBeVisible();
  await releaseProofAndObserveProcessing(page, f.release, "sent");
  await expect(page.getByRole("heading", { name: "INV-sent" })).toHaveCount(0);
  await expect(page.getByText(/Details SHA-256:/)).toHaveCount(0); expect(f.errors).toEqual([]);
});
for (const mode of ["http", "network", "malformed", "wrong-id", "wrong-status", "wrong-workspace", "wrong-project"]) test(`status ${mode} cannot confirm or replace prior displayed record`, async ({ page }) => {
  const f = await mountPerimeter(page); f.mode(mode); await page.getByRole("button", { name: "Mark as sent" }).click();
  await expect(page.getByRole("alert")).toContainText(/could not confirm/i); await expect(page.getByRole("button", { name: "Mark as sent" })).toBeEnabled();
  await expect(page.getByRole("alert")).not.toContainText("private"); expect(f.writes).toHaveLength(1); expect(f.errors).toEqual([]);
  f.mode("success"); await page.getByRole("button", { name: "Mark as sent" }).click(); await expect(page.getByRole("button", { name: "Mark as paid" })).toBeVisible();
});
test("status pending synchronous guard sends once, disables conflicts, and preserves internal confirmation", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice(), savedInvoice("sent", "sent")]); f.mode("pending");
  await page.getByRole("button", { name: "Mark as sent" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => f.writes.length).toBe(1); await expect(page.getByRole("button", { name: "Mark as paid" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Push QuickBooks" })).toBeDisabled(); await expect(page.getByRole("button", { name: "Refresh invoices" })).toBeDisabled();
  expect(f.confirmations).toHaveLength(1); expect(f.confirmations[0]).toMatch(/internal.*not shared/i); expect(f.confirmations[0]).toMatch(/not.*email|send.*separately/i);
  f.release(); await expect(page.getByRole("status").filter({ hasText: /marked as sent/i }).first()).toBeVisible(); expect(f.errors).toEqual([]);
});
test("late proof for a previous invoice cannot replace the newly selected evidence", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("first", "sent"), savedInvoice("second", "sent")]); f.mode("late-proof");
  await invoiceCard(page, "first").getByRole("button", { name: "Open proof pack" }).click(); await invoiceCard(page, "second").getByRole("button", { name: "Open proof pack" }).click();
  await expect(page.getByRole("heading", { name: "INV-second" })).toBeVisible();
  await releaseProofAndObserveProcessing(page, f.release, "first");
  await expect(page.getByRole("heading", { name: "INV-second" })).toBeVisible();
});
for (const mode of ["http", "network", "malformed"]) test(`push ${mode} preserves invoice and describes unknown outcome without retry or false success`, async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")]); f.mode(mode); await page.getByRole("button", { name: "Push QuickBooks" }).click();
  await expect(page.getByRole("alert")).toContainText(/could not confirm.*QuickBooks/i); await expect(page.getByRole("alert")).toContainText(/check QuickBooks.*retry/i); await expect(page.getByRole("alert")).not.toContainText("private");
  expect(f.writes).toHaveLength(1); await expect(page.getByRole("button", { name: "Mark as paid" })).toBeVisible();
  f.mode("reused"); await page.getByRole("button", { name: "Push QuickBooks" }).click(); await expect(page.getByRole("status").filter({ hasText: /already linked/i }).first()).toBeVisible(); expect(f.errors).toEqual([]);
});
test("push pending prevents duplicate and conflicting financial requests until confirmed", async ({ page }) => {
  const f = await mountPerimeter(page, [savedInvoice("sent", "sent")]); f.mode("pending");
  await page.getByRole("button", { name: "Push QuickBooks" }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => f.writes.length).toBe(1); await expect(page.getByRole("button", { name: "Mark as paid" })).toBeDisabled(); f.release(); await expect(page.getByRole("status").filter({ hasText: /linked to QuickBooks/i }).first()).toBeVisible(); expect(f.errors).toEqual([]);
});
for (const width of [320, 390, 1440]) test(`invoice controls and conservative unknown-audience confirmation fit keyboard ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 }); const f = await mountPerimeter(page, [savedInvoice("unknown-audience", "draft", "unknown")]);
  await page.getByRole("button", { name: "Mark as sent" }).focus(); await page.keyboard.press("Enter"); await expect(page.getByRole("button", { name: "Mark as paid" })).toBeVisible();
  expect(f.confirmations[0]).toMatch(/access.*(depends|verified)|cannot.*confirm.*portal/i); expect(f.confirmations[0]).toMatch(/not.*email|send.*separately/i);
  await page.getByRole("button", { name: "Mark as paid" }).click(); await expect(page.getByRole("button", { name: /Mark as/ })).toHaveCount(0); expect(f.confirmations[1]).toMatch(/received payment outside SOWLedger/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(f.errors).toEqual([]);
});
