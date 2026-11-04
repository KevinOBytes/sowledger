import { expect, test, type Page } from "@playwright/test";
import { build } from "esbuild";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const root = path.resolve(__dirname, "..");
let script: string;
let css: string;
let screenshots: string;
const startsAt = "2026-10-30T09:00:00.000Z";
const endsAt = "2026-10-30T11:00:00.000Z";

// Keep these assumptions when the normal, app-backed Playwright config discovers this spec.
test.use({ timezoneId: "UTC" });

type Block = {
  id: string;
  userId: string;
  title: string;
  projectId: string | null;
  taskId: string | null;
  actionId: string | null;
  notes: string | null;
  tags: string[];
  startsAt: string;
  endsAt: string;
  status: "planned" | "in_progress" | "completed" | "skipped" | "canceled";
  linkedTimeEntryId: string | null;
  hasRecordedTime?: boolean;
  isImported?: boolean;
};
type Entry = { id: string; userId: string; scheduledBlockId: string; startedAt: string; stoppedAt: string | null; durationSeconds: number | null; taskId: string; source: "web" | "calendar" };

test.beforeAll(async () => {
  screenshots = await mkdtemp(path.join(tmpdir(), "sowledger-calendar-actions-"));
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `import { createRoot } from "react-dom/client"; import { CalendarView } from "./components/calendar-view"; createRoot(document.getElementById("root")).render(<main className="min-w-0 p-4"><CalendarView /></main>);`,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  script = bundle.outputFiles[0].text;
  css = (await postcss([tailwind({ base: root })]).process(await readFile(path.join(root, "app/globals.css"), "utf8"), { from: path.join(root, "app/globals.css") })).css;
});

async function mount(page: Page, overrides: Partial<Block> = {}, seededEntries: Entry[] = []) {
  const block: Block = { id: "block", userId: "owner", title: "Client review", projectId: null, taskId: null, actionId: null, notes: null, tags: [], startsAt, endsAt, status: "planned", linkedTimeEntryId: null, ...overrides };
  const entries = seededEntries.map((entry) => ({ ...entry }));
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-30T12:00:00.000Z") });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== "https://calendar-actions.test") return route.abort();
    if (url.pathname === "/fixture") return route.fulfill({ contentType: "text/html", body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
    if (url.pathname === "/api/calendar") return route.fulfill({ json: { entries } });
    if (url.pathname === "/api/schedule") {
      if (request.method() === "GET") return route.fulfill({ json: { blocks: [block] } });
      const body = request.postDataJSON();
      writes.push({ path: url.pathname, body });
      Object.assign(block, body);
      return route.fulfill({ json: { block } });
    }
    if (url.pathname === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (url.pathname === "/api/user/actions") return route.fulfill({ json: { actions: [] } });
    if (url.pathname === "/api/people") return route.fulfill({ json: { people: [{ id: "other", linkedUserId: "other", displayName: "Other member", email: null, personType: "member", invitationStatus: "accepted" }] } });
    if (url.pathname === "/api/user/settings") return route.fulfill({ json: { user: { timezone: "UTC", calendarPreferences: { visibleStartHour: 8, visibleEndHour: 18 } } } });
    if (url.pathname === "/api/auth/me") return route.fulfill({ json: { session: { sub: "owner", email: "owner@example.com", role: "owner", workspaceId: "studio" } } });
    if (url.pathname === "/api/timer/start" || url.pathname === "/api/timer/manual") {
      writes.push({ path: url.pathname, body: request.postDataJSON() });
      const running = url.pathname.endsWith("start");
      block.status = running ? "in_progress" : "completed";
      block.linkedTimeEntryId = "entry";
      entries.push({ id: "entry", userId: "owner", scheduledBlockId: block.id, startedAt: startsAt, stoppedAt: running ? null : endsAt, durationSeconds: running ? null : 7200, taskId: "Client review", source: running ? "web" : "calendar" });
      return route.fulfill({ json: { ok: true } });
    }
    return route.abort();
  });
  await page.goto("https://calendar-actions.test/fixture");
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: script });
  await expect(page.getByText("Loading calendar...", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: block.userId === "owner" ? "Day" : "Team", exact: true }).click();
  return { block, writes, errors };
}

