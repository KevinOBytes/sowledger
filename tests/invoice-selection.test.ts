import assert from "node:assert/strict";
import { test } from "node:test";
import { serialize } from "pg-protocol";
import * as schema from "../lib/db/schema";
import * as money from "../lib/invoice-amount";
import { readInvoiceList, readCreatedInvoice, invoiceHistoryCents, type InvoiceRecord } from "../lib/invoice-client-state";
import { entry, project, invoiceFixture } from "./helpers/invoice-selection-fixtures";
import { diagnostics } from "./helpers/error-boundary-fixtures";

test("mixed actual GET history retains only the recognized duplicate variant without trusting wire flags", async () => {
  const base = { workspaceId: "workspace", number: "SAVED", amount: 7.89, status: "sent", dueDate: null, createdAt: new Date("2026-10-31Z"), projectId: "p" };
  const duplicate = { ...base, id: "duplicate", timeEntryIds: ["old-b", "old-a", "old-b"] };
  const f = invoiceFixture({ invoices: [{ ...base, id: "healthy", timeEntryIds: ["old-a"] }, duplicate], entries: [entry(), entry("old-a", { status: "invoiced" }), entry("old-b", { status: "invoiced" })] });
  const response = await f.call(undefined, "GET"); assert.equal(response.status, 200);
  const raw = await response.json(); raw.invoices.find((v: InvoiceRecord) => v.id === "healthy").historyIssue = "duplicate-linked-ids";
  const data = readInvoiceList(raw), saved = data.invoices.find(v => v.id === "duplicate")!;
  assert.equal((saved as InvoiceRecord & { historyIssue?: string }).historyIssue, "duplicate-linked-ids");
  assert.equal((data.invoices.find(v => v.id === "healthy") as InvoiceRecord & { historyIssue?: string }).historyIssue, undefined);
  assert.deepEqual(saved.timeEntryIds, duplicate.timeEntryIds); assert.equal(saved.amount, 7.89); assert.equal(saved.status, "sent");
  assert.equal(data.billableEntries.length, 1); assert.equal(data.billableEntries[0].eligible, true); assert.equal(invoiceHistoryCents(data.invoices), 1578); assert.deepEqual(f.rows()[1], duplicate);
  for (const edit of [
    { workspaceId: "foreign" }, { id: "bad id" }, { amount: -1 }, { amount: NaN }, { dueDate: "invalid" }, { createdAt: "invalid" }, { timeEntryIds: ["old-a", "old-a", 4] },
    { billingAudience: "client", clientId: "c", clientName: "Client" }, { billingAudience: "internal" }, { clientId: "c" }, { clientName: "Client" },
  ]) { const value = structuredClone(raw); Object.assign(value.invoices.find((v: InvoiceRecord) => v.id === "duplicate"), edit); assert.throws(() => readInvoiceList(value)); }
  assert.throws(() => readInvoiceList({ ...raw, canManage: "true" }));
  assert.throws(() => readInvoiceList({ ...raw, invoices: [raw.invoices[0], raw.invoices[0]] }));
  const group = data.billableEntries[0];
  for (const timeEntryIds of [["a", "a"], ["a", "b", "a"]]) assert.throws(() => readCreatedInvoice({ ok: true, invoice: { ...saved, id: "new", status: "draft", amount: 100, amountCents: 10000, billingAudience: group.billingAudience, clientId: group.clientId, clientName: group.clientName, timeEntryIds } }, { workspaceId: "workspace", ids: timeEntryIds.length === 2 ? ["a", "b"] : ["a", "b", "c"], amountCents: 10000, group, existingIds: [] }));
});

