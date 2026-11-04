import assert from "node:assert/strict";
import { test } from "node:test";
import * as schema from "../lib/db/schema";
import { perimeterFixture } from "./helpers/invoice-perimeter-fixtures";
import { entry, invoiceFixture } from "./helpers/invoice-selection-fixtures";

const duplicateConflict = "Some time entries are listed more than once on this invoice. Ask a workspace manager to review it before changing its status or pushing it to QuickBooks.";
for (const [status, next] of [["draft", "sent"], ["sent", "paid"]])
    test(`duplicate ${status} status mutation stops after scoped lock with no writes/audits/after`, async () => {
        const original = { id: "invoice", workspaceId: "workspace", status, timeEntryIds: ["entry", "entry"], amount: 100 };
        const f = invoiceFixture({ invoices: [original] });
        const before = structuredClone(f.rows());
        const response = await f.call({ status: next }, "PATCH", "invoices/[invoiceId]");
        assert.equal(response.status, 409);
        assert.deepEqual(await response.json(), { error: duplicateConflict });
        assert.deepEqual(f.rows(), before);
        assert.equal(f.rows(schema.auditLogs).length, 0);
        assert.equal(f.afters.length, 0);
        assert.ok(f.events.includes("lock:invoices:update"));
        assert.ok(!f.events.some(e => /update:|audit|after/.test(e)));
    });
for (const status of ["sent", "paid"])
    for (const receipt of [false, true])
        test(`duplicate ${status} QuickBooks receipt=${receipt} stops before connection/proof/credentials/provider`, async () => {
            const f = perimeterFixture({ status, receipt, duplicate: true, role: "owner" });
            const before = structuredClone(f.invoice);
            const response = await f.call("push");
            assert.equal(response.status, 409);
            assert.deepEqual(await response.json(), { error: duplicateConflict });
            assert.deepEqual(f.invoice, before);
            assert.deepEqual(f.events, ['transaction:{"isolationLevel":"read committed"}', "lifecycle-lock", "lock:invoices:update", "read:invoices", "rollback"]);
        });
for (const options of [{ missing: true }, { foreign: true }])
    test(`duplicate push retains scoped missing/foreign 404 ${JSON.stringify(options)}`, async () => {
        const f = perimeterFixture({ ...options, duplicate: true, role: "owner" });
        assert.equal((await f.call("push")).status, 404);
        assert.equal(f.events.includes("connection"), false);
    });
for (const role of ["member", "client"])
    test(`duplicate status/push preserves ${role} manager denial`, async () => {
        assert.equal((await invoiceFixture({ role, invoices: [{ id: "invoice", workspaceId: "workspace", status: "draft", timeEntryIds: ["a", "a"] }] }).call({ status: "sent" }, "PATCH", "invoices/[invoiceId]")).status, 403);
        assert.equal((await perimeterFixture({ role, duplicate: true }).call("push")).status, 403);
    });
test("duplicate history classification does not grant unrelated clients or members full proof access", async () => {
    for (const resource of ["proof", "print", "signoff"] as const)
        assert.equal((await perimeterFixture({ duplicate: true, entitled: false }).call(resource)).status, 404);
    assert.equal((await perimeterFixture({ duplicate: true, role: "member" }).call("proof")).status, 403);
});
for (const workspaceId of ["foreign", "absent"])
    test(`duplicate status lookup preserves ${workspaceId} 404 before all mutation effects`, async () => {
        const f = invoiceFixture({ invoices: workspaceId === "absent" ? [] : [{ id: "invoice", workspaceId, status: "draft", timeEntryIds: ["a", "a"] }] });
        const response = await f.call({ status: "sent" }, "PATCH", "invoices/[invoiceId]");
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "Invoice not found." });
        assert.equal(f.afters.length, 0);
        assert.ok(!f.events.some(e => /update:|audit|after/.test(e)));
    });
