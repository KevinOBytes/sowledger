"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Building2, MailPlus, Pencil, Plus, RotateCcw, Shield, UserCog, Users } from "lucide-react";

type Organization = {
  id: string;
  name: string;
  type: "internal" | "client" | "vendor" | "partner" | "other";
  clientId?: string | null;
};

type Person = {
  id: string;
  organizationId: string;
  linkedUserId?: string | null;
  displayName: string | null;
  email: string | null;
  title: string | null;
  personType: "member" | "client" | "contractor" | "contact";
  invitationStatus: "none" | "pending" | "accepted";
  inviteRole: "client" | "member" | "manager" | "owner" | null;
  status: "active" | "archived";
};

export function PeopleWorkspaceClient({
  initialOrganizations,
  initialPeople,
  initialClientFilter,
  initialOrganizationFilter,
  initialTypeFilter,
}: {
  initialOrganizations: Organization[];
  initialPeople: Person[];
  initialClientFilter?: string;
  initialOrganizationFilter?: string;
  initialTypeFilter?: string;
}) {
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [people, setPeople] = useState(initialPeople);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [organizationId, setOrganizationId] = useState(initialOrganizations[0]?.id ?? "");
  const [organizationName, setOrganizationName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [personType, setPersonType] = useState<Person["personType"]>("member");
  const [invite, setInvite] = useState(true);
  const [inviteRole, setInviteRole] = useState<"client" | "member" | "manager">("member");
  const [clientFilter, setClientFilter] = useState(initialClientFilter ?? "");
  const [organizationFilter, setOrganizationFilter] = useState(initialOrganizationFilter ?? "");
  const [typeFilter, setTypeFilter] = useState(initialTypeFilter ?? "");
  const [editingOrganizationId, setEditingOrganizationId] = useState<string | null>(null);
  const [organizationDrafts, setOrganizationDrafts] = useState<Record<string, { name: string; type: Organization["type"] }>>({});

  const groupedPeople = useMemo(() => {
    const filteredOrganizations = organizations.filter((organization) => {
      if (clientFilter && organization.clientId !== clientFilter) return false;
      if (organizationFilter && organization.id !== organizationFilter) return false;
      if (typeFilter && organization.type !== typeFilter) return false;
      return true;
    });
    return filteredOrganizations.map((organization) => ({
      organization,
      people: people.filter((person) => person.organizationId === organization.id && person.status === "active"),
    }));
  }, [clientFilter, organizationFilter, organizations, people, typeFilter]);

  const workspaceMembers = useMemo(() => people.filter((person) => person.personType === "member"), [people]);

  async function refreshDirectory() {
    const refreshed = await fetch("/api/people");
    const refreshedData = await refreshed.json();
    if (refreshed.ok) {
      setOrganizations(refreshedData.organizations);
      setPeople(refreshedData.people);
      return refreshedData;
    }
    throw new Error(refreshedData.error || "Unable to refresh people");
  }

  async function submitPerson(event: React.FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationId || undefined,
          organizationName: organizationId ? undefined : organizationName,
          organizationType: personType === "member" ? "internal" : "other",
          displayName,
          email,
          title,
          personType,
          invite,
          inviteRole,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save person");

      setPeople((current) => [data.person, ...current]);
      if (!organizationId && organizationName.trim()) {
        const refreshedData = await refreshDirectory();
        setOrganizationId(refreshedData.organizations[0]?.id ?? "");
      }
      toast.success(invite ? "Person created and invite queued" : "Person created");
      setOrganizationName("");
      setDisplayName("");
      setEmail("");
      setTitle("");
    } catch (error) {
      toast.error("Could not save person", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setIsSubmitting(false);
    }
  }

  function startOrganizationEdit(organization: Organization) {
    setEditingOrganizationId(organization.id);
    setOrganizationDrafts((current) => ({
      ...current,
      [organization.id]: {
        name: organization.name,
        type: organization.type,
      },
    }));
  }

  async function saveOrganization(organizationIdToSave: string) {
    const draft = organizationDrafts[organizationIdToSave];
    if (!draft) return;
    try {
      const response = await fetch("/api/organizations", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId: organizationIdToSave,
          name: draft.name,
          type: draft.type,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update organization");
      setOrganizations((current) => current.map((organization) => (organization.id === organizationIdToSave ? data.organization : organization)));
      setEditingOrganizationId(null);
      toast.success("Organization updated");
    } catch (error) {
      toast.error("Could not update organization", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  async function patchPerson(personId: string, payload: Record<string, unknown>, successMessage: string) {
    try {
      const response = await fetch("/api/people", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personId, ...payload }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to update person");
      setPeople((current) => current.map((person) => (person.id === personId ? data.person : person)));
      if (payload.workspaceRole || payload.resendInvite) {
        await refreshDirectory();
      }
      toast.success(successMessage);
    } catch (error) {
      toast.error("Could not update person", { description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[1.1fr_1.4fr]">
      <section className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700">
            <Plus className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Add a person</h2>
            <p className="mt-1 text-sm text-slate-500">Assign each person to an organization. If none exists yet, create one inline and optionally send an invite immediately.</p>
          </div>
        </div>

        <form onSubmit={submitPerson} className="mt-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Organization
              <select
                value={organizationId}
                onChange={(event) => setOrganizationId(event.target.value)}
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"
              >
                <option value="">Create new organization</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm font-semibold text-slate-700">
              New organization name
              <input
                value={organizationName}
                onChange={(event) => setOrganizationName(event.target.value)}
                disabled={Boolean(organizationId)}
                placeholder="Acme Studio"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500 disabled:opacity-50"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-semibold text-slate-700">
              Name
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                placeholder="Avery Chen"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-sm font-semibold text-slate-700">
              Email
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="avery@acme.com"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <label className="text-sm font-semibold text-slate-700">
              Title
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Project lead"
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-500"
              />
            </label>

            <label className="text-sm font-semibold text-slate-700">
              Person type
              <select
                value={personType}
                onChange={(event) => {
                  const nextType = event.target.value as Person["personType"];
                  setPersonType(nextType);
                  if (nextType === "client") setInviteRole("client");
                  if (nextType === "member") setInviteRole("member");
                }}
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"
              >
                <option value="member">Internal member</option>
                <option value="client">Client contact</option>
                <option value="contractor">Contractor</option>
                <option value="contact">General contact</option>
              </select>
            </label>

            <label className="text-sm font-semibold text-slate-700">
              Invite role
              <select
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as "client" | "member" | "manager")}
                disabled={!invite}
                className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500 disabled:opacity-50"
              >
                <option value="member">Member</option>
                <option value="client">Client</option>
                <option value="manager">Manager</option>
              </select>
            </label>
          </div>

          <label className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <input checked={invite} onChange={(event) => setInvite(event.target.checked)} type="checkbox" className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500" />
            Send an invite if this person is joining the workspace
          </label>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isSubmitting || (!organizationId && !organizationName.trim())}
              className="inline-flex items-center gap-2 rounded-2xl bg-cyan-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50"
            >
              <MailPlus className="h-4 w-4" />
              {isSubmitting ? "Saving..." : invite ? "Create & invite" : "Create person"}
            </button>
          </div>
        </form>
      </section>

      <section className="space-y-4">
        <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Workspace access</h2>
              <p className="mt-1 text-sm text-slate-500">Manage internal member roles and pending invitations without leaving the people workspace.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{workspaceMembers.length} records</span>
          </div>

          <div className="mt-5 space-y-3">
            {workspaceMembers.map((person) => (
              <div key={person.id} className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="font-semibold text-slate-950">{person.displayName || person.email || "Unnamed member"}</p>
                  <p className="mt-1 text-sm text-slate-500">{person.email || "No email"}{person.title ? ` • ${person.title}` : ""}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600">{person.invitationStatus}</span>
                  {person.linkedUserId ? (
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                      <Shield className="h-4 w-4 text-cyan-700" />
                      <select
                        value={person.inviteRole || "member"}
                        onChange={(event) => patchPerson(person.id, { workspaceRole: event.target.value }, "Workspace role updated")}
                        className="bg-transparent outline-none"
                      >
                        <option value="client">Client</option>
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                        <option value="owner">Owner</option>
                      </select>
                    </label>
                  ) : (
                    <label className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700">
                      <UserCog className="h-4 w-4 text-cyan-700" />
                      <select
                        value={person.inviteRole || "member"}
                        onChange={(event) => patchPerson(person.id, { inviteRole: event.target.value }, "Invite role updated")}
                        className="bg-transparent outline-none"
                      >
                        <option value="client">Client</option>
                        <option value="member">Member</option>
                        <option value="manager">Manager</option>
                      </select>
                    </label>
                  )}
                  {!person.linkedUserId && person.email && (
                    <button onClick={() => patchPerson(person.id, { resendInvite: true }, "Invite resent")} className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                      <RotateCcw className="h-4 w-4" />
                      Resend invite
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </article>

        <article className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">Focus on one client, organization, or organization type when you are managing contacts.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500">
                <option value="">All clients</option>
                {organizations.filter((organization) => organization.clientId).map((organization) => (
                  <option key={organization.id} value={organization.clientId || ""}>
                    {organization.name}
                  </option>
                ))}
              </select>
              <select value={organizationFilter} onChange={(event) => setOrganizationFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500">
                <option value="">All organizations</option>
                {organizations.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.name}
                  </option>
                ))}
              </select>
              <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500">
                <option value="">All types</option>
                <option value="internal">Internal</option>
                <option value="client">Client</option>
                <option value="vendor">Vendor</option>
                <option value="partner">Partner</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
        </article>

        {groupedPeople.map(({ organization, people: peopleForOrganization }) => (
          <article key={organization.id} className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-600">
                    {organization.type === "internal" ? <Users className="h-5 w-5" /> : <Building2 className="h-5 w-5" />}
                  </div>
                  <div>
                    {editingOrganizationId === organization.id ? (
                      <div className="flex flex-col gap-2">
                        <input
                          value={organizationDrafts[organization.id]?.name ?? organization.name}
                          onChange={(event) => setOrganizationDrafts((current) => ({ ...current, [organization.id]: { name: event.target.value, type: current[organization.id]?.type ?? organization.type } }))}
                          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold outline-none focus:border-cyan-500"
                        />
                        <select
                          value={organizationDrafts[organization.id]?.type ?? organization.type}
                          onChange={(event) => setOrganizationDrafts((current) => ({ ...current, [organization.id]: { name: current[organization.id]?.name ?? organization.name, type: event.target.value as Organization["type"] } }))}
                          className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-cyan-500"
                        >
                          <option value="internal">Internal</option>
                          <option value="client">Client</option>
                          <option value="vendor">Vendor</option>
                          <option value="partner">Partner</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                    ) : (
                      <>
                        <h2 className="text-xl font-semibold text-slate-950">{organization.name}</h2>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">{organization.type}</p>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                  {peopleForOrganization.length} people
                </span>
                {editingOrganizationId === organization.id ? (
                  <button onClick={() => saveOrganization(organization.id)} className="rounded-2xl bg-cyan-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-cyan-500">Save</button>
                ) : (
                  <button onClick={() => startOrganizationEdit(organization)} className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-2">
              {peopleForOrganization.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                  No people added to this organization yet.
                </div>
              ) : (
                peopleForOrganization.map((person) => (
                  <div key={person.id} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-950">{person.displayName || person.email || "Unnamed person"}</h3>
                        <p className="mt-1 text-xs text-slate-500">{person.title || "No title yet"}</p>
                      </div>
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500">
                        {person.personType}
                      </span>
                    </div>
                    <p className="mt-3 text-sm text-slate-600">{person.email || "No email on file"}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {person.invitationStatus !== "none" && (
                        <span className="text-xs font-semibold text-cyan-700">
                          {person.invitationStatus === "accepted" ? "Workspace access active" : `Invite ${person.invitationStatus}`}
                        </span>
                      )}
                      <button onClick={() => patchPerson(person.id, { status: "archived" }, "Person archived")} className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-rose-200 hover:text-rose-600">
                        Archive
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </article>
        ))}

        {organizations.length === 0 && (
          <div className="rounded-[32px] border border-dashed border-slate-300 bg-white p-16 text-center shadow-sm">
            <Users className="mx-auto mb-4 h-14 w-14 text-slate-300" />
            <h3 className="text-xl font-semibold text-slate-950">No organizations yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">Create your first organization and person to make task assignment and planning real across the workspace.</p>
          </div>
        )}
      </section>
    </div>
  );
}
