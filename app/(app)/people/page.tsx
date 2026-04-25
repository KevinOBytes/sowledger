import { Building2, MailPlus, Users } from "lucide-react";

import { requireSession } from "@/lib/auth";
import { ensureWorkspaceSchema } from "@/lib/db/ensure-workspace-schema";
import { listWorkspacePeopleDirectory } from "@/lib/people-directory";

import { PeopleWorkspaceClient } from "@/components/people-workspace-client";

export const metadata = { title: "People - Billabled" };

export default async function PeoplePage({
  searchParams,
}: {
  searchParams?: Promise<{ client?: string; organization?: string; type?: string }>;
}) {
  const session = await requireSession();
  await ensureWorkspaceSchema();
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  const { organizations, people } = await listWorkspacePeopleDirectory(session.workspaceId);

  return (
    <main className="min-h-screen bg-[#f6f3ee] p-4 text-slate-950 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Manage</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">People & organizations</h1>
              <p className="mt-2 max-w-3xl text-sm text-slate-500">
                Keep internal teammates, client contacts, and contractors organized under a company or team, then assign them across planning and project delivery.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <Users className="h-4 w-4 text-cyan-700" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">People</span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{people.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <Building2 className="h-4 w-4 text-cyan-700" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">Organizations</span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{organizations.length}</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="flex items-center gap-2 text-slate-500">
                  <MailPlus className="h-4 w-4 text-cyan-700" />
                  <span className="text-xs font-bold uppercase tracking-[0.2em]">Pending invites</span>
                </div>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{people.filter((person) => person.invitationStatus === "pending").length}</p>
              </div>
            </div>
          </div>
        </header>

        <PeopleWorkspaceClient
          initialOrganizations={organizations}
          initialPeople={people}
          initialClientFilter={resolvedSearchParams?.client ?? ""}
          initialOrganizationFilter={resolvedSearchParams?.organization ?? ""}
          initialTypeFilter={resolvedSearchParams?.type ?? ""}
        />
      </div>
    </main>
  );
}
