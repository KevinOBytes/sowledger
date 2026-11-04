import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";

type Consent = {
  readBrowserConsent(header?: string): boolean;
  subscribeBrowserConsent(listener: () => void): () => void;
  setBrowserConsent(accepted: boolean): void;
};

// This executes the shared production parser/subscription source. Browser I/O
// alone is controlled; no parser or consent decision is reimplemented here.
function fixture(options: { server?: boolean; storageFails?: boolean; cookieFails?: boolean; cookieWrite?: "store" | "throw" | "ignore" } = {}) {
  const filename = path.join(process.cwd(), "lib/browser-consent.ts");
  assert.ok(existsSync(filename), "Shared exact-cookie consent module has not been implemented yet");
  let cookie = "";
  let cookieWrite = options.cookieWrite ?? "store";
  const listeners = new Map<string, Set<() => void>>();
  const timers = new Map<number, { callback: () => void; delay: number }>();
  let timerId = 0;
  const browser = {
    addEventListener(name: string, listener: () => void) {
      const group = listeners.get(name) ?? new Set(); group.add(listener); listeners.set(name, group);
    },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    dispatchEvent(event: Event) { for (const callback of [...listeners.get(event.type) ?? []]) callback(); return true; },
    setInterval(callback: () => void, delay: number) { timers.set(++timerId, { callback, delay }); return timerId; },
    clearInterval(id: number) { timers.delete(id); },
    localStorage: { setItem() { if (options.storageFails) throw new Error("Synthetic blocked storage"); }, getItem() { return null; }, removeItem() {} },
  };
  const documentBoundary = {
    get cookie() { return cookie; },
    set cookie(value: string) {
      if (options.cookieFails || cookieWrite === "throw") throw new Error("Synthetic blocked cookies");
      if (cookieWrite === "ignore") return;
      cookie = value.split(";")[0];
    },
    visibilityState: "visible",
    addEventListener: browser.addEventListener,
    removeEventListener: browser.removeEventListener,
  };
  const loaded = { exports: {} };
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", "window", "document", "localStorage", "setInterval", "clearInterval", "Event", "CustomEvent", source)(
    loaded, loaded.exports, (id: string) => assert.fail(`Unexpected dependency ${id}`),
    options.server ? undefined : browser, options.server ? undefined : documentBoundary,
    browser.localStorage, browser.setInterval, browser.clearInterval, Event, Event,
  );
  return {
    api: loaded.exports as Consent, timers, listeners,
    rawCookie(value: string) { cookie = value; },
    cookieWrites(mode: "store" | "throw" | "ignore") { cookieWrite = mode; },
    cookie: () => cookie,
    emit(name: string) { browser.dispatchEvent(new Event(name)); },
    tick() { for (const timer of [...timers.values()]) timer.callback(); },
  };
}

const cases: Array<[string, boolean]> = [
  ["", false], ["necessary=session", false], ["sowledger-cookie-consent=false", false],
  ["sowledger-cookie-consent=true", true], ["necessary=session; sowledger-cookie-consent=true; theme=light", true],
  ["shadow-sowledger-cookie-consent=true", false], ["sowledger-cookie-consent=true-shadow", false],
  ["sowledger-cookie-consent=True", false], ["sowledger-cookie-consent=1", false],
  ["sowledger-cookie-consent= true", false], ["sowledger-cookie-consent=true%20", false],
  ["sowledger-cookie-consent =true", false],
  ["sowledger-cookie-consent=%74rue", false], ['sowledger-cookie-consent="true"', false],
  ["sowledger-cookie-consent=", false], ["sowledger-cookie-consent", false],
  ["sowledger-cookie-consent=true=false", false], ["SOWLEDGER-cookie-consent=true", false],
  ["sowledger-cookie-consent=true; sowledger-cookie-consent=false", false],
  ["sowledger-cookie-consent=false; sowledger-cookie-consent=true", false],
  ["sowledger-cookie-consent=true; sowledger-cookie-consent=true", false],
  ["sowledger-cookie-consent; sowledger-cookie-consent=true", false],
];
for (const [header, expected] of cases) test(`exact optional consent: ${JSON.stringify(header)}`, () => {
  assert.equal(fixture().api.readBrowserConsent(header), expected);
});

test("server import starts denied without touching browser globals", () => {
  const f = fixture({ server: true });
  assert.equal(f.api.readBrowserConsent(), false);
  const unsubscribe = f.api.subscribeBrowserConsent(() => assert.fail("Server notified"));
  assert.doesNotThrow(unsubscribe);
  assert.equal(f.timers.size, 0);
});