for (const count of [0, 1, 1000, 1001, 65536]) test(`actual GET ${count} membership users are scoped, deduplicated and read sequentially within 1000 IDs`, async () => {
  const ids = Array.from({ length: count }, (_, i) => `member-${i}`), authors = [...new Set([ids[0], ids[999], ids.at(-1)].filter(Boolean))];
  const f = invoiceFixture({ memberships: [...ids.map(userId => ({ workspaceId: "workspace", userId })), ...(count ? [{ workspaceId: "workspace", userId: ids[0] }] : []), { workspaceId: "foreign", userId: "foreign-user" }], users: [...authors.map(id => ({ id, email: `${id}@example.com` })), { id: "foreign-user", email: "private@example.com" }], entries: [...authors.map((userId, i) => entry(`approved-${i}`, { userId })), entry("missing", { userId: "missing-global-user" })] });
  const response = await f.call(undefined, "GET"); assert.equal(response.status, 200);
  const data = readInvoiceList(await response.json());
  const queries = f.predicates.filter(q => q.table === schema.users);
  assert.equal(queries.length, Math.ceil(count / 1000));
  for (const query of queries) { assert.ok(query.params.length > 0 && query.params.length <= 1000); assert.equal(serialize.bind({ values: query.params }).readUInt16BE(7), query.params.length); }
  assert.deepEqual(queries.flatMap(q => q.params), ids);
  for (const author of authors) assert.equal(data.billableEntries.find(e => e.userEmail === `${author}@example.com`)?.userEmail, `${author}@example.com`);
  assert.equal(data.billableEntries.find(e => e.id === "missing")?.userEmail, "Unknown User");
  assert.equal(data.billableEntries.some(e => e.userEmail === "private@example.com"), false);
});
test("actual GET later membership chunk failure fails the whole response rather than returning partial labels", async () => {
  const f = invoiceFixture({ memberships: Array.from({ length: 1001 }, (_, i) => ({ workspaceId: "workspace", userId: `member-${i}` })), failUserChunk: 2 });
  const { value: response, logs } = await diagnostics(() => f.call(undefined, "GET")); assert.equal(response.status, 500); assert.equal((await response.json()).ok, undefined);
  assert.deepEqual(logs, [["sowledger_request_failed", { route: "workflow", method: "UNSPECIFIED", category: "unexpected" }]]);
});

test("GET previews rounded line cents and does not hide malformed approved lines", async () => {
  const f = invoiceFixture({ entries: [entry("a", { durationSeconds: 1800, hourlyRate: 99.99 }), entry("bad", { hourlyRate: null })] });
  const response = await f.call(undefined, "GET"); assert.equal(response.status, 200);
  const rows = (await response.json()).billableEntries;
  assert.equal(rows.length, 2); assert.equal(rows[0].amountCents, 5000); assert.equal(rows[0].amount, 50); assert.equal(rows[0].billingAudience, "client");
  assert.equal(rows[1].eligible, false); assert.equal(rows[1].amount, null);
});
test("mixed-client selection cannot create or consume time", async () => {
  const f = invoiceFixture({ entries: [entry(), entry("b", { projectId: "q" })], projects: [project(), project("q", null)] });
  assert.equal((await f.call({ timeEntryIds: ["a", "b"] })).status, 400); assert.equal(f.rows().length, 0); assert.equal(f.rows(schema.auditLogs).length, 0); assert.ok(f.rows(schema.timeEntries).every(e => e.status === "approved"));
});
test("database-decoded cent change refuses before writes with stable 422", async () => {
  const f = invoiceFixture({ entries: [entry("a", { hourlyRate: 131072 }), entry("b", { durationSeconds: 36, hourlyRate: 1 })], probe: 131072.02 });
  const response = await f.call({ timeEntryIds: ["a", "b"] }); assert.equal(response.status, 422); assert.equal((await response.json()).code, "INVOICE_AMOUNT_NOT_REPRESENTABLE"); assert.equal(f.rows().length, 0); assert.ok(!f.events.includes("insert:invoices"));
});
test("native hard-delete preserves even empty linked projects", async () => {
  const f = invoiceFixture(); const response = await f.call(undefined, "DELETE", "clients"); assert.equal(response.status, 409); assert.match((await response.json()).error, /archive/i); assert.equal(f.rows(schema.clients).length, 1); assert.equal(f.rows(schema.organizations).length, 1); assert.equal(f.rows(schema.projects)[0].clientId, "c");
});
test("checked money exports reject individual overflow and unsafe dollar conversion", () => {
  const checked = money as unknown as { checkedInvoiceCents: (rows: Array<{ durationSeconds: number; hourlyRate: number }>) => number; invoiceAmountCandidate: (cents: number) => unknown };
  assert.equal(typeof checked.checkedInvoiceCents, "function");
  assert.equal(checked.checkedInvoiceCents([{ durationSeconds: 18, hourlyRate: 1 }, { durationSeconds: 18, hourlyRate: 1 }]), 2);
  assert.throws(() => checked.checkedInvoiceCents([{ durationSeconds: 3600, hourlyRate: Number.MAX_VALUE }]));
  // This neighboring safe integer cannot survive the dollars/toFixed conversion.
  assert.throws(() => checked.invoiceAmountCandidate(9007199254740990));
});