for (const audience of ["internal", "client", "same-client-multiproject"])
    test(`healthy ${audience} status transition retains saved links, amount and commit-before-after`, async () => {
        const ids = audience === "same-client-multiproject" ? ["entry", "second"] : ["entry"];
        const f = invoiceFixture({ invoices: [{ id: "invoice", workspaceId: "workspace", status: "draft", amount: 100, timeEntryIds: ids }], entries: ids.map((id, i) => entry(id, { status: "invoiced", projectId: i ? "q" : "p", durationSeconds: 3600 / ids.length })), projects: audience === "internal" ? [{ id: "p", workspaceId: "workspace", clientId: null }] : [{ id: "p", workspaceId: "workspace", clientId: "c" }, { id: "q", workspaceId: "workspace", clientId: "c" }] });
        for (const status of ["sent", "paid"]) {
            const response = await f.call({ status }, "PATCH", "invoices/[invoiceId]");
            assert.equal(response.status, 200);
            assert.equal(f.rows()[0].status, status);
            assert.equal(f.rows()[0].amount, 100);
            assert.deepEqual(f.rows()[0].timeEntryIds, ids);
        }
        assert.equal(f.rows(schema.auditLogs).filter(row => row.eventType === "invoice_status_changed").length, 2);
        assert.equal(f.rows(schema.auditLogs).filter(row => row.eventType === "invoice_financial_exposed").length, 1);
        assert.equal(f.afters.length, 2);
        assert.ok(f.events.indexOf("commit") < f.events.indexOf("after"));
    });
for (const audience of ["internal", "client", "same-client-multiproject"]) for (const status of ["sent", "paid"]) test(`healthy ${audience} ${status} push preserves saved amount and checked scoped graph`, async () => {
  const f = perimeterFixture({ status, role: "owner" });
  if (audience === "internal") f.tables.get(schema.projects)![0].clientId = null;
  if (audience === "same-client-multiproject") {
    f.tables.get(schema.projects)!.push({ ...f.tables.get(schema.projects)![0], id: "second-project" });
    f.tables.get(schema.timeEntries)![0].durationSeconds = 1800;
    f.tables.get(schema.timeEntries)!.push({ ...f.tables.get(schema.timeEntries)![0], id: "second-entry", projectId: "second-project" });
    f.invoice.timeEntryIds = ["entry", "second-entry"];
  }
  const before = structuredClone(f.invoice), response = await f.call("push"); assert.equal(response.status, 200); assert.deepEqual(await response.json(), { ok: true, result: { externalId: "new-external", reused: false } }); assert.deepEqual(f.invoice, before); assert.equal(f.events.filter(e => e === "provider").length, 1); assert.ok(f.events.indexOf("commit") < f.events.indexOf("connection"));
});

