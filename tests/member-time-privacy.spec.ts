import { expect, test, type APIRequestContext } from "@playwright/test";
import { eq } from "drizzle-orm";
import { db } from "../lib/db";
import * as schema from "../lib/db/schema";

type Session = { userId: string; workspaceId: string };
type Role = "owner" | "manager" | "member";
const at = new Date("2026-10-20T09:00:00.000Z");
const ids = (rows: Array<{ id: string }>) => rows.map(row => row.id).sort();

test.describe("ordinary-member detailed-time privacy against actual handlers", () => {
  test.skip(process.env.SOWLEDGER_TEST_DATABASE !== "true", "Root-owned disposable database wrapper only; never seed operator or production data.");
  test.setTimeout(90_000);
  const ownedWorkspaces = new Set<string>(), ownedUsers = new Set<string>();
  test.afterEach(async () => {
    // Exact synthetic workspace/user IDs only; workspace cascade owns the rows
    // seeded below. No slug patterns, broad fixture cleanup, or provider calls.
    for (const workspaceId of ownedWorkspaces) {
      await db.delete(schema.workspacePeople).where(eq(schema.workspacePeople.workspaceId, workspaceId));
      await db.delete(schema.organizations).where(eq(schema.organizations.workspaceId, workspaceId));
      await db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    }
    for (const userId of ownedUsers) await db.delete(schema.users).where(eq(schema.users.id, userId));
    ownedWorkspaces.clear(); ownedUsers.clear();
  });

  async function login(request: APIRequestContext, workspace: string, email: string, role: Role) {
    const response = await request.get(`/api/test/login?${new URLSearchParams({ workspace, email, role, plan: "smb" })}`);
    expect(response.ok(), await response.text()).toBeTruthy();
    const session = await response.json() as Session;
    ownedWorkspaces.add(session.workspaceId); ownedUsers.add(session.userId);
    return session;
  }
  async function seed(request: APIRequestContext) {
    const workspace = `member-privacy-${crypto.randomUUID()}`;
    const emails = { owner: `owner-${workspace}@example.com`, manager: `manager-${workspace}@example.com`, a: `a-${workspace}@example.com`, b: `b-${workspace}@example.com` };
    const owner = await login(request, workspace, emails.owner, "owner");
    const manager = await login(request, workspace, emails.manager, "manager");
    const a = await login(request, workspace, emails.a, "member");
    const b = await login(request, workspace, emails.b, "member");
    const foreign = await login(request, `foreign-${workspace}`, `foreign-${workspace}@example.com`, "owner");
    const sharedProject = crypto.randomUUID(), peerProject = crypto.randomUUID(), foreignProject = crypto.randomUUID();
    await db.insert(schema.projects).values([
      { id: sharedProject, workspaceId: owner.workspaceId, name: "Shared privacy project" },
      { id: peerProject, workspaceId: owner.workspaceId, name: "Peer privacy project" },
      { id: foreignProject, workspaceId: foreign.workspaceId, name: "FOREIGN-PROJECT-CANARY" },
    ]);
    const canaries = { peer: `PEER-TIME-${crypto.randomUUID()}`, foreign: `FOREIGN-TIME-${crypto.randomUUID()}`, snapshot: `SNAPSHOT-ONLY-${crypto.randomUUID()}` };
    async function entry(session: Session, projectId: string, description: string, status: "approved" | "invoiced") {
      const id = crypto.randomUUID();
      await db.insert(schema.timeEntries).values({ id, ...session, projectId, taskId: description, description, status, source: "manual", startedAt: at, stoppedAt: new Date(at.getTime() + 3600_000), durationSeconds: 3600, hourlyRate: 100 });
      return id;
    }
    const entries = {
      aApproved: await entry(a, sharedProject, "My approved time", "approved"),
      aConflicted: await entry(a, sharedProject, "My approved but already linked time", "approved"),
      aInvoiced: await entry(a, sharedProject, "My invoiced time", "invoiced"),
      bApproved: await entry(b, sharedProject, canaries.peer, "approved"),
      bInvoiced: await entry(b, peerProject, canaries.peer, "invoiced"),
      foreign: await entry(foreign, foreignProject, canaries.foreign, "approved"),
    };
    async function audit(target: string, actor: string, diff: Record<string, unknown>, workspaceId = owner.workspaceId) {
      const id = crypto.randomUUID();
      await db.insert(schema.auditLogs).values({ id, workspaceId, timeEntryId: target, actorUserId: actor, eventType: "time_entry_updated", signature: "owned-synthetic-audit", diff, createdAt: at });
      return id;
    }
    const audits = {
      managerOnA: await audit(entries.aApproved, manager.userId, { description: { before: "before", after: "My approved time" } }),
      snapshotOnA: await audit(entries.aInvoiced, owner.userId, { invoiceSnapshot: { entries: [{ description: canaries.snapshot }, { description: canaries.peer }] } }),
      aActorOnB: await audit(entries.bApproved, a.userId, { description: { after: canaries.peer } }),
      bTarget: await audit(entries.bInvoiced, b.userId, { description: { after: canaries.peer } }),
      foreign: await audit(entries.foreign, foreign.userId, { description: { after: canaries.foreign } }, foreign.workspaceId),
      crossWorkspaceTarget: await audit(entries.foreign, a.userId, { description: { after: canaries.foreign } }),
      noEntry: await audit(crypto.randomUUID(), a.userId, { privateSnapshot: canaries.snapshot }),
    };
    async function invoice(label: string, timeEntryIds: string[], workspaceId = owner.workspaceId) {
      const id = crypto.randomUUID();
      await db.insert(schema.invoices).values({ id, workspaceId, number: `PRIVACY-${label}-${id}`, amount: 100, status: "sent", timeEntryIds, createdAt: at });
      return id;
    }
    const invoices = {
      own: await invoice("own", [entries.aInvoiced]),
      mixed: await invoice("mixed", [entries.aConflicted, entries.bInvoiced]),
      peer: await invoice("peer", [entries.bInvoiced]),
      missing: await invoice("missing", [entries.aInvoiced, crypto.randomUUID()]),
      duplicate: await invoice("duplicate", [entries.aInvoiced, entries.aInvoiced]),
      foreignLink: await invoice("foreign-link", [entries.aInvoiced, entries.foreign]),
      empty: await invoice("empty", []),
      blank: await invoice("blank", [entries.aInvoiced, ""]),
      foreign: await invoice("foreign", [entries.foreign], foreign.workspaceId),
    };
    return { workspace, emails, owner, manager, a, b, foreign, entries, audits, invoices, canaries, sharedProject, peerProject, foreignProject };
  }
  type Seed = Awaited<ReturnType<typeof seed>>;
  async function as(request: APIRequestContext, s: Seed, who: "a" | "b" | "manager" | "owner") {
    return login(request, s.workspace, s.emails[who], who === "a" || who === "b" ? "member" : who);
  }
  function absent(body: unknown, canaries: string[]) {
    const serialized = JSON.stringify(body);
    for (const canary of canaries) expect(serialized, `Must not serialize ${canary}`).not.toContain(canary);
  }

  test("calendar membership scope cannot be widened by userId, scope or project queries", async ({ request }) => {
    const s = await seed(request);
    for (const who of ["a", "b"] as const) {
      await as(request, s, who);
      const expected = who === "a" ? [s.entries.aApproved, s.entries.aConflicted, s.entries.aInvoiced] : [s.entries.bApproved, s.entries.bInvoiced];
      for (const query of ["", `?userId=${who === "a" ? s.b.userId : s.a.userId}`, "?scope=workspace", `?projectId=${s.peerProject}&scope=team&userId=${s.foreign.userId}`]) {
        const response = await request.get(`/api/calendar${query}`); expect(response.status()).toBe(200);
        const body = await response.json(); expect(body.ok).toBe(true); expect(Array.isArray(body.tasks)).toBe(true); expect(ids(body.entries)).toEqual(expected.sort());
        absent(body, [s.entries.foreign, s.canaries.foreign, ...(who === "a" ? [s.entries.bApproved, s.entries.bInvoiced, s.canaries.peer] : [s.entries.aApproved, s.entries.aConflicted, s.entries.aInvoiced])]);
      }
    }
    for (const who of ["owner", "manager"] as const) {
      await as(request, s, who); const body = await (await request.get("/api/calendar")).json();
      expect(ids(body.entries)).toEqual([s.entries.aApproved, s.entries.aConflicted, s.entries.aInvoiced, s.entries.bApproved, s.entries.bInvoiced].sort()); absent(body, [s.entries.foreign, s.canaries.foreign]);
    }
  });

  test("activity follows target ownership rather than actor and strips every member raw diff", async ({ request }) => {
    const s = await seed(request);
    for (const who of ["a", "b"] as const) {
      await as(request, s, who);
      const ownAudits = who === "a" ? [s.audits.managerOnA, s.audits.snapshotOnA] : [s.audits.aActorOnB, s.audits.bTarget];
      const cases: Array<[string, string[]]> = [
        ["", ownAudits],
        [`?userId=${s.b.userId}&scope=workspace`, ownAudits],
        [`?projectId=${s.sharedProject}&userId=${s.foreign.userId}&scope=team`, who === "a" ? [s.audits.managerOnA, s.audits.snapshotOnA] : [s.audits.aActorOnB]],
        [`?projectId=${s.peerProject}`, who === "a" ? [] : [s.audits.bTarget]],
        [`?projectId=${s.foreignProject}`, []],
      ];
      for (const [query, expected] of cases) {
        const response = await request.get(`/api/activity${query}`); expect(response.status()).toBe(200); const body = await response.json();
        expect(ids(body.activities)).toEqual(expected.sort());
        for (const activity of body.activities) expect(activity.diff).toEqual({});
        absent(body, [s.audits.foreign, s.audits.crossWorkspaceTarget, s.audits.noEntry, s.entries.foreign, s.canaries.foreign, s.canaries.snapshot, ...(who === "a" ? [s.audits.aActorOnB, s.audits.bTarget, s.canaries.peer] : [s.audits.managerOnA, s.audits.snapshotOnA])]);
      }
    }
    for (const who of ["manager", "owner"] as const) {
      await as(request, s, who); const response = await request.get("/api/activity"); expect(response.status()).toBe(200); const body = await response.json();
      expect(ids(body.activities)).toEqual([s.audits.managerOnA, s.audits.snapshotOnA, s.audits.aActorOnB, s.audits.bTarget, s.audits.crossWorkspaceTarget, s.audits.noEntry].sort());
      expect(JSON.stringify(body)).toContain(s.canaries.snapshot); absent(body, [s.audits.foreign]);
    }
  });

  test("invoice summaries require all nonempty unique links to be owned while hidden history still blocks rebilling", async ({ request }) => {
    const s = await seed(request);
    for (const who of ["a", "b"] as const) {
      await as(request, s, who);
      for (const query of ["", `?userId=${s.b.userId}&scope=workspace&projectId=${s.peerProject}`, `?scope=team&userId=${s.foreign.userId}`]) {
        const response = await request.get(`/api/invoices${query}`); expect(response.status()).toBe(200); const body = await response.json();
        expect(body.ok).toBe(true); expect(body.workspaceId).toBe(s.owner.workspaceId); expect(body.canManage).toBe(false);
        expect(ids(body.invoices)).toEqual([who === "a" ? s.invoices.own : s.invoices.peer]);
        expect(ids(body.billableEntries)).toEqual(who === "a" ? [s.entries.aApproved, s.entries.aConflicted].sort() : [s.entries.bApproved]);
        if (who === "a") expect(body.billableEntries.find((row: { id: string }) => row.id === s.entries.aConflicted)).toMatchObject({ eligible: false, ineligibleReason: "This time is already linked to an invoice. Ask a manager to review it." });
        absent(body, [s.invoices.mixed, s.invoices.missing, s.invoices.duplicate, s.invoices.foreignLink, s.invoices.empty, s.invoices.blank, s.invoices.foreign, s.entries.foreign, s.canaries.foreign, s.canaries.snapshot, ...(who === "a" ? [s.invoices.peer, s.entries.bApproved, s.entries.bInvoiced, s.canaries.peer] : [s.invoices.own, s.entries.aApproved, s.entries.aInvoiced, s.entries.aConflicted])]);
      }
    }
    for (const who of ["owner", "manager"] as const) {
      await as(request, s, who); const response = await request.get("/api/invoices"); expect(response.status()).toBe(200); const body = await response.json();
      expect(body.canManage).toBe(true); expect(ids(body.invoices)).toEqual(Object.entries(s.invoices).filter(([key]) => key !== "foreign").map(([, id]) => id).sort());
      expect(ids(body.billableEntries)).toEqual([s.entries.aApproved, s.entries.aConflicted, s.entries.bApproved].sort());
      // Managers retain malformed workspace history, including its saved IDs,
      // but that reference must not load a foreign invoice or entry detail.
      expect(body.invoices.find((row: { id: string }) => row.id === s.invoices.foreignLink).timeEntryIds).toEqual([s.entries.aInvoiced, s.entries.foreign]);
      absent(body, [s.invoices.foreign, s.canaries.foreign]);
      absent(body.billableEntries, [s.entries.foreign]);
    }
  });

  test("members cannot load current or approved full proof/print documents and saved evidence remains unchanged", async ({ request }) => {
    const s = await seed(request); await as(request, s, "owner");
    const reviewedResponse = await request.get(`/api/invoices/${s.invoices.mixed}/proof-pack`); expect(reviewedResponse.status()).toBe(200); const reviewed = await reviewedResponse.json();
    expect(JSON.stringify(reviewed.proofPack)).toContain(s.canaries.peer);
    const signoffId = crypto.randomUUID();
    // Persist the exact generated bytes/digest pair; never redact or edit a
    // signed snapshot, and never re-label an old digest as a redacted proof.
    await db.insert(schema.auditLogs).values({ id: signoffId, workspaceId: s.owner.workspaceId, timeEntryId: s.invoices.mixed, actorUserId: s.owner.userId, eventType: "client_invoice_signed_off", signature: "owned-synthetic-signoff", diff: { clientSignoff: { after: { invoiceId: s.invoices.mixed, invoiceNumber: reviewed.proofPack.invoice.number, signedOffAt: at.toISOString(), digest: reviewed.digest, snapshot: reviewed.proofPack } } } });
    const [before] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, signoffId));
    for (const who of ["a", "b"] as const) {
      await as(request, s, who);
      for (const invoiceId of [s.invoices.own, s.invoices.mixed, s.invoices.peer, s.invoices.foreign, crypto.randomUUID()]) for (const suffix of ["proof-pack", "proof-pack?approved=true", "print", "print?approved=true&scope=workspace"]) {
        const response = await request.get(`/api/invoices/${invoiceId}/${suffix}`); expect(response.status()).toBe(403); expect(response.headers()["x-sowledger-proof-sha256"]).toBeUndefined(); absent(await response.text(), [s.canaries.peer, s.canaries.foreign, reviewed.digest]);
      }
    }
    for (const who of ["manager", "owner"] as const) {
      await as(request, s, who);
      const response = await request.get(`/api/invoices/${s.invoices.mixed}/proof-pack?approved=true`); expect(response.status()).toBe(200); const body = await response.json();
      expect(body.digest).toBe(reviewed.digest); expect(body.proofPack).toEqual(reviewed.proofPack); expect(response.headers()["x-sowledger-proof-sha256"]).toBe(reviewed.digest);
      const print = await request.get(`/api/invoices/${s.invoices.mixed}/print?approved=true`); expect(print.status()).toBe(200); expect(print.headers()["x-sowledger-proof-sha256"]).toBe(reviewed.digest); expect(await print.text()).toContain(s.canaries.peer);
    }
    const [after] = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.id, signoffId)); expect(after).toEqual(before);
  });
});