for (const kind of ["client", "internal", "projectless"] as const) test(`${kind} valid selection returns checked cents and commits before scheduling effects`, async () => {
  const f = invoiceFixture({ entries: [entry("a", { durationSeconds: 18, hourlyRate: 1, projectId: kind === "projectless" ? null : "p" }), entry("b", { durationSeconds: 18, hourlyRate: 1, projectId: "q" })], projects: [project("p", kind === "client" ? "c" : null), project("q", kind === "client" ? "c" : null)] });
  const response = await f.call({ timeEntryIds: ["b", "a"], dueDate: "2028-02-29" }); assert.equal(response.status, 200, JSON.stringify(f.errors));
  const { invoice } = await response.json(); assert.equal(invoice.amount, 0.02); assert.equal(invoice.amountCents, 2); assert.equal(invoice.projectId, null); assert.equal(invoice.billingAudience, kind === "client" ? "client" : "internal"); assert.equal(invoice.dueDate, "2028-02-29T00:00:00.000Z");
  assert.equal(f.rows(schema.auditLogs).length, 3); assert.ok(f.rows(schema.timeEntries).every(e => e.status === "invoiced")); assert.equal(f.afters.length, 1); assert.equal(f.events[0], 'transaction:{"isolationLevel":"read committed"}'); assert.ok(f.events.indexOf("probe") < f.events.indexOf("insert:invoices"));
  if (kind !== "projectless") assert.ok(f.events.indexOf("lock:projects:update") < f.events.indexOf("lock:time_entries:update"));
  if (kind === "client") assert.ok(f.events.indexOf("lock:clients:key share") < f.events.indexOf("lock:time_entries:update"));
  for (const q of f.predicates) if (q.table !== schema.users) assert.ok(q.params.includes("workspace"), q.sql);
});
for (const dueDate of [undefined, null, "", "  ", "2026-10-31T23:30:00-04:00"]) test(`invoice uses shared due date parser for ${JSON.stringify(dueDate)}`, async () => {
  const f = invoiceFixture(); const response = await f.call({ timeEntryIds: ["a"], dueDate }); assert.equal(response.status, 200); assert.equal((await response.json()).invoice.dueDate, dueDate?.trim() ? "2026-11-01T03:30:00.000Z" : null);
});
for (const body of [null, [], 3, {}, { timeEntryIds: [] }, { timeEntryIds: ["a", "a"] }, { timeEntryIds: Array.from({ length: 101 }, (_, i) => `${i}`) }, { timeEntryIds: ["a"], projectId: null }, { timeEntryIds: ["a"], dueDate: "2027-02-29" }, { timeEntryIds: ["a"], dueDate: false }]) test(`malformed invoice input ${JSON.stringify(body).slice(0,90)} has no writes`, async () => {
  const f = invoiceFixture(); assert.equal((await f.call(body)).status, 400); assert.equal(f.rows().length, 0); assert.equal(f.afters.length, 0);
});
for (const [options, body, status] of [
  [{}, { timeEntryIds: ["a", "missing"] }, 404],
  [{ entries: [entry("a", { workspaceId: "foreign" })] }, { timeEntryIds: ["a"] }, 404],
  [{ projects: [] }, { timeEntryIds: ["a"] }, 400],
  [{ projects: [project("p", "c", { workspaceId: "foreign" })] }, { timeEntryIds: ["a"] }, 400],
  [{ clients: [] }, { timeEntryIds: ["a"] }, 400],
  [{ clients: [{ id: "c", workspaceId: "foreign" }] }, { timeEntryIds: ["a"] }, 400],
  [{}, { timeEntryIds: ["a"], projectId: "q" }, 400],
  [{ entries: [entry("a", { stoppedAt: null })] }, { timeEntryIds: ["a"] }, 409],
  [{ entries: [entry("a", { status: "invoiced" })] }, { timeEntryIds: ["a"] }, 409],
  [{ changedProject: true }, { timeEntryIds: ["a"] }, 409],
] as const) test(`invalid scoped graph ${JSON.stringify(options)} rejects atomically`, async () => {
  const f = invoiceFixture(options as Parameters<typeof invoiceFixture>[0]); assert.equal((await f.call(body)).status, status); assert.equal(f.rows().length, 0); assert.equal(f.rows(schema.auditLogs).length, 0); assert.equal(f.afters.length, 0);
});
for (const value of [null, NaN, Infinity, -1]) for (const field of ["durationSeconds", "hourlyRate"]) test(`saved ${field}=${value} cannot produce a bogus preview or invoice`, async () => {
  const f = invoiceFixture({ entries: [entry("a", { [field]: value })] }); const get = await f.call(undefined, "GET"); const row = (await get.json()).billableEntries[0]; assert.equal(row.eligible, false); assert.equal(row.amountCents, null); assert.equal((await f.call({ timeEntryIds: ["a"] })).status, 400);
});
for (const status of ["draft", "sent", "paid", "void", "unknown"]) test(`ANY preexisting invoice link conflicts even with status ${status}`, async () => {
  const f = invoiceFixture({ invoices: [{ id: "old", workspaceId: "workspace", timeEntryIds: ["a"], status }] }); assert.equal((await f.call({ timeEntryIds: ["a"] })).status, 409); assert.equal(f.rows().length, 1); assert.equal(f.rows(schema.timeEntries)[0].status, "approved"); assert.equal(f.afters.length, 0);
});
for (const options of [{ returnedAmount: 100.01 }, { rereadAmount: 100.01 }, { affectedIds: [] }, { affectedIds: ["wrong"] }, { fault: "insert:invoices" }, { fault: "update:time_entries" }, { fault: "audit" }, { fault: "commit" }]) test(`failed boundary ${JSON.stringify(options)} rolls back and schedules no effects`, async () => {
  const f = invoiceFixture(options); const { value: response, logs } = await diagnostics(() => f.call({ timeEntryIds: ["a"] })); assert.ok(response.status >= 400); assert.equal(f.rows().length, 0); assert.equal(f.rows(schema.timeEntries)[0].status, "approved"); assert.equal(f.rows(schema.auditLogs).length, 0); assert.equal(f.afters.length, 0);
  assert.deepEqual(logs, "fault" in options ? [["sowledger_request_failed", { route: "/api/invoices", method: "POST", category: "unexpected" }]] : []);
});
test("unreferenced client deletion retains directory targets and does not lock projects/workspace", async () => {
  const f = invoiceFixture({ projects: [], organizations: [{ id: "org", workspaceId: "workspace", clientId: "c", name: "Kept name", type: "client" }], people: [{ id: "person", workspaceId: "workspace", organizationId: "org", displayName: "Kept person", status: "active" }] });
  const peopleBefore = structuredClone(f.rows(schema.workspacePeople));
  assert.equal((await f.call(undefined, "DELETE", "clients")).status, 200); assert.equal(f.rows(schema.clients).length, 0);
  assert.ok(f.rows(schema.workspacePeople).every(person => f.rows(schema.organizations).some(org => org.id === person.organizationId && org.workspaceId === person.workspaceId)), "Successful delete must not leave an orphan directory person");
  assert.deepEqual(f.rows(schema.organizations), [{ id: "org", workspaceId: "workspace", clientId: null, name: "Kept name", type: "client" }]); assert.deepEqual(f.rows(schema.workspacePeople), peopleBefore);
  assert.deepEqual(f.events.filter(e => e.startsWith("lock:")), ["lock:clients:update", "lock:organizations:update"]); assert.ok(!f.events.includes("delete:organizations")); assert.ok(!f.events.includes("delete:workspace_people"));
});
for (const ioError of [new SyntaxError("private SQL secret"), Object.assign(new Error("private SQL secret"), { status: 403 })]) for (const method of ["GET", "POST", "DELETE"]) test(`${method} unknown I/O errors do not masquerade as JSON/auth`, async () => {
  const f = invoiceFixture({ ioError }); const { value: response, logs } = await diagnostics(() => f.call({ timeEntryIds: ["a"] }, method, method === "DELETE" ? "clients" : "invoices")); assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /SQL|secret|private/);
  assert.deepEqual(logs, [["sowledger_request_failed", { route: method === "GET" ? "workflow" : method === "POST" ? "/api/invoices" : "/api/clients", method: method === "GET" ? "UNSPECIFIED" : method, category: "unexpected" }]]);
});

