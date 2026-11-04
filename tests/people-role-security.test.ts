/* eslint-disable @typescript-eslint/no-explicit-any -- Actual handlers/auth with isolated persistence and cookie boundaries. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { errorFixture } from "./helpers/error-boundary-fixtures";

// Catch: accepting JSON roles by type assertion, or comparing undefined role
// weights, must never grant a manager owner access or admit an invalid session.
function fixture(actorRole = "manager") {
  const f = errorFixture();
  const savedInvitations: any[] = [];
  let createdOrganizations = 0;
  const actor = { sub: "actor", workspaceId: "workspace", email: "manager@example.com", role: actorRole };
  f.dependencies["@/lib/admin"].isAdminEmail = () => false;
  f.dependencies["@/lib/env"].env.ALLOW_BOOTSTRAP_OWNER = false;
  f.dependencies["@/lib/auth"].requireSession = async () => actor;
  // Keep the real inviteUser normalization and validation. Only its storage
  // boundary is replaced, so a guard cannot pass by swallowing the invitation.
  f.dependencies["@/lib/auth"].inviteUser = f.auth.inviteUser;
  f.dependencies["@/lib/store"].createInvitation = async (input: any) => {
    savedInvitations.push(structuredClone(input));
    return { id: "invitation", acceptedAt: null, ...input };
  };
  f.dependencies["@/lib/people-directory"] = {
    createOrganization: async () => { createdOrganizations++; return { id: "organization", workspaceId: "workspace" }; },
    listWorkspacePeopleDirectory: async () => ({ organizations: [], people: [] }),
  };
  const schema = f.load("@/lib/db/schema");
  f.state.tables.set(schema.organizations, [{ id: "organization", workspaceId: "workspace" }]);
  f.state.tables.set(schema.workspacePeople, [{ id: "person", workspaceId: "workspace", organizationId: "organization", linkedUserId: "member", email: "member@example.com", inviteRole: "member", invitationStatus: "accepted" }]);
  f.state.tables.set(schema.memberships, [{ workspaceId: "workspace", userId: "member", role: "member" }]);
  return {
    ...f, actor, savedInvitations,
    effects: () => ({ writes: f.state.writes, organizations: createdOrganizations, invitations: savedInvitations.length }),
    async persistedSession(role: unknown) {
      const token = await f.auth.createSessionToken(actor);
      f.dependencies["next/headers"].cookies = async () => ({ get: () => ({ value: token }) });
      f.dependencies["@/lib/store"].getMembership = async () => ({ workspaceId: "workspace", userId: "actor", role });
      return f.auth.requireSession();
    },
  };
}

test("a manager cannot self-invite as owner or create an organization before that refusal", async () => {
  const f = fixture();
  const response = await f.call("people", "POST", { value: { organizationName: "Uncommitted organization", email: "manager@example.com", invite: true, inviteRole: "owner" } });
  assert.ok([400, 403].includes(response.status), `Expected a rejected owner invitation; received ${response.status}`);
  assert.deepEqual(f.effects(), { writes: 0, organizations: 0, invitations: 0 });
});

const invalidRoles: unknown[] = ["superuser", "__proto__", "constructor", "toString", "", null, 17, {}, []];
for (const role of invalidRoles) {
  const label = JSON.stringify(role);
  test(`People POST rejects invalid inviteRole ${label} before all mutations`, async () => {
    const f = fixture();
    const response = await f.call("people", "POST", { value: { organizationName: "Must not be created", email: "member@example.com", invite: true, inviteRole: role } });
    assert.equal(response.status, 400);
    assert.deepEqual(f.effects(), { writes: 0, organizations: 0, invitations: 0 });
  });

  for (const field of ["inviteRole", "workspaceRole"]) {
    test(`People PATCH rejects invalid ${field} ${label} before all mutations`, async () => {
      const f = fixture();
      const response = await f.call("people", "PATCH", { value: { personId: "person", [field]: role, ...(field === "inviteRole" ? { resendInvite: true } : {}) } });
      assert.equal(response.status, 400);
      assert.deepEqual(f.effects(), { writes: 0, organizations: 0, invitations: 0 });
    });
  }

  test(`the shared role guard fails closed for invalid actual role ${label}`, () => {
    const f = fixture();
    assert.throws(() => f.auth.requireRole("member", role), f.classes.ForbiddenError);
    assert.throws(() => f.auth.requireRole("manager", role), f.classes.ForbiddenError);
    assert.throws(() => f.auth.requireRole("owner", role), f.classes.ForbiddenError);
  });

  test(`session decoding rejects persisted invalid membership role ${label}`, async () => {
    const f = fixture();
    await assert.rejects(f.persistedSession(role), (error: any) => error instanceof f.classes.UnauthorizedError || error instanceof f.classes.ForbiddenError);
    assert.deepEqual(f.effects(), { writes: 0, organizations: 0, invitations: 0 });
  });
}

test("an invalid required role cannot accidentally authorize an otherwise valid owner", () => {
  const f = fixture("owner");
  assert.throws(() => f.auth.requireRole("unknown", "owner"), f.classes.ForbiddenError);
});

for (const role of ["client", "member"]) {
  test(`a manager can still invite a ${role} through the actual invitation adapter`, async () => {
    const f = fixture();
    const response = await f.call("people", "POST", { value: { organizationId: "organization", email: " INVITED@EXAMPLE.COM ", invite: true, inviteRole: role } });
    assert.equal(response.status, 200);
    assert.equal(f.savedInvitations.length, 1);
    assert.equal(f.savedInvitations[0].role, role);
    assert.equal(f.savedInvitations[0].email, "invited@example.com");
    assert.equal(f.savedInvitations[0].workspaceId, "workspace");
    assert.equal(f.savedInvitations[0].invitedByUserId, "actor");
    assert.equal(f.effects().writes, 1, "The accepted route must persist its person, not only return success");
  });
}

test("an owner can still invite a manager", async () => {
  const f = fixture("owner");
  const response = await f.call("people", "POST", { value: { organizationId: "organization", email: "promoted@example.com", invite: true, inviteRole: "manager" } });
  assert.equal(response.status, 200);
  assert.equal(f.savedInvitations[0]?.role, "manager");
  assert.equal(f.effects().writes, 1);
});

test("a manager cannot promote or resend an owner invitation through PATCH", async () => {
  for (const value of [{ workspaceRole: "owner" }, { inviteRole: "owner", resendInvite: true }]) {
    const f = fixture();
    const response = await f.call("people", "PATCH", { value: { personId: "person", ...value } });
    assert.equal(response.status, 403);
    assert.deepEqual(f.effects(), { writes: 0, organizations: 0, invitations: 0 });
  }
});

test("a valid current member role overrides an old owner role in the signed cookie", async () => {
  const f = fixture("owner");
  const session = await f.persistedSession("member");
  assert.equal(session.role, "member");
  assert.throws(() => f.auth.requireRole("manager", session.role), f.classes.ForbiddenError);
});