for (const status of ["draft", "unknown", "void"]) for (const receipt of [false, true]) test(`${status} push receipt=${receipt} stops before all credential/proof/provider/receipt boundaries`, async () => {
  const f = perimeterFixture({ status, receipt });
  await assert.rejects(f.push(), (error: unknown) => (error as { status?: number }).status === 409);
  assert.deepEqual(f.events, ['transaction:{"isolationLevel":"read committed"}', "lifecycle-lock", "lock:invoices:update", "read:invoices", "rollback"]);
});
for (const resource of ["proof", "print", "signoff", "client"] as const) for (const status of ["draft", "unknown", "void"]) test(`client ${resource} hides ${status} before approved snapshot`, async () => {
  const f = perimeterFixture({ status });
  const old = await perimeterFixture().proof() as { proofPack: unknown };
  f.tables.get(schema.auditLogs)!.push({ id: "old", workspaceId: "workspace", timeEntryId: "invoice", eventType: "client_invoice_signed_off", createdAt: new Date(), diff: { clientSignoff: { after: { invoiceId: "invoice", invoiceNumber: "OLD", signedOffAt: "2026-10-01Z", digest: "a".repeat(64), snapshot: old.proofPack } } } });
  const response = await f.call(resource, true);
  assert.equal(response.status, resource === "client" ? 200 : 404);
  if (resource === "client") assert.deepEqual((await response.json()).invoices, []);
  assert.equal(f.events.includes("audit"), false);
  // The proof builder reads non-signoff audits. No approval snapshot lookup is
  // allowed for a hidden current status, even when approved=true is requested.
  if (resource !== "client") assert.equal(f.predicates.some(q => q.table === schema.auditLogs && /"event_type" =/.test(q.sql) && q.params.includes("client_invoice_signed_off")), false);
});
test("proof builder dispatches no overlapping supplied-client queries and preserves complete evidence", async () => {
  const f = perimeterFixture({ overlapGuard: true });
  const result = await f.proof() as { proofPack: { invoice: { amount: number }; totals: unknown; entries: unknown[] }; digest: string };
  assert.equal(result.proofPack.invoice.amount, 100);
  assert.deepEqual(result.proofPack.totals, { amount: 100, entryCount: 1, actualSeconds: 3600, actualHours: 1, plannedSeconds: 1800, plannedHours: 0.5, auditEventCount: 0 });
  assert.equal(result.proofPack.entries.length, 1);
  // Captured from the actual pre-repair builder against this complete fixture.
  assert.equal(result.digest, "2691fdba14d30df9916ad354708d72fa24644a57a3409fe2cb2e5d7ad754c35f");
  assert.deepEqual(f.events, ["schema", "read:invoices", "read:time_entries", "read:projects", "read:users", "read:scheduled_work_blocks", "read:audit_logs"]);
});
for (const status of ["sent", "paid"]) for (const receipt of [false, true]) test(`${status} native push retains exact ${receipt ? "reused" : "new"} provider-link response and scoped predicates`, async () => {
  const f = perimeterFixture({ status, receipt, role: "owner" });
  const response = await f.call("push"); assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, result: { externalId: receipt ? "existing-external" : "new-external", reused: receipt } });
  assert.ok(f.events.indexOf("commit") < f.events.indexOf("connection"));
  for (const [boundary, count] of [["connection", 1], ["receipt-read", 1], ["decrypt", receipt ? 0 : 1], ["encrypt", 0], ["provider", receipt ? 0 : 1], ["receipt-write", receipt ? 0 : 1], ["synced", receipt ? 0 : 1]] as const) assert.equal(f.events.filter(event => event === boundary).length, count, boundary);
  for (const q of f.predicates) if (q.table !== schema.users) assert.ok(q.params.includes("workspace"), q.sql);
  assert.ok(f.predicates.some(q => q.table === schema.users && q.params.includes("user")), "Global users must be reached from the scoped linked entry");
});
for (const options of [{ missing: true }, { foreign: true }]) test(`push missing/foreign ${JSON.stringify(options)} is generic typed 404 before connection`, async () => {
  const f = perimeterFixture({ ...options, role: "owner" }); const response = await f.call("push");
  assert.equal(response.status, 404); assert.deepEqual(await response.json(), { error: "Invoice not found." }); assert.equal(f.events.includes("connection"), false);
});
test("native push route preserves the new fixed actionable conflict", async () => {
  const f = perimeterFixture({ status: "draft", role: "owner" }); const response = await f.call("push");
  assert.equal(response.status, 409); assert.deepEqual(await response.json(), { error: "Review the invoice and mark it as sent before pushing it to QuickBooks." });
});
test("controlled provider unknown result is not retried and records no known successful receipt", async () => {
  const f = perimeterFixture({ providerError: true }); await assert.rejects(f.push(), (error: unknown) => (error as { status?: number }).status === 502 && (error as Error).message === "The integration provider could not complete the request. Try again later.");
  assert.equal(f.events.filter(event => event === "provider").length, 1); assert.equal(f.events.includes("receipt-write"), false); assert.equal(f.events.includes("provider-error"), true);
});
for (const status of ["sent", "paid"]) test(`client ${status} proof/list/signoff and approved historical bytes/digest remain intact`, async () => {
  const f = perimeterFixture({ status, overlapGuard: true });
  const old = await f.proof() as { proofPack: unknown; digest: string };
  f.tables.get(schema.auditLogs)!.push({
    id: "old", workspaceId: "workspace", timeEntryId: "invoice", eventType: "client_invoice_signed_off", createdAt: new Date(),
    diff: { clientSignoff: { after: { invoiceId: "invoice", invoiceNumber: "INV-TEST", signedOffAt: "2026-10-01T00:00:00Z", digest: old.digest, snapshot: old.proofPack } } },
  });
  f.invoice.amount = 200;
  const approved = await f.call("proof", true); assert.equal(approved.status, 200); const payload = await approved.json();
  assert.deepEqual(payload.proofPack, old.proofPack); assert.equal(payload.digest, old.digest); assert.equal(approved.headers.get("x-sowledger-proof-sha256"), old.digest); assert.equal(payload.approval.current, false);
  const printed = await f.call("print", true); assert.equal(printed.status, 200); const html = await printed.text(); assert.match(html, /Task &lt;safe&gt;/); assert.doesNotMatch(html, /Task <safe>/); assert.equal(printed.headers.get("x-sowledger-proof-sha256"), old.digest);
  const list = await f.call("client"); assert.equal((await list.json()).invoices.length, 1);
  const latest = await f.proof() as { digest: string }; const approval = await f.call("signoff", false, latest.digest); assert.equal(approval.status, 200); assert.equal(f.events.includes("audit"), true);
});
for (const role of ["owner", "manager"]) test(`team ${role} retains draft proof access`, async () => {
  const f = perimeterFixture({ status: "draft", role }); assert.equal((await f.call("proof")).status, 200);
});
for (const resource of ["proof", "print"] as const) for (const approved of [false, true]) for (const options of [{}, { missing: true }, { foreign: true }, { duplicate: true }]) test(`member ${resource} approved=${approved} denies before loading any document ${JSON.stringify(options)}`, async () => {
  const f = perimeterFixture({ ...options, role: "member" });
  const response = await f.call(resource, approved);
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-sowledger-proof-sha256"), null);
  assert.deepEqual(f.events, [], "Member denial must precede proof, snapshot and signoff reads");
  assert.deepEqual(f.predicates, []);
});