test("candidate checks use actual decoded dollars, not float32-only or a fixed amount cap", () => {
  assert.equal(money.invoiceAmountCandidate(13107200).decimal, "131072.00");
  assert.doesNotThrow(() => money.assertInvoiceAmountReadback(131072.02, money.invoiceAmountCandidate(13107202)));
  assert.throws(() => money.assertInvoiceAmountReadback(131072.02, money.invoiceAmountCandidate(13107201)));
  assert.doesNotThrow(() => money.assertInvoiceAmountReadback(99.99, money.invoiceAmountCandidate(9999)));
  assert.throws(() => money.assertInvoiceAmountReadback(Math.fround(99.99), money.invoiceAmountCandidate(9999)));
  for (const value of [NaN, Infinity, -1, null, "99.99"]) assert.throws(() => money.assertInvoiceAmountReadback(value, money.invoiceAmountCandidate(9999)));
  assert.equal(money.formatInvoiceCents(9007199254740991), "$90071992547409.91");
  assert.equal(money.sumDisplayCents([9007199254740991, 1]), null);
  assert.equal(money.displayAmountCents(1.001), null);
  assert.equal(invoiceHistoryCents([{ amount: 1.001 }] as InvoiceRecord[]), null);
});
test("checked line math permits zero-rate, subsecond fractional allocations and rejects running-sum overflow", async () => {
  assert.equal(money.checkedInvoiceCents([{ durationSeconds: 0.5, hourlyRate: 72 }]), 1);
  assert.equal(money.checkedInvoiceCents([{ durationSeconds: 3600, hourlyRate: 0 }]), 0);
  for (const bad of [0, -1, NaN, Infinity]) assert.throws(() => money.checkedInvoiceCents([{ durationSeconds: bad, hourlyRate: 1 }]));
  assert.throws(() => money.checkedInvoiceCents([{ durationSeconds: 3600, hourlyRate: 45035996273704.96 }, { durationSeconds: 3600, hourlyRate: 45035996273704.96 }]));
  const f = invoiceFixture({ entries: [entry("a", { durationSeconds: 0.5, hourlyRate: 72 })] }); const response = await f.call({ timeEntryIds: ["a"] }); assert.equal(response.status, 200); assert.equal((await response.json()).invoice.amountCents, 1);
});
test("malformed JSON has narrow 400 provenance while 40001 remains bounded conflict", async () => {
  assert.equal((await invoiceFixture().call(undefined, "POST", "invoices", "{")).status, 400);
  const f = invoiceFixture({ ioError: Object.assign(new Error("private SQL secret"), { code: "40001" }) }); const response = await f.call({ timeEntryIds: ["a"] }); assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /SQL|secret|private/);
});
for (const role of ["member", "client"]) test(`known ${role} role enforcement stays intact`, async () => {
  assert.equal((await invoiceFixture({ role }).call({ timeEntryIds: ["a"] })).status, 403);
  assert.equal((await invoiceFixture({ role }).call(undefined, "DELETE", "clients")).status, 403);
  assert.equal((await invoiceFixture({ role }).call(undefined, "GET")).status, role === "member" ? 200 : 403);
});
test("foreign/missing client deletion is generic scoped 404 and delete/organization faults rollback", async () => {
  for (const options of [{ clients: [] }, { clients: [{ id: "c", workspaceId: "foreign", name: "secret client" }] }]) { const f = invoiceFixture(options); const response = await f.call(undefined, "DELETE", "clients"); assert.equal(response.status, 404); assert.doesNotMatch(await response.text(), /secret|foreign/); }
  for (const fault of ["update:organizations", "delete:clients", "commit"]) { const f = invoiceFixture({ projects: [], fault }); const { value: response, logs } = await diagnostics(() => f.call(undefined, "DELETE", "clients")); assert.equal(response.status, 500); assert.equal(f.rows(schema.clients).length, 1); assert.equal(f.rows(schema.organizations).length, 1); assert.equal(f.rows(schema.organizations)[0].clientId, "c"); assert.deepEqual(logs, [["sowledger_request_failed", { route: "/api/clients", method: "DELETE", category: "unexpected" }]]); }
});
test("history is classified from every linked entry without rewriting saved amounts or project pointers", async () => {
  const f = invoiceFixture({ entries: [entry("a", { status: "invoiced" }), entry("b", { projectId: "q", status: "invoiced" })], projects: [project(), project("q", "c")], invoices: [{ id: "old", workspaceId: "workspace", projectId: "p", timeEntryIds: ["a", "b"], amount: 123.456, status: "sent" }] });
  const response = await f.call(undefined, "GET"); const { invoices } = await response.json(); assert.equal(invoices[0].billingAudience, "client"); assert.equal(invoices[0].projectId, "p"); assert.equal(invoices[0].amount, 123.456); assert.equal(f.rows()[0].amount, 123.456);
});
test("actual GET large history bounds every bind count without dropping IDs or misclassifying cross-boundary relationships", async () => {
  const ids = Array.from({ length: 65535 }, (_, index) => `history-${index}`);
  const ordinary = Array.from({ length: 656 }, (_, index) => ({ id: `invoice-${index}`, workspaceId: "workspace", timeEntryIds: ids.slice(index * 100, (index + 1) * 100), projectId: null, amount: 0, status: "draft" }));
  const special = [
    { id: "zz-client-cross-boundary", workspaceId: "workspace", timeEntryIds: [ids[0], ids.at(-1)!], projectId: "p", amount: 123.456, status: "sent" },
    { id: "zz-internal-cross-boundary", workspaceId: "workspace", timeEntryIds: [ids[1], ids.at(-2)!], projectId: null, amount: 12.34, status: "draft" },
    { id: "zz-corrupt-project", workspaceId: "workspace", timeEntryIds: [ids[2]], projectId: null, amount: 1.23, status: "sent" },
    { id: "zz-foreign-entry", workspaceId: "workspace", timeEntryIds: [ids.at(-3)!], projectId: null, amount: 4.56, status: "sent" },
    { id: "zz-duplicate-ids", workspaceId: "workspace", timeEntryIds: [ids[0], ids[0]], projectId: "p", amount: 7.89, status: "sent" },
    { id: "zz-empty-ids", workspaceId: "workspace", timeEntryIds: [], projectId: null, amount: 0, status: "draft" },
  ];
  const f = invoiceFixture({ invoices: [...ordinary, ...special, { id: "foreign-invoice", workspaceId: "foreign", timeEntryIds: ["not-owned-history"], amount: 9 }], projects: [project(), project("q", "c"), project("internal", null), project("foreign-project", "foreign-client", { workspaceId: "foreign", name: "Private foreign project" })], entries: [
    entry(ids[0], { status: "invoiced" }), entry(ids.at(-1)!, { projectId: "q", status: "invoiced" }),
    entry(ids[1], { projectId: null, status: "invoiced" }), entry(ids.at(-2)!, { projectId: "internal", status: "invoiced" }),
    entry(ids[2], { projectId: "foreign-project", status: "invoiced" }), entry(ids.at(-3)!, { workspaceId: "foreign", projectId: "foreign-project", status: "invoiced" }),
  ] });
  const response = await f.call(undefined, "GET"); assert.equal(response.status, 200);
  const data = await response.json();
  const historicalQueries = f.predicates.filter(query => query.table === schema.timeEntries && query.sql.includes('"id" in ('));
  for (const query of f.predicates) { assert.ok(query.params.length <= 65535, `Unsafe PostgreSQL bind count: ${query.params.length}`); assert.equal(serialize.bind({ values: query.params }).readUInt16BE(7), query.params.length); }
  assert.ok(historicalQueries.length > 1, "All lifetime history must be loaded through bounded statements, not one overflowing IN clause");
  for (const query of historicalQueries) assert.equal(query.params[0], "workspace");
  const covered = historicalQueries.flatMap(query => query.params.slice(1)); assert.equal(covered.length, ids.length); assert.deepEqual(new Set(covered), new Set(ids));
  for (const [left, right] of [[ids[0], ids.at(-1)!], [ids[1], ids.at(-2)!]]) assert.notEqual(historicalQueries.findIndex(query => query.params.includes(left)), historicalQueries.findIndex(query => query.params.includes(right)), "Valid relationship pairs must really cross statement boundaries");
  assert.equal(data.invoices.length, ordinary.length + special.length); assert.ok(!data.invoices.some((invoice: { id: string }) => invoice.id === "foreign-invoice"));
  for (const original of special) { const saved = data.invoices.find((invoice: { id: string }) => invoice.id === original.id); assert.deepEqual(saved.timeEntryIds, original.timeEntryIds); assert.equal(saved.amount, original.amount); assert.equal(saved.projectId, original.projectId); }
  assert.equal(data.invoices.find((invoice: { id: string }) => invoice.id === "zz-client-cross-boundary").billingAudience, "client");
  assert.equal(data.invoices.find((invoice: { id: string }) => invoice.id === "zz-internal-cross-boundary").billingAudience, "internal");
  for (const id of ["zz-corrupt-project", "zz-foreign-entry", "zz-duplicate-ids", "zz-empty-ids", "invoice-0", "invoice-655"]) { const saved = data.invoices.find((invoice: { id: string }) => invoice.id === id); assert.equal(saved.billingAudience, "unknown"); assert.equal(saved.clientId, null); assert.equal(saved.clientName, null); }
  assert.deepEqual(f.rows().filter(invoice => invoice.workspaceId === "workspace"), [...ordinary, ...special]);
});
test("runtime DTO validation refuses malformed privileges, amounts, groups and foreign workspace records", async () => {
  const f = invoiceFixture(); const response = await f.call(undefined, "GET"); const good = await response.json(); assert.equal(readInvoiceList(good).billableEntries[0].amountCents, 10000);
  for (const change of [ (v: typeof good) => { v.canManage = "true"; }, (v: typeof good) => { v.billableEntries[0].amountCents = NaN; }, (v: typeof good) => { v.billableEntries[0].workspaceId = "foreign"; }, (v: typeof good) => { v.billableEntries[0].clientId = null; }, (v: typeof good) => { delete v.workspaceId; } ]) { const value = structuredClone(good); change(value); assert.throws(() => readInvoiceList(value)); }
});