test("actual consent writes notify the current tab synchronously and preserve literal false", () => {
  const f = fixture();
  const decisions: boolean[] = [];
  const unsubscribe = f.api.subscribeBrowserConsent(() => decisions.push(f.api.readBrowserConsent()));
  f.api.setBrowserConsent(true);
  assert.equal(f.cookie(), "sowledger-cookie-consent=true");
  assert.equal(decisions.at(-1), true, "Do not wait for a reload or fallback interval");
  f.api.setBrowserConsent(false);
  assert.equal(f.cookie(), "sowledger-cookie-consent=false");
  assert.equal(decisions.at(-1), false);
  unsubscribe();
});

test("storage/focus and bounded fallback recheck the actual cookie, and last unsubscribe disposes resources", () => {
  const f = fixture();
  const decisions: boolean[] = [];
  const unsubscribe = f.api.subscribeBrowserConsent(() => decisions.push(f.api.readBrowserConsent()));
  for (const event of ["storage", "focus"]) {
    f.rawCookie("sowledger-cookie-consent=true"); f.emit(event); assert.equal(decisions.at(-1), true);
    f.rawCookie("sowledger-cookie-consent=false"); f.emit(event); assert.equal(decisions.at(-1), false);
  }
  assert.ok(f.timers.size > 0, "Cookie changes without events still need a bounded fallback");
  for (const timer of f.timers.values()) assert.ok(timer.delay > 0 && timer.delay <= 5000, "Bounded fallback must recheck within five seconds without a busy loop");
  f.rawCookie("sowledger-cookie-consent=true"); f.tick(); assert.equal(decisions.at(-1), true);
  unsubscribe();
  assert.equal(f.timers.size, 0);
  assert.ok([...f.listeners.values()].every(group => group.size === 0), "Dispose all browser listeners");
  const count = decisions.length; f.rawCookie(""); f.emit("focus"); f.tick(); assert.equal(decisions.length, count);
});

test("blocked storage/cookies never turns a missing browser decision into permission", () => {
  const f = fixture({ storageFails: true, cookieFails: true });
  const unsubscribe = f.api.subscribeBrowserConsent(() => undefined);
  assert.doesNotThrow(() => f.api.setBrowserConsent(true));
  assert.equal(f.api.readBrowserConsent(), false);
  unsubscribe();
});

for (const cookieWrite of ["throw", "ignore"] as const) test(`failed ${cookieWrite} revocation overrides a stale prior grant in the current page`, () => {
  const f = fixture({ storageFails: true, cookieWrite });
  f.rawCookie("sowledger-cookie-consent=true");
  assert.equal(f.api.readBrowserConsent(), true, "Start from a real prior browser grant");
  const decisions: boolean[] = [];
  const unsubscribe = f.api.subscribeBrowserConsent(() => decisions.push(f.api.readBrowserConsent()));
  decisions.length = 0;

  assert.doesNotThrow(() => f.api.setBrowserConsent(false));
  assert.equal(f.cookie(), "sowledger-cookie-consent=true", "The browser refused persistence; do not pretend the cookie was removed");
  assert.equal(f.api.readBrowserConsent(), false, "A failed revoke must deny the current page immediately despite stale storage");
  assert.equal(decisions.at(-1), false, "Subscribers must receive synchronous denial even when broadcast storage also fails");

  for (const event of ["focus", "storage"]) {
    f.emit(event);
    assert.equal(f.api.readBrowserConsent(), false, `A ${event} recheck must not resurrect the stale grant`);
  }
  assert.ok(f.timers.size > 0, "Exercise the actual bounded fallback, not only explicit events");
  for (let i = 0; i < 3; i++) {
    f.tick();
    assert.equal(f.api.readBrowserConsent(), false, "Continued fallback checks must preserve the failed-revocation denial");
  }
  assert.ok(decisions.length > 0 && decisions.every(decision => decision === false));

  // Once cookies can actually be written, a later explicit stored choice may
  // replace the local denial. Broadcast storage remains blocked throughout.
  f.cookieWrites("store");
  f.api.setBrowserConsent(false);
  assert.equal(f.cookie(), "sowledger-cookie-consent=false");
  assert.equal(f.api.readBrowserConsent(), false);
  f.api.setBrowserConsent(true);
  assert.equal(f.cookie(), "sowledger-cookie-consent=true");
  assert.equal(f.api.readBrowserConsent(), true);
  assert.equal(decisions.at(-1), true);
  unsubscribe();
});
