import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { db } from "../lib/db";
import { clients, memberships, organizations, projects, workspaceTags } from "../lib/db/schema";

// Use Next's bundled HTML parser: text, comments and script strings are not
// redirect elements. No browser/server or additional dependency is needed.
const { parse: parseHtml } = createRequire(`${process.cwd()}/package.json`)("next/dist/compiled/node-html-parser") as {
  parse: (html: string) => { querySelectorAll: (selector: string) => Array<{ getAttribute: (name: string) => string | undefined; closest: (selector: string) => unknown }> };
};

// Root owns the disposable DB/server lifecycle. Never silently skip this suite
// or fall back to another database/server when the wrapper is missing.
test.beforeAll(() => {
  expect(process.env.SOWLEDGER_TEST_DATABASE, "Run only through the disposable database wrapper").toBe("true");
});
test.setTimeout(120000);

type Session = { userId: string; workspaceId: string };
type Role = "client" | "member" | "manager" | "owner";
async function login(request: APIRequestContext, workspace: string, role: Role = "owner", email = `team-page-${crypto.randomUUID()}@example.com`) {
  const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, role, plan: "smb" })}`);
  expect(response.ok(), await response.text()).toBeTruthy();
  return await response.json() as Session;
}

async function fixture(request: APIRequestContext) {
  const suffix = crypto.randomUUID();
  const workspace = `team-page-${suffix}`;
  const owner = await login(request, workspace);
  const portalEmail = `portal-${suffix}@example.com`;
  const sharedClient = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: `shared-client-${suffix}`, email: portalEmail };
  const privateClient = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: `private-client-${suffix}`, email: `private-billing-${suffix}@example.com` };
  await db.insert(clients).values([sharedClient, privateClient]);
  const sharedProject = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: `shared-project-${suffix}`, clientId: sharedClient.id };
  const privateProject = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: `private-project-${suffix}`, clientId: privateClient.id };
  await db.insert(projects).values([sharedProject, privateProject]);
  const organization = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, clientId: privateClient.id, name: `private-organization-${suffix}`, type: "client" as const };
  await db.insert(organizations).values(organization);
  const tag = { id: crypto.randomUUID(), workspaceId: owner.workspaceId, name: `private-tag-${suffix}`, projectId: privateProject.id };
  await db.insert(workspaceTags).values(tag);
  const privateTokens = [privateClient.id, privateClient.name, privateClient.email, privateProject.id, privateProject.name, organization.id, organization.name, tag.id, tag.name];
  return { workspace, owner, portalEmail, sharedProject, privateProject, privateClient, organization, tag, privateTokens };
}

const requestKinds: Array<{ name: string; headers: Record<string, string> }> = [
  { name: "ordinary HTML", headers: { Accept: "text/html" } },
  { name: "RSC", headers: { RSC: "1" } },
  { name: "prefetch-like RSC", headers: { RSC: "1", "Next-Router-Prefetch": "1", Purpose: "prefetch", "Next-Url": "/dashboard" } },
];
function paths(state: Awaited<ReturnType<typeof fixture>>) {
  return ["/clients", "/projects", `/projects/${state.privateProject.id}`, "/people", "/settings/tags"];
}

function noPrivateData(body: string, tokens: string[], requestedPath: string) {
  for (const token of tokens) {
    // The caller supplied this path parameter: Next may echo it in routing
    // state independently of page data. Every other ID, name and email is secret.
    if (requestedPath === `/projects/${token}`) continue;
    expect(body, `Private token disclosed by ${requestedPath}`).not.toContain(token);
  }
}

async function readPageResponse(request: APIRequestContext, pathname: string, headers: Record<string, string>, tokens: string[]) {
  let target = pathname;
  for (let hop = 0; hop <= 3; hop++) {
    const response = await request.get(target, { headers, maxRedirects: 0 });
    const body = await response.text();
    // Inspect every response, including framework normalization responses,
    // before following anything. Never follow the actual page's redirect.
    noPrivateData(body, tokens, pathname);
    const current = new URL(response.url());
    const location = response.headers().location;
    const next = location ? new URL(location, current) : null;
    const withoutHash = (url: URL) => {
      const params = new URLSearchParams(url.search);
      params.delete("_rsc");
      params.sort();
      return params.toString();
    };
    // Next 16.4.1 base-server.js validates RSC header hashes before rendering
    // and may return a same-path 307 with only `_rsc` added/replaced. An empty
    // hash is valid when no varying router headers were supplied.
    const normalization = headers.RSC === "1" && response.status() === 307 && next &&
      next.origin === current.origin && next.pathname === current.pathname &&
      !next.username && !next.password && !next.hash && next.searchParams.has("_rsc") &&
      withoutHash(next) === withoutHash(current);
    if (!normalization) return { response, body };
    if (hop === 3) throw new Error(`RSC normalization exceeded 3 hops for ${pathname}`);
    target = next.href;
  }
  throw new Error("Unreachable RSC traversal state");
}

function flightMapEntries(value: unknown): Array<[string, unknown]> {
  expect(Array.isArray(value), "A Flight route Map must reference an entries array").toBe(true);
  const keys = new Set<string>();
  return (value as unknown[]).map((entry) => {
    expect(Array.isArray(entry), "A Flight Map entry must be a key/value pair").toBe(true);
    const pair = entry as unknown[];
    expect(pair).toHaveLength(2);
    expect(typeof pair[0]).toBe("string");
    const key = pair[0] as string;
    expect(keys.has(key), "Duplicate Map keys must not conceal a discarded redirect or route").toBe(false);
    keys.add(key);
    return [key, pair[1]];
  });
}

function readRouteOnlyPrefetch(body: string) {
  // Only JSON models are valid in this no-render response. Do not ignore extra
  // error/import/debug rows, duplicate IDs, or unreferenced data in the body.
  const records = new Map<string, unknown>();
  const lines = body.split("\n");
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const record = line.match(/^([0-9a-f]+):([\[{].*)$/);
    expect(record, "Unexpected route-only Flight record").toBeTruthy();
    expect(records.has(record![1]), "Duplicate route-only Flight record").toBe(false);
    records.set(record![1], JSON.parse(record![2]));
  }
  expect(records.has("0"), "Missing route-only Flight root").toBe(true);
  const referenced = new Set(["0"]);
  const activeMaps = new Set<string>();
  const resolve = (value: unknown): unknown => {
    if (typeof value === "string") {
      const reference = value.match(/^\$Q([0-9a-f]+)$/);
      if (!reference) return value;
      const id = reference[1];
      expect(records.has(id), "Missing route-only Map record").toBe(true);
      expect(activeMaps.has(id), "Cyclic route-only Map reference").toBe(false);
      referenced.add(id);
      activeMaps.add(id);
      const result = new Map(flightMapEntries(records.get(id)).map(([key, child]) => [key, resolve(child)]));
      activeMaps.delete(id);
      return result;
    }
    if (Array.isArray(value)) return value.map(resolve);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolve(child)]));
    return value;
  };
  const payload = resolve(records.get("0"));
  expect([...records.keys()].sort(), "Unreferenced route-only Flight data").toEqual([...referenced].sort());
  return payload;
}

async function redirected(response: APIResponse, body: string, destination: string) {
  // Installed make-get-server-inserted-html emits a named refresh meta tag.
  // RSC instead uses React Flight's `<hex-id>:E{...digest...}` error record
  // (react-server-dom-webpack emitErrorChunk) with Next's redirect digest.
  if (response.status() === 200) {
    const targets: string[] = [];
    const type = response.headers()["content-type"]?.split(";", 1)[0];
    if (type === "text/html") {
      for (const meta of parseHtml(body).querySelectorAll("meta")) {
        if (meta.getAttribute("id") !== "__next-page-redirect") continue;
        expect(meta.closest("template,noscript"), "Inert markup cannot redirect the current document").toBeNull();
        expect(meta.getAttribute("http-equiv")?.toLowerCase()).toBe("refresh");
        const refresh = meta.getAttribute("content")?.match(/^[01];url=(.+)$/);
        expect(refresh, "Malformed Next streamed redirect meta").toBeTruthy();
        targets.push(refresh![1]);
      }
    } else if (type === "text/x-component") {
      const records = new Map<string, { error: boolean; value: unknown }>();
      for (const line of body.split("\n")) {
        const record = line.match(/^([0-9a-f]+):(E?)([\[{"].*)$/);
        if (record) records.set(record[1], { error: record[2] === "E", value: JSON.parse(record[3]) });
      }
      // Only render-slot references below may establish a redirect. The current
      // Next consumer selects root.t; arbitrary root/debug fields are not routes.
      const object = (value: unknown): Record<string, unknown> | undefined =>
        value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
      const visited = new Set<string>();
      const activeMaps = new Set<string>();
      const visitValue = (value: unknown): void => {
        if (typeof value === "string") {
          // Next 16.4.1 transport children are Maps. React encodes their entries
          // as $Q<id>; they are model references, not incidental string markers.
          const reference = value.match(/^\$(L|@|Q)?([0-9a-f]+)$/);
          if (reference) visitRecord(reference[2], reference[1] === "Q");
        } else if (Array.isArray(value)) {
          if (value[0] === "$") {
            // In the captured producer shapes, a React element renders its
            // type and children, not arbitrary props or dev owner/stack slots.
            visitValue(value[1]);
            visitValue(object(value[3])?.children);
          } else value.forEach(visitValue);
        }
      };
      const visitRecord = (id: string, asMap = false): void => {
        if (asMap) expect(activeMaps.has(id), "Cyclic Flight Map reference").toBe(false);
        const visitedKey = asMap ? `Q${id}` : id;
        if (visited.has(visitedKey)) return;
        visited.add(visitedKey);
        const record = records.get(id);
        if (asMap) expect(record, "Missing Flight Map record").toBeDefined();
        if (!record) return;
        if (!record.error) {
          if (!asMap) return visitValue(record.value);
          activeMaps.add(id);
          for (const [, value] of flightMapEntries(record.value)) visitValue(value);
          activeMaps.delete(id);
          return;
        }
        const error = record.value as { digest?: unknown };
        if (typeof error.digest !== "string" || !error.digest.startsWith("NEXT_REDIRECT;")) return;
        const digest = error.digest.match(/^NEXT_REDIRECT;(?:replace|push);(.+);(?:307|308);$/);
        expect(digest, "Malformed Next streamed redirect digest").toBeTruthy();
        targets.push(digest![1]);
      };
      const activeRouteMaps = new Set<string>();
      const visitRoute = (value: unknown): void => {
        const node = object(value);
        expect(node, "A Flight transport route must be a node, not a lazy render reference").toBeDefined();
        expect(node, "A Flight transport route must include its segment identity").toHaveProperty("s");
        visitValue(object(node!.d)?.r);
        if (node!.c === undefined) return;
        const reference = typeof node!.c === "string" ? node!.c.match(/^\$Q([0-9a-f]+)$/) : null;
        expect(reference, "Flight transport children must be a Map reference").toBeTruthy();
        const id = reference![1];
        expect(activeRouteMaps.has(id), "Cyclic Flight route Map reference").toBe(false);
        const record = records.get(id);
        expect(record, "Missing Flight route Map record").toBeDefined();
        expect(record!.error, "Flight route Map entries cannot be an error record").toBe(false);
        activeRouteMaps.add(id);
        for (const [, child] of flightMapEntries(record!.value)) visitRoute(child);
        activeRouteMaps.delete(id);
      };
      const root = records.get("0");
      if (root?.error) visitRecord("0");
      else {
        // fetch-server-response.js selects flightResponse.t; the transport
        // decoder selects each route's d.r and the head's r as render payloads.
        const transport = object(object(root?.value)?.t);
        if (transport) {
          visitRoute(transport.t);
          visitValue(object(transport.h)?.r);
        }
      }
    }
    expect(targets.length, "Expected a genuine Next streamed redirect representation").toBeGreaterThan(0);
    for (const target of targets) {
      // Exact URL equality also rejects cross-origin, query/hash lookalikes,
      // credentials and paths such as /client-other.
      expect(new URL(target, response.url()).href).toBe(new URL(destination, response.url()).href);
    }
  } else {
    expect([307, 308]).toContain(response.status());
    const target = new URL(response.headers().location, response.url());
    expect(target.href).toBe(new URL(destination, response.url()).href);
  }
}

async function assertPageDenied(request: APIRequestContext, pathname: string, headers: Record<string, string>, tokens: string[], destination: string) {
  let { response, body } = await readPageResponse(request, pathname, headers, tokens);
  if (headers.RSC === "1" && headers["Next-Router-Prefetch"] === "1" && response.status() === 200) {
    // Next 16.4.1 walk-tree-with-flight-router-state.js:86–103 may skip
    // components. Its transport tree has Map children, no segment data (`d`),
    // and a null/partial head. Accept only this exact no-render shape.
    expect(response.headers()["content-type"]).toContain("text/x-component");
    const payload = readRouteOnlyPrefetch(body);
    const node = (segment: unknown, child: unknown) => ({ s: segment, c: new Map([["children", child]]) });
    let tree: unknown = { s: "__PAGE__" };
    const segments = pathname.slice(1).split("/");
    for (let index = segments.length - 1; index >= 0; index--) {
      const segment = segments[0] === "projects" && index === 1 ? { n: "projectId", t: "d", k: segments[index], s: [] } : segments[index];
      tree = node(segment, tree);
    }
    tree = { ...node("", node("(app)", tree)), h: 16 };
    expect(payload).toEqual({ q: "", i: true, S: false, r: "$undefined", b: "development", t: { t: tree, h: { r: [null, null], p: true, v: null } } });

    // This proved only prefetch privacy, not the guard. Use the same request
    // context/cookies/path, remove prefetch controls, inspect every normalized
    // response again, and require the actual navigation denial below.
    const navigationHeaders = { ...headers };
    delete navigationHeaders["Next-Router-Prefetch"];
    delete navigationHeaders["Next-Router-Segment-Prefetch"];
    delete navigationHeaders.Purpose;
    ({ response, body } = await readPageResponse(request, pathname, navigationHeaders, tokens));
  }
  await redirected(response, body, destination);
}

for (const kind of requestKinds) {
  test(`client cannot read team-page data or metadata in ${kind.name} redirect bodies`, async ({ request }) => {
    const state = await fixture(request);
    await login(request, state.workspace, "client", state.portalEmail);
    for (const pathname of paths(state)) {
      await assertPageDenied(request, pathname, kind.headers, [...state.privateTokens, state.sharedProject.name], "/client");
    }
  });
}

test("current membership defeats a stale owner-role cookie on every team page", async ({ request }) => {
  const state = await fixture(request);
  await db.update(memberships).set({ role: "client" }).where(and(eq(memberships.workspaceId, state.owner.workspaceId), eq(memberships.userId, state.owner.userId)));
  for (const pathname of paths(state)) {
    const response = await request.get(pathname, { maxRedirects: 0 });
    const body = await response.text();
    noPrivateData(body, state.privateTokens, pathname);
    await redirected(response, body, "/client");
  }
});

test("client portal remains reachable and does not return another client's project", async ({ request, page }) => {
  const state = await fixture(request);
  await login(page.request, state.workspace, "client", state.portalEmail);
  const response = await page.goto("/client");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Projects and invoices", exact: true })).toBeVisible();
  const payload = await page.request.get("/api/client");
  expect(payload.status()).toBe(200);
  const body = await payload.text();
  expect(body).toContain(state.sharedProject.id);
  expect(body).toContain(state.sharedProject.name);
  noPrivateData(body, state.privateTokens, "/api/client");
});

for (const role of ["member", "manager", "owner"] as const) {
  test(`${role} retains all team pages and project metadata without cross-workspace data`, async ({ request }) => {
    const foreign = await fixture(request);
    const own = await fixture(request);
    await login(request, own.workspace, role);
    for (const pathname of paths(own)) {
      const response = await request.get(pathname, { headers: { Accept: "text/html", "User-Agent": "Googlebot" }, maxRedirects: 0 });
      expect(response.status()).toBe(200);
      const body = await response.text();
      noPrivateData(body, foreign.privateTokens, pathname);
      const expected = pathname === "/clients" ? own.privateClient.name : pathname === "/people" ? own.organization.name : pathname === "/settings/tags" ? own.tag.name : own.privateProject.name;
      expect(body).toContain(expected);
      if (pathname === `/projects/${own.privateProject.id}`) expect(body).toMatch(new RegExp(`<title>[^<]*${own.privateProject.name}`));
    }
    for (const kind of requestKinds) {
      const pathname = `/projects/${foreign.privateProject.id}`;
      await assertPageDenied(request, pathname, kind.headers, foreign.privateTokens, "/projects");
    }
  });
}

test("anonymous requests never receive team data in HTML, RSC or prefetch bodies", async ({ request, playwright }) => {
  const state = await fixture(request);
  const anonymous = await playwright.request.newContext({ baseURL: test.info().project.use.baseURL });
  try {
    for (const kind of requestKinds) {
      for (const pathname of paths(state)) {
        await assertPageDenied(anonymous, pathname, kind.headers, state.privateTokens, "/login");
      }
    }
  } finally { await anonymous.dispose(); }
});