const completedEntry: Entry = { id: "entry", userId: "owner", scheduledBlockId: "block", startedAt: startsAt, stoppedAt: endsAt, durationSeconds: 7200, taskId: "Recorded review", source: "calendar" };

for (const scenario of [
  { name: "running", block: { status: "in_progress" as const, linkedTimeEntryId: "entry" }, entries: [{ ...completedEntry, stoppedAt: null, durationSeconds: null, source: "web" as const }], message: "Stop the running timer from your dashboard." },
  { name: "completed", block: { status: "completed" as const, linkedTimeEntryId: "entry" }, entries: [completedEntry], message: "Time has already been recorded for this block." },
  { name: "skipped", block: { status: "skipped" as const }, entries: [], message: "This block was skipped. Duplicate it to plan the work again." },
  { name: "linked planned", block: { linkedTimeEntryId: "entry" }, entries: [], message: "Time has already been recorded for this block." },
  { name: "forward-linked planned", block: {}, entries: [completedEntry], message: "Time has already been recorded for this block." },
  { name: "server-recorded planned", block: { hasRecordedTime: true }, entries: [], message: "Time has already been recorded for this block." },
  { name: "unavailable", block: { tags: ["unavailable"] }, entries: [], message: "Unavailable blocks reserve time; they cannot be logged as work." },
  { name: "other assignee", block: { userId: "other" }, entries: [], message: "Only the assigned person can start a timer or log this work." },
]) {
  test(`${scenario.name} blocks do not offer a second or invalid time entry`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { writes, errors } = await mount(page, scenario.block, scenario.entries);
    const card = page.getByTestId("calendar-block");
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("button", { name: "Log", exact: true })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Start timer from scheduled work", exact: true })).toHaveCount(0);
    await card.getByText("Client review", { exact: true }).click();
    const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
    await expect(actions.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
    await expect(actions.getByRole("button", { name: "Start", exact: true })).toHaveCount(0);
    await expect(actions.getByText(scenario.message, { exact: true })).toBeVisible();
    if (scenario.name === "running") await expect(actions.getByRole("link", { name: "Go to timer", exact: true })).toHaveAttribute("href", "/dashboard");
    if (scenario.name.includes("linked") || scenario.name.includes("recorded") || scenario.name === "completed") await expect(actions.getByRole("link", { name: "Review in Activity", exact: true })).toHaveAttribute("href", "/activity");
    await page.screenshot({ path: path.join(screenshots, `${scenario.name.replaceAll(" ", "-")}-390.png`) });
    await actions.getByRole("button", { name: "Edit", exact: true }).click();
    const composer = page.getByRole("dialog", { name: "Calendar event composer" });
    await expect(composer.getByRole("button", { name: "Completed time", exact: true })).toBeDisabled();
    await expect(composer.getByText(scenario.message, { exact: true })).toBeVisible();
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("canceled blocks are absent in day and month views", async ({ page }) => {
  const { writes } = await mount(page, { status: "canceled" });
  await expect(page.getByTestId("calendar-block")).toHaveCount(0);
  await page.getByRole("button", { name: "Month", exact: true }).click();
  await expect(page.getByText("Client review", { exact: true })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("starting planned work updates the open actions to the timer handoff", async ({ page }) => {
  const { writes, errors } = await mount(page);
  const card = page.getByTestId("calendar-block");
  await card.getByText("Client review", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await actions.getByRole("button", { name: "Start", exact: true }).click();
  await expect(actions.getByRole("link", { name: "Go to timer", exact: true })).toHaveAttribute("href", "/dashboard");
  await expect(actions.getByRole("button", { name: "Complete", exact: true })).toHaveCount(0);
  await expect(card.getByRole("link", { name: "View timer", exact: true })).toHaveAttribute("href", "/dashboard");
  expect(writes).toEqual([{ path: "/api/timer/start", body: { taskId: "Client review", description: "Client review", tags: [], scheduledBlockId: "block" } }]);
  expect(errors).toEqual([]);
});

test("tracked work keeps dates and assignment read-only while allowing descriptive edits", async ({ page }) => {
  const { writes, errors } = await mount(page, { status: "completed", linkedTimeEntryId: "entry" }, [completedEntry]);
  const card = page.getByTestId("calendar-block");
  await expect(card.getByRole("button", { name: /Resize|Drag to reschedule|Next slot/ })).toHaveCount(0);
  await card.focus();
  await page.keyboard.press("ArrowDown");
  expect(writes).toEqual([]);
  await card.getByText("Client review", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await expect(actions.getByRole("button", { name: /^(Next slot|Skip|Cancel)$/ })).toHaveCount(0);
  await expect(actions.getByRole("button", { name: "Duplicate", exact: true })).toBeEnabled();
  await actions.getByRole("button", { name: "Edit", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  for (const name of ["Starts", "Ends", "Work label"]) await expect(composer.getByRole("textbox", { name, exact: true })).toBeDisabled();
  for (const name of ["Project", "Assignee", "Work type / rate"]) await expect(composer.getByRole("combobox", { name, exact: true })).toBeDisabled();
  await composer.getByLabel("Title", { exact: true }).fill("Reviewed client work");
  await composer.getByLabel("Notes", { exact: true }).fill("Confirmed the deliverables.");
  await composer.getByRole("button", { name: "Save scheduled work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  expect(writes).toEqual([{ path: "/api/schedule", body: { blockId: "block", title: "Reviewed client work", notes: "Confirmed the deliverables.", tags: [] } }]);
  expect(errors).toEqual([]);
});

test("imported Google events have no direct mutation or duplicate controls", async ({ page }) => {
  const { writes } = await mount(page, { tags: ["external-calendar", "unavailable"] });
  const card = page.getByTestId("calendar-block");
  await card.getByText("Client review", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await expect(actions.getByRole("button", { name: /^(Start|Complete|Duplicate|Next slot|Edit|Skip|Cancel)$/ })).toHaveCount(0);
  await expect(actions).toContainText("Edit the event in Google Calendar, then sync again.");
  await expect(actions.getByRole("link", { name: "Integration settings", exact: true })).toHaveAttribute("href", "/integrations");
  expect(writes).toEqual([]);
});

test("durable imported status remains read-only after imported tags are removed", async ({ page }) => {
  const { writes } = await mount(page, { isImported: true, tags: [] });
  const card = page.getByTestId("calendar-block");
  await expect(card.getByRole("button", { name: /Log|Start timer|Drag to reschedule|Resize/ })).toHaveCount(0);
  await card.getByText("Client review", { exact: true }).click();
  const actions = page.getByRole("dialog", { name: "Scheduled work actions" });
  await expect(actions.getByRole("button", { name: /^(Start|Complete|Duplicate|Next slot|Edit|Skip|Cancel)$/ })).toHaveCount(0);
  await expect(actions).toContainText("Edit the event in Google Calendar, then sync again.");
  expect(writes).toEqual([]);
});

test("an unlinked planned block still logs time and then offers Activity instead", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { writes, errors } = await mount(page);
  const card = page.getByTestId("calendar-block");
  await card.getByRole("button", { name: "Log", exact: true }).click();
  const composer = page.getByRole("dialog", { name: "Calendar event composer" });
  await expect(composer.getByRole("button", { name: "Completed time", exact: true })).toBeEnabled();
  await composer.getByRole("button", { name: "Log completed work", exact: true }).click();
  await expect(composer).toHaveCount(0);
  await card.getByText("Client review", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Scheduled work actions" }).getByRole("link", { name: "Review in Activity", exact: true })).toHaveAttribute("href", "/activity");
  expect(writes).toEqual([{ path: "/api/timer/manual", body: { taskId: "Client review", actionId: "", description: "Client review", tags: [], startedAt: startsAt, stoppedAt: endsAt, scheduledBlockId: "block", source: "calendar" } }]);
  expect(errors).toEqual([]);
});

test.afterAll(() => console.log(`Calendar action screenshots: ${screenshots}`));
