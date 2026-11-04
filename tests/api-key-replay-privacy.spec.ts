import { expect, test, type Page } from "@playwright/test";
import { buildApiKeyReplayFixture } from "./helpers/api-key-replay-fixture";

const origin = "https://api-key-replay.sowledger.test";
const createCanary = "sow_live_SYNTHETIC_CREATED_SECRET_DO_NOT_RECORD_0123456789";
const rotateCanary = "sow_live_SYNTHETIC_ROTATED_SECRET_DO_NOT_RECORD_9876543210";
const publicControl = "PUBLIC_REPLAY_POSITIVE_CONTROL";
let script: string;
type ReplayWindow = Window & {
  apiKeyReplay: { ready(): boolean; serialize(kind: number): string };
  copiedKey?: string;
};

test.beforeAll(async () => { script = await buildApiKeyReplayFixture(); });

async function mount(page: Page) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  const writes: Array<{ method: string; body: Record<string, unknown> }> = [];
  let created = false;
  const key = { id: "key-id", name: "Reporting integration", keyPrefix: "sow_test", scopes: ["read:time"], createdByUserId: "actor", lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: "2026-01-01T00:00:00.000Z" };
  page.on("pageerror", error => errors.push(error.message));
  await page.context().addCookies([{ name: "sowledger-cookie-consent", value: "true", url: origin, sameSite: "Lax" }]);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { (window as unknown as ReplayWindow).copiedKey = value; } } });
  });
  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin === origin && url.pathname === "/" && request.method() === "GET") {
      return route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div data-dd-privacy="allow">${publicControl}</div><div id="root"></div><script src="/fixture.js"></script></body></html>` });
    }
    if (url.origin === origin && url.pathname === "/fixture.js") return route.fulfill({ contentType: "text/javascript", body: script });
    if (url.origin === origin && url.pathname === "/api/settings/api-keys") {
      if (request.method() === "GET") return route.fulfill({ json: { ok: true, keys: created ? [key] : [], usage: [] } });
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ method: request.method(), body });
      if (request.method() === "POST") { created = true; return route.fulfill({ json: { ok: true, key, rawKey: createCanary } }); }
      if (request.method() === "PATCH" && body.keyId === key.id && body.rotate === true) return route.fulfill({ json: { ok: true, key, rawKey: rotateCanary } });
    }
    unexpected.push(`${request.method()} ${request.url()}`);
    await route.abort();
  });
  await page.goto(origin);
  await expect(page.getByRole("heading", { name: "Developers", exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as ReplayWindow).apiKeyReplay?.ready())).toBe(true);
  return { unexpected, errors, writes };
}

// Catch: removing the real secret-display privacy boundary, changing the
// Datadog level without protecting secrets, or rendering rotated keys elsewhere.
for (const flow of ["created", "rotated"] as const) {
  test(`the ${flow} API key is usable but absent from installed Datadog replay serialization`, async ({ page }) => {
    const f = await mount(page);
    await page.getByRole("button", { name: "Create API key", exact: true }).click();
    await expect(page.getByText(createCanary, { exact: true })).toBeVisible();
    if (flow === "rotated") {
      await page.getByRole("button", { name: "Rotate", exact: true }).click();
      await expect(page.getByText(rotateCanary, { exact: true })).toBeVisible();
      await expect(page.getByText(createCanary, { exact: true })).toHaveCount(0);
      expect(f.writes.at(-1)).toEqual({ method: "PATCH", body: { keyId: "key-id", rotate: true } });
    }
    const canary = flow === "created" ? createCanary : rotateCanary;
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as ReplayWindow).copiedKey)).toBe(canary);
    for (const kind of [0, 1]) {
      const replay = await page.evaluate(value => (window as unknown as ReplayWindow).apiKeyReplay.serialize(value), kind);
      expect(replay, "Positive control must prove the installed serializer actually recorded DOM text").toContain(publicControl);
      expect.soft(replay, `${flow} key must not enter ${kind === 0 ? "initial" : "subsequent"} replay snapshots`).not.toContain(createCanary);
      expect.soft(replay, `${flow} key must not enter ${kind === 0 ? "initial" : "subsequent"} replay snapshots`).not.toContain(rotateCanary);
    }
    expect(f.errors).toEqual([]);
    expect(f.unexpected).toEqual([]);
  });
}