test("member invoice summaries require a complete unique owned linked graph and preserve hidden-history conflicts", async () => {
  const invoice = (id: string, timeEntryIds: string[], workspaceId = "workspace") => ({ id, workspaceId, number: `INV-${id}`, status: "sent", projectId: "p", amount: 100, timeEntryIds });
  const f = invoiceFixture({ role: "member", entries: [entry("own-approved"), entry("own-linked-approved"), entry("own-invoiced", { status: "invoiced" }), entry("peer-entry", { userId: "peer", description: "PEER-DETAIL-CANARY" }), entry("foreign-entry", { workspaceId: "foreign", description: "FOREIGN-DETAIL-CANARY" })], invoices: [invoice("own", ["own-invoiced"]), invoice("mixed", ["own-linked-approved", "peer-entry"]), invoice("peer", ["peer-entry"]), invoice("missing", ["own-invoiced", "missing-entry"]), invoice("duplicate", ["own-invoiced", "own-invoiced"]), invoice("foreign-link", ["own-invoiced", "foreign-entry"]), invoice("empty", []), invoice("blank", ["own-invoiced", ""]), invoice("foreign-invoice", ["own-invoiced"], "foreign")] });
  const response = await f.call(undefined, "GET"); assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.invoices.map((row: { id: string }) => row.id), ["own"]);
  assert.deepEqual(body.billableEntries.map((row: { id: string }) => row.id).sort(), ["own-approved", "own-linked-approved"]);
  assert.equal(body.billableEntries.find((row: { id: string }) => row.id === "own-linked-approved").eligible, false, "A mixed invoice hidden from members must still block duplicate billing server-side");
  assert.equal(body.canManage, false);
  for (const canary of ["peer-entry", "foreign-entry", "PEER-DETAIL-CANARY", "FOREIGN-DETAIL-CANARY", "INV-mixed", "INV-missing", "INV-duplicate", "INV-foreign-link", "INV-empty", "INV-blank", "INV-foreign-invoice"]) assert.ok(!JSON.stringify(body).includes(canary), canary);
  const approvedQuery = f.predicates.find(q => q.table === schema.timeEntries && q.params.includes("approved"));
  assert.ok(approvedQuery?.params.includes("owner"), "Approved detail must be owner-filtered in SQL, not post-response");
});
for (const options of [{ entitled: false }, { foreign: true }, { missing: true }]) for (const resource of ["proof", "print", "signoff"] as const) test(`client ${resource} missing/foreign/unentitled stays 404 ${JSON.stringify(options)}`, async () => {
  const f = perimeterFixture(options); assert.equal((await f.call(resource, true)).status, 404); assert.equal(f.events.includes("schema"), false);
});
