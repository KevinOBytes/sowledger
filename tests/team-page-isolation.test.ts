import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import type { APIRequestContext } from "@playwright/test";

// Execute the real page and shared guard code. Only external request/session,
// database, directory and child-component boundaries are replaced; no network/DB.
const root = process.cwd();
const nativeRequire = createRequire(path.join(root, "package.json"));
const { redirect } = nativeRequire("next/navigation") as { redirect: (url: string) => never };
class UnauthorizedError extends Error {}
type Row = Record<string, unknown>;
type Column = { key: string };
type Condition = (row: Row) => boolean;
type PageModule = { default: (props: unknown) => Promise<unknown>; generateMetadata: (props: unknown) => Promise<unknown> };
const entries = [
  ["clients", "app/(app)/clients/page.tsx", "default"],
  ["projects", "app/(app)/projects/page.tsx", "default"],
  ["project", "app/(app)/projects/[projectId]/page.tsx", "default"],
  ["project metadata", "app/(app)/projects/[projectId]/page.tsx", "generateMetadata"],
  ["people", "app/(app)/people/page.tsx", "default"],
  ["tags", "app/(app)/settings/tags/page.tsx", "default"],
] as const;

function fixture(role = "member", sessionError?: Error) {
  const protectedAccess: string[] = [];
  const session = { sub: "user-a", email: "member@example.com", workspaceId: "workspace-a", role, exp: Date.now() + 60000 };
  const schema = Object.fromEntries(["clients", "projects", "projectTasks", "organizations", "workspacePeople", "workspaceTags"].map(name => [name, new Proxy({ name }, {
    get(target, key: string) { return key === "name" ? target.name : { key }; },
  })]));
  const ownProject = { id: "project-a", workspaceId: "workspace-a", clientId: "client-a", name: "Own project canary", status: "active", billingModel: "hourly", percentComplete: 0 };
  const foreignProject = { ...ownProject, id: "project-b", workspaceId: "workspace-b", name: "Foreign project canary" };
  const rows: Record<string, Row[]> = {
    projects: [ownProject, foreignProject],
    clients: [{ id: "client-a", workspaceId: "workspace-a", name: "Own client canary", status: "active" }, { id: "client-b", workspaceId: "workspace-b", name: "Foreign client canary", status: "active" }],
    projectTasks: [], organizations: [], workspacePeople: [],
    workspaceTags: [{ id: "tag-a", workspaceId: "workspace-a", name: "Own tag canary", status: "active" }, { id: "tag-b", workspaceId: "workspace-b", name: "Foreign tag canary", status: "active" }],
  };
  const modules: Record<string, unknown> = {
    "server-only": {},
    "@/lib/auth": { UnauthorizedError, requireSession: async () => { if (sessionError) throw sessionError; return session; } },
    "next/navigation": { redirect },
    "@/lib/db/schema": schema,
    "@/lib/db/ensure-workspace-schema": { ensureWorkspaceSchema: async () => { protectedAccess.push("schema"); } },
    "@/lib/people-directory": { listWorkspacePeopleDirectory: async (workspaceId: string) => {
      protectedAccess.push(`directory:${workspaceId}`);
      assert.equal(workspaceId, "workspace-a");
      return { organizations: [{ id: "org-a", name: "Own organization canary" }], people: [] };
    } },
    "drizzle-orm": {
      eq: (column: Column, value: unknown): Condition => row => row[column.key] === value,
      and: (...conditions: Condition[]): Condition => row => conditions.every(condition => condition(row)),
      desc: (column: Column) => column,
    },
    "@/lib/db": { db: { select: () => {
      protectedAccess.push("select");
      let table: { name: string };
      let condition: Condition = () => true;
      const builder = {
        from(value: { name: string }) { table = value; return builder; },
        where(value: Condition) { condition = value; return builder; },
        orderBy() { return builder; },
        then(resolve: (rows: Row[]) => unknown, reject: (error: unknown) => unknown) { return Promise.resolve(rows[table.name].filter(condition)).then(resolve, reject); },
      };
      return builder;
    } } },
  };
  function load(filename: string): PageModule {
    const code = ts.transpileModule(readFileSync(path.join(root, filename), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const loaded = { exports: {} };
    new Function("require", "module", "exports", code)((specifier: string) => {
      if (specifier in modules) return modules[specifier];
      if (specifier === "@/lib/team-page-session") return modules[specifier] ??= load("lib/team-page-session.ts");
      if (specifier === "react/jsx-runtime") return nativeRequire(specifier);
      // Preserve the returned component tree/props without executing children.
      if (specifier.startsWith("@/components/") || specifier === "lucide-react") return new Proxy({}, { get: (_target, key) => String(key) });
      if (specifier === "next/link") return { __esModule: true, default: "Link" };
      throw new Error(`Unexpected dependency: ${specifier}`);
    }, loaded, loaded.exports);
    return loaded.exports as PageModule;
  }
  return {
    protectedAccess,
    async run(entry: typeof entries[number], projectId = "project-a") {
      const params = { then(resolve: (value: { projectId: string }) => unknown) { protectedAccess.push("params"); return Promise.resolve(resolve({ projectId })); } };
      return load(entry[1])[entry[2]]({ params, searchParams: Promise.resolve({}) });
    },
  };
}

function isRedirect(url: string) {
  return (error: unknown) => error instanceof Error && "digest" in error && error.digest === `NEXT_REDIRECT;replace;${url};307;`;
}

for (const entry of entries) {
  test(`${entry[0]} rejects a client before any schema/data/directory/parameter read`, async () => {
    const f = fixture("client");
    await assert.rejects(f.run(entry), isRedirect("/client"));
    assert.deepEqual(f.protectedAccess, []);
  });
  test(`${entry[0]} sends absent/invalid/revoked sessions to login without protected reads`, async () => {
    for (const message of ["Not authenticated", "Malformed token", "Membership revoked"]) {
      const f = fixture("member", new UnauthorizedError(message));
      await assert.rejects(f.run(entry), isRedirect("/login"));
      assert.deepEqual(f.protectedAccess, []);
    }
  });
  test(`${entry[0]} preserves internal failures and framework redirect exceptions`, async () => {
    let redirectError!: Error;
    try { redirect("/session-recovery"); } catch (error) { redirectError = error as Error; }
    for (const error of [new Error("Session DB unavailable"), Object.assign(new Error("Unrelated failure"), { status: 401 }), redirectError]) {
      const f = fixture("member", error);
      await assert.rejects(f.run(entry), actual => actual === error);
      assert.deepEqual(f.protectedAccess, []);
    }
  });
  test(`${entry[0]} retains owner/manager/member workspace-scoped output`, async () => {
    for (const role of ["owner", "manager", "member"]) {
      const f = fixture(role);
      const result = await f.run(entry);
      const output = JSON.stringify(result);
      assert.ok(f.protectedAccess.length > 0);
      assert.ok(!output.includes("Foreign"));
      assert.ok(!output.includes("workspace-b"));
      const expected = entry[0] === "clients" ? "Own client canary" : entry[0] === "people" ? "Own organization canary" : entry[0] === "tags" ? "Own tag canary" : "Own project canary";
      assert.ok(output.includes(expected), output);
      if (entry[0] === "project metadata") assert.deepEqual(result, { title: "Own project canary – SOWLedger" });
      if (entry[0] === "project") assert.ok(output.includes('"type":"ProjectFinancials","key":null,"props":{"projectId":"project-a","workspaceId":"workspace-a"}'));
    }
  });
}

test("foreign project IDs never produce a page or private metadata for an allowed role", async () => {
  for (const role of ["member", "manager", "owner"]) {
    const f = fixture(role);
    await assert.rejects(f.run(entries[2], "project-b"), isRedirect("/projects"));
    assert.deepEqual(await f.run(entries[3], "project-b"), { title: "Project – SOWLedger" });
  }
});

// Exercise the actual isolated-spec traversal without registering/running its
// app/DB tests. All request responses are deterministic, in-memory fixtures.
function traversalFixture(responses: Array<{ status: number; location?: string; body?: string; contentType?: string }>) {
  const requests: string[] = [];
  const requestHeaders: Array<Record<string, string>> = [];
  const registeredTest = Object.assign(() => {}, { beforeAll() {}, setTimeout() {} });
  const loaded = { exports: {} as {
    assertPageDenied: (request: APIRequestContext, pathname: string, headers: Record<string, string>, tokens: string[], destination: string) => Promise<void>;
  } };
  const code = ts.transpileModule(readFileSync(path.join(root, "tests/team-page-isolation.spec.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("require", "module", "exports", `${code}\nmodule.exports = { assertPageDenied };`)((specifier: string) => {
    if (specifier === "@playwright/test") return { expect: nativeRequire(specifier).expect, test: registeredTest };
    if (specifier === "node:module") return nativeRequire(specifier);
    assert.ok(["drizzle-orm", "../lib/db", "../lib/db/schema"].includes(specifier), specifier);
    return {};
  }, loaded, loaded.exports);
  const request = { async get(target: string, options: { headers: Record<string, string>; maxRedirects: number }) {
    assert.equal(options.maxRedirects, 0);
    assert.equal(options.headers.RSC, "1");
    const response = responses[requests.length];
    requests.push(target);
    requestHeaders.push({ ...options.headers });
    assert.ok(response, "Unexpected additional request");
    return {
      status: () => response.status,
      url: () => new URL(target, "http://localhost:3008").href,
      headers: () => ({ ...(response.location ? { location: response.location } : {}), "content-type": response.contentType ?? "text/x-component" }),
      text: async () => response.body ?? "",
    };
  } } as unknown as APIRequestContext;
  return { requests, requestHeaders, async run(headers = { RSC: "1" } as Record<string, string>, pathname = "/clients", destination = "/client") {
    return loaded.exports.assertPageDenied(request, pathname, headers, ["private-canary", "private-id"], destination);
  } };
}

test("RSC normalization reaches the real page denial and does not follow it", async () => {
  for (const hash of ["", "canonical-hash"]) {
    const f = traversalFixture([{ status: 307, location: `/clients?_rsc=${hash}` }, { status: 307, location: "/client" }]);
    await f.run();
    assert.deepEqual(f.requests, ["/clients", `http://localhost:3008/clients?_rsc=${hash}`]);
  }
});

test("RSC traversal inspects both normalization bodies and actual page bodies", async () => {
  for (const bodies of [["private-canary", ""], ["", "private-id"]]) {
    const f = traversalFixture([{ status: 307, location: "/clients?_rsc=hash", body: bodies[0] }, { status: 307, location: "/client", body: bodies[1] }]);
    await assert.rejects(f.run(), /Private token disclosed/);
    assert.equal(f.requests.length, bodies[0] ? 1 : 2);
  }
});

test("RSC traversal never accepts unrelated redirects as normalization or page denial", async () => {
  for (const location of ["https://other.example/clients?_rsc=x", "https://other.example/client", "/clients?workspace=other&_rsc=x", "/clients", "/different?_rsc=x"]) {
    const f = traversalFixture([{ status: 307, location }]);
    await assert.rejects(f.run());
    assert.equal(f.requests.length, 1);
  }
});

test("RSC normalization is bounded and still requires a real denial after normalization", async () => {
  const looping = traversalFixture(Array.from({ length: 4 }, () => ({ status: 307, location: "/clients?_rsc=same" })));
  await assert.rejects(looping.run(), /exceeded 3 hops/);
  assert.equal(looping.requests.length, 4);
  const successfulLeak = traversalFixture([{ status: 307, location: "/clients?_rsc=hash" }, { status: 200, body: "A normal team page" }]);
  await assert.rejects(successfulLeak.run());
  assert.equal(successfulLeak.requests.length, 2);
});

// Literal Next 16.4.1 dev responses captured by root, independent of the parser.
// Catch: rejecting a genuine route-only Map tree, or treating that tree alone
// as authorization instead of requiring the same-session navigation denial.
const routeOnlyPrefetch = '3:[["children",{"s":"__PAGE__"}]]\n2:[["children",{"s":"clients","c":"$Q3"}]]\n1:[["children",{"s":"(app)","c":"$Q2"}]]\n0:{"q":"","i":true,"S":false,"r":"$undefined","b":"development","t":{"t":{"s":"","h":16,"c":"$Q1"},"h":{"r":[null,null],"p":true,"v":null}}}\n';
const projectRouteOnlyPrefetch = '4:[["children",{"s":"__PAGE__"}]]\n3:[["children",{"s":{"n":"projectId","t":"d","k":"supplied-project-id","s":[]},"c":"$Q4"}]]\n2:[["children",{"s":"projects","c":"$Q3"}]]\n1:[["children",{"s":"(app)","c":"$Q2"}]]\n0:{"q":"","i":true,"S":false,"r":"$undefined","b":"development","t":{"t":{"s":"","h":16,"c":"$Q1"},"h":{"r":[null,null],"p":true,"v":null}}}\n';
// The captured navigation's essential root -> Map children -> lazy error chain.
// Removing Map-reference traversal must fail this actual-helper contract test.
const mapRedirect = '3:[["children",{"s":"__PAGE__","d":{"r":"$L4","p":false,"v":null}}]]\n2:[["children",{"s":"clients","c":"$Q3"}]]\n1:[["children",{"s":"(app)","c":"$Q2"}]]\n0:{"q":"","i":true,"S":false,"r":"$undefined","b":"development","t":{"t":{"s":"","h":16,"c":"$Q1"},"h":{"r":[null,null],"p":false,"v":null}}}\n4:E{"digest":"NEXT_REDIRECT;replace;/client;307;","name":"Error","message":"NEXT_REDIRECT","stack":[],"env":"Server","owner":null}\n';
const prefetchHeaders = { RSC: "1", "Next-Router-Prefetch": "1", Purpose: "prefetch", "Next-Url": "/dashboard" };

for (const status of [307, 308]) {
  for (const location of ["/client?next=elsewhere", "/client#wrong", "http://user:password@localhost:3008/client"]) {
    test(`HTTP ${status} denial rejects the non-exact destination ${location}`, async () => {
      for (const afterPrefetch of [false, true]) {
        const f = traversalFixture([
          ...(afterPrefetch ? [{ status: 200, body: routeOnlyPrefetch }] : []),
          { status, location },
        ]);
        await assert.rejects(f.run(afterPrefetch ? prefetchHeaders : { RSC: "1" }));
        assert.equal(f.requests.length, afterPrefetch ? 2 : 1, "The denial destination must not be followed");
      }
    });
  }
}

test("HTTP denial accepts exact relative and absolute destinations without following them", async () => {
  for (const status of [307, 308]) {
    for (const location of ["/client", "http://localhost:3008/client"]) {
      const f = traversalFixture([{ status, location }]);
      await f.run();
      assert.deepEqual(f.requests, ["/clients"]);
    }
  }
});

test("precise route-only prefetch requires a same-session non-prefetch actual denial", async () => {
  const f = traversalFixture([
    { status: 307, location: "/clients?_rsc=prefetch-hash" },
    { status: 200, body: routeOnlyPrefetch },
    { status: 307, location: "/clients?_rsc=navigation-hash" },
    { status: 307, location: "/client" },
  ]);
  await f.run(prefetchHeaders);
  assert.deepEqual(f.requests, ["/clients", "http://localhost:3008/clients?_rsc=prefetch-hash", "/clients", "http://localhost:3008/clients?_rsc=navigation-hash"]);
  assert.equal(f.requestHeaders[0]["Next-Router-Prefetch"], "1");
  assert.deepEqual(f.requestHeaders[2], { RSC: "1", "Next-Url": "/dashboard" });
});

test("a dynamic route-only Map tree must match the supplied project path before navigation", async () => {
  const f = traversalFixture([{ status: 200, body: projectRouteOnlyPrefetch }, { status: 307, location: "/projects" }]);
  await f.run(prefetchHeaders, "/projects/supplied-project-id", "/projects");
  assert.deepEqual(f.requests, ["/projects/supplied-project-id", "/projects/supplied-project-id"]);
  assert.deepEqual(f.requestHeaders[1], { RSC: "1", "Next-Url": "/dashboard" });
  const wrongPath = traversalFixture([{ status: 200, body: projectRouteOnlyPrefetch }]);
  await assert.rejects(wrongPath.run(prefetchHeaders, "/projects/different-id", "/projects"));
  assert.equal(wrongPath.requests.length, 1);
});

test("prefetch rejects arbitrary 200, populated seed/head and unexpected Flight content", async () => {
  const bodies = [
    "A normal successful page", "<html>NEXT_REDIRECT /client</html>", "0:{}\n",
    `${routeOnlyPrefetch}9:{"unexpected":"data"}\n`,
    routeOnlyPrefetch.replace('"s":"__PAGE__"', '"s":"__PAGE__","d":{"r":"rendered-segment","p":false,"v":null}'),
    routeOnlyPrefetch.replace('"r":[null,null]', '"r":[["title","Private project"],null]'),
    routeOnlyPrefetch.replace('"q":""', '"q":"","unexpected":"unreviewed-data"'),
    routeOnlyPrefetch.replace('"h":{"r":[null,null],"p":true,"v":null}', '"h":{"r":[null,null],"p":true,"v":null,"title":"Populated head"}'),
    routeOnlyPrefetch.replace('"s":"clients"', '"s":"other-route"'),
    routeOnlyPrefetch.replace("clients", "private-canary"),
  ];
  for (const body of bodies) {
    const f = traversalFixture([{ status: 200, body }]);
    await assert.rejects(f.run(prefetchHeaders));
    assert.equal(f.requests.length, 1, "Invalid prefetch must not proceed to navigation");
  }
  const wrongContentType = traversalFixture([{ status: 200, body: routeOnlyPrefetch, contentType: "text/html" }]);
  await assert.rejects(wrongContentType.run(prefetchHeaders));
});

test("route-only prefetch rejects malformed, missing, cyclic, duplicate and extra Map records", async () => {
  const bodies = [
    routeOnlyPrefetch.replace('3:[["children",{"s":"__PAGE__"}]]', '3:{"children":{"s":"__PAGE__"}}'),
    routeOnlyPrefetch.replace('3:[["children",{"s":"__PAGE__"}]]', '3:[["children"]]'),
    routeOnlyPrefetch.replace('3:[["children",{"s":"__PAGE__"}]]\n', ''),
    routeOnlyPrefetch.replace('"c":"$Q3"', '"c":"$Q1"'),
    routeOnlyPrefetch.replace('3:[["children",{"s":"__PAGE__"}]]', '3:[["children",{"s":"__PAGE__"}],["children",{"s":"__PAGE__"}]]'),
    routeOnlyPrefetch.replace('3:[["children",{"s":"__PAGE__"}]]', '3:[["children",{"s":"__PAGE__"}],["sidebar",{"s":"unexpected-route"}]]'),
    `${routeOnlyPrefetch}9:[["children",{"s":"unreachable-route"}]]\n`,
    `${routeOnlyPrefetch}3:[["children",{"s":"__PAGE__"}]]\n`,
    routeOnlyPrefetch.replace('"c":"$Q1"', () => '"c":"$$Q1"'),
  ];
  for (const body of bodies) {
    const f = traversalFixture([{ status: 200, body }]);
    await assert.rejects(f.run(prefetchHeaders));
    assert.equal(f.requests.length, 1, "Malformed Map data must not trigger the navigation fallback");
  }
});

test("route-only prefetch never substitutes for an actual navigation denial", async () => {
  for (const body of [routeOnlyPrefetch, "Normal navigation page", "private-id"]) {
    const f = traversalFixture([{ status: 200, body: routeOnlyPrefetch }, { status: 200, body }]);
    await assert.rejects(f.run(prefetchHeaders));
    assert.equal(f.requests.length, 2);
  }
  const nonPrefetch = traversalFixture([{ status: 200, body: routeOnlyPrefetch }]);
  await assert.rejects(nonPrefetch.run());
  assert.equal(nonPrefetch.requests.length, 1);
  const loop = traversalFixture([{ status: 200, body: routeOnlyPrefetch }, ...Array.from({ length: 4 }, () => ({ status: 307, location: "/clients?_rsc=loop" }))]);
  await assert.rejects(loop.run(prefetchHeaders), /exceeded 3 hops/);
  assert.equal(loop.requests.length, 5);
});

test("incidental redirect marker/link text never establishes a streamed denial", async () => {
  const incidental = '<html><a href="/client">Client portal</a><p>NEXT_REDIRECT reference text; normal rendered team page</p></html>';
  for (const afterPrefetch of [false, true]) {
    const f = traversalFixture([
      ...(afterPrefetch ? [{ status: 200, body: routeOnlyPrefetch }] : []),
      { status: 200, body: incidental, contentType: "text/html" },
    ]);
    await assert.rejects(f.run(afterPrefetch ? prefetchHeaders : { RSC: "1" }));
  }
});

test("genuine HTML refresh and reachable Flight redirect errors remain supported", async () => {
  const { makeGetServerInsertedHTML } = nativeRequire("next/dist/server/app-render/make-get-server-inserted-html");
  const { getRedirectError } = nativeRequire("next/dist/client/components/redirect");
  const generatedHtml = await makeGetServerInsertedHTML({
    polyfills: [], renderServerInsertedHTML: () => [], tracingMetadata: [], basePath: "",
    serverCapturedErrors: [getRedirectError("/client", "replace")],
  })();
  const cases = [
    { contentType: "text/html", body: generatedHtml },
    { contentType: "text/html", body: '<html><head><meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/client"/></head></html>' },
    { contentType: "text/html", body: '<meta id="__next-page-redirect" http-equiv="refresh" content="0;url=http://localhost:3008/client"/>' },
    { contentType: "text/x-component", body: '0:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
    { contentType: "text/x-component", body: '0:{"b":"development","t":{"t":{"s":"__PAGE__"},"h":{"r":["$","$Sreact.fragment",null,{"children":"$L1"}],"p":false,"v":null}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
    { contentType: "text/x-component", body: '0:{"b":"development","t":{"t":{"s":"__PAGE__","d":{"r":["$","$L1",null,{}],"p":false,"v":null}}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
    { contentType: "text/x-component", body: mapRedirect },
  ];
  for (const response of cases) {
    for (const afterPrefetch of [false, true]) {
      const f = traversalFixture([...(afterPrefetch ? [{ status: 200, body: routeOnlyPrefetch }] : []), { status: 200, ...response }]);
      await f.run(afterPrefetch ? prefetchHeaders : { RSC: "1" });
      assert.equal(f.requests.length, afterPrefetch ? 2 : 1);
    }
  }
});

test("the current transport Map chain reaches a genuine page redirect", async () => {
  const f = traversalFixture([{ status: 200, body: mapRedirect }]);
  await f.run();
  assert.deepEqual(f.requests, ["/clients"]);
});

// Installed fetch-server-response consumes root.t, not arbitrary root fields.
// decode-server-response selects only route d.r and head.r as render payloads.
// These literal responses must not turn incidental reachable error records into
// authorization evidence, even when a valid-looking transport tree is present.
for (const [name, body] of [
  ["a root decoy Map with null transport", '0:{"decoy":"$Q1","t":null}\n1:[["children","$L2"]]\n2:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a root decoy beside a successful transport", '0:{"b":"development","decoy":"$Q1","t":{"t":{"s":"__PAGE__","d":{"r":["$","div",null,{"children":"Normal page"}],"p":false,"v":null}}}}\n1:[["children","$L2"]]\n2:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["the obsolete f-only root field", '0:{"f":["$L1"]}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a transport debug field", '0:{"t":{"t":{"s":"__PAGE__"},"debug":"$L1"}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a route identity field", '0:{"t":{"t":{"s":"$L1"}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a route debug field", '0:{"t":{"t":{"s":"__PAGE__","debug":"$L1"}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a segment partiality field", '0:{"t":{"t":{"s":"__PAGE__","d":{"r":"Normal page","p":"$@1","v":null}}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a head partiality field", '0:{"t":{"t":{"s":"__PAGE__"},"h":{"r":[null,null],"p":"$@1","v":null}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a lazy error in place of a route node", '0:{"t":{"t":{"s":"","c":"$Q1"}}}\n1:[["children","$L2"]]\n2:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["an unused React element prop", '0:{"t":{"t":{"s":"__PAGE__","d":{"r":["$","div",null,{"children":"Normal page","unused":"$L1"}],"p":false,"v":null}}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a React element dev owner", '0:{"t":{"t":{"s":"__PAGE__","d":{"r":["$","div",null,{"children":"Normal page"},"$L1",[],0],"p":false,"v":null}}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
  ["a non-renderable ordinary object", '0:{"t":{"t":{"s":"__PAGE__","d":{"r":{"unused":"$L1"},"p":false,"v":null}}}}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n'],
]) {
  test(`Flight denial rejects an error reachable only through ${name}`, async () => {
    for (const afterPrefetch of [false, true]) {
      const f = traversalFixture([...(afterPrefetch ? [{ status: 200, body: routeOnlyPrefetch }] : []), { status: 200, body }]);
      await assert.rejects(f.run(afterPrefetch ? prefetchHeaders : { RSC: "1" }));
      assert.equal(f.requests.length, afterPrefetch ? 2 : 1);
    }
  });
}

test("Map redirect traversal rejects malformed maps and unreachable redirect errors", async () => {
  const bodies = [
    mapRedirect.replace('1:[["children",{"s":"(app)","c":"$Q2"}]]', '1:{"children":"$L4"}'),
    mapRedirect.replace('1:[["children",{"s":"(app)","c":"$Q2"}]]', '1:[["children"]]'),
    mapRedirect.replace('1:[["children",{"s":"(app)","c":"$Q2"}]]\n', ''),
    mapRedirect.replace('"c":"$Q2"', '"c":"$Q1"'),
    mapRedirect.replace('1:[["children",{"s":"(app)","c":"$Q2"}]]', '1:[["children",{"s":"(app)","c":"$Q2"}],["children",{"s":"unrelated"}]]'),
    mapRedirect.replace('"c":"$Q1"', () => '"c":"$$Q1"'),
    mapRedirect.replace('"r":"$L4"', '"r":null'),
  ];
  for (const body of bodies) {
    const f = traversalFixture([{ status: 200, body }]);
    await assert.rejects(f.run(), `Malformed or unreachable Map fixture must fail: ${body}`);
    assert.equal(f.requests.length, 1);
  }
});

test("streamed redirects reject wrong, cross-origin, incidental and malformed targets", async () => {
  const meta = (target: string) => `<meta id="__next-page-redirect" http-equiv="refresh" content="1;url=${target}"/>`;
  const cases = [
    ...["/other", "/client-other", "/client?next=elsewhere", "/client#wrong", "https://other.example/client", "//other.example/client"].flatMap(target => [
      { contentType: "text/html", body: `${meta(target)}<a href="/client">NEXT_REDIRECT</a>` },
      { contentType: "text/x-component", body: `0:E${JSON.stringify({ digest: `NEXT_REDIRECT;replace;${target};307;`, message: "/client" })}\n` },
      { contentType: "text/x-component", body: mapRedirect.replace('NEXT_REDIRECT;replace;/client;307;', `NEXT_REDIRECT;replace;${target};307;`) },
    ]),
    { contentType: "text/html", body: `<!-- ${meta("/client")} --><a href="/client">NEXT_REDIRECT</a>` },
    { contentType: "text/html", body: `<script>const example = '${meta("/client")}';</script><a href="/client">NEXT_REDIRECT</a>` },
    { contentType: "text/html", body: `<template>${meta("/client")}</template> NEXT_REDIRECT /client` },
    { contentType: "text/html", body: `<noscript>${meta("/client")}</noscript> NEXT_REDIRECT /client` },
    { contentType: "text/html", body: '&lt;meta id="__next-page-redirect" http-equiv="refresh" content="1;url=/client"/&gt; NEXT_REDIRECT' },
    { contentType: "text/html", body: '<meta http-equiv="refresh" content="1;url=/client"/> NEXT_REDIRECT' },
    { contentType: "text/html", body: '<meta id="__next-page-redirect" http-equiv="refresh" content="garbage /client"/> NEXT_REDIRECT' },
    { contentType: "text/x-component", body: '0:{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
    { contentType: "text/x-component", body: '0:{"f":[]}\n1:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
    { contentType: "text/x-component", body: '0:E{"digest":"NEXT_REDIRECT;wrong;/client;307;"}\n' },
    { contentType: "text/x-component", body: '0:E{"digest":"NEXT_REDIRECT;replace;/client;200;"}\n' },
    { contentType: "text/plain", body: '0:E{"digest":"NEXT_REDIRECT;replace;/client;307;"}\n' },
  ];
  for (const response of cases) {
    for (const afterPrefetch of [false, true]) {
      const f = traversalFixture([...(afterPrefetch ? [{ status: 200, body: routeOnlyPrefetch }] : []), { status: 200, ...response }]);
      await assert.rejects(f.run(afterPrefetch ? prefetchHeaders : { RSC: "1" }));
    }
  }
});