for (const options of [
  { projects: [project("foreign-project", "c", { workspaceId: "foreign" })] },
  { projects: [], organizations: [{ id: "foreign-org", workspaceId: "foreign", clientId: "c" }] },
  { projects: [], people: [{ id: "foreign-person", workspaceId: "foreign", organizationId: "org" }] },
]) test(`client hard-delete refuses a corrupt global FK dependency without foreign changes: ${JSON.stringify(options)}`, async () => {
  const f = invoiceFixture(options); const before = [schema.clients, schema.projects, schema.organizations, schema.workspacePeople].map(table => structuredClone(f.rows(table)));
  const response = await f.call(undefined, "DELETE", "clients"); assert.equal(response.status, 409); assert.doesNotMatch(await response.text(), /foreign-|foreign-person|foreign-org/);
  assert.deepEqual([schema.clients, schema.projects, schema.organizations, schema.workspacePeople].map(table => f.rows(table)), before);
});

for (const count of [0, 2]) test(`retention handles ${count} linked organizations without touching unrelated directory records`, async () => {
  const owned = Array.from({ length: count }, (_, i) => ({ id: `owned-${i}`, workspaceId: "workspace", clientId: "c", name: `Keep ${i}`, type: i ? "internal" : "client" }));
  const unrelated = [{ id: "unrelated", workspaceId: "workspace", clientId: "other", name: "Unrelated" }, { id: "foreign", workspaceId: "foreign", clientId: "elsewhere", name: "Foreign" }];
  const f = invoiceFixture({ projects: [], organizations: [...owned, ...unrelated] });
  assert.equal((await f.call(undefined, "DELETE", "clients")).status, 200); assert.deepEqual(f.rows(schema.organizations), [...owned.map(org => ({ ...org, clientId: null })), ...unrelated]);
  assert.equal(f.events.filter(e => e === "update:organizations").length, count ? 1 : 0); assert.ok(!f.events.includes("delete:organizations"));
  if (count) { const query = f.predicates.filter(p => p.table === schema.organizations).at(-1)!; for (const value of ["workspace", "c", "owned-0", "owned-1"]) assert.ok(query.params.includes(value), query.sql); }
});
for (const organizationReturnedIds of [[], ["org"], ["org", "org"], ["org", "wrong"], ["org", "org2", "extra"]]) test(`organization detach RETURNING ${JSON.stringify(organizationReturnedIds)} rolls back the complete retained graph`, async () => {
  const f = invoiceFixture({ projects: [], organizations: [{ id: "org", workspaceId: "workspace", clientId: "c" }, { id: "org2", workspaceId: "workspace", clientId: "c" }], people: [{ id: "person", workspaceId: "workspace", organizationId: "org" }], organizationReturnedIds });
  const before = [schema.clients, schema.organizations, schema.workspacePeople].map(table => structuredClone(f.rows(table)));
  assert.equal((await f.call(undefined, "DELETE", "clients")).status, 409); assert.deepEqual([schema.clients, schema.organizations, schema.workspacePeople].map(table => f.rows(table)), before); assert.ok(!f.events.includes("delete:clients"));
});
for (const clientDeletedIds of [[], ["wrong"], ["c", "c"]]) test(`client exact-delete RETURNING ${JSON.stringify(clientDeletedIds)} restores original organization links`, async () => {
  const f = invoiceFixture({ projects: [], clientDeletedIds }); const before = [schema.clients, schema.organizations, schema.workspacePeople].map(table => structuredClone(f.rows(table)));
  assert.equal((await f.call(undefined, "DELETE", "clients")).status, 404); assert.deepEqual([schema.clients, schema.organizations, schema.workspacePeople].map(table => f.rows(table)), before);
});
