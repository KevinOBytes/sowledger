import { redirect } from "next/navigation";
import { requireSession, ForbiddenError, UnauthorizedError } from "@/lib/auth";
import { isAdminEmail } from "@/lib/admin";
import { store } from "@/lib/store";
import Link from "next/link";

export const metadata = { title: "Admin Dashboard – Timely" };

export default async function AdminPage() {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) redirect("/login");
    throw err;
  }

  if (!isAdminEmail(session.email)) {
    throw new ForbiddenError("Admin access requires a @kevinbytes.com email address.");
  }

  const users = [...store.users.values()].map((u) => ({
    id: u.id,
    email: u.email,
    displayName: u.displayName ?? null,
    timezone: u.timezone,
    createdAt: u.createdAt,
    role: store.memberships.find((m) => m.userId === u.id)?.role ?? "—",
  }));

  const workspaces = [...store.workspaces.values()].map((w) => ({
    id: w.id,
    slug: w.slug,
    name: w.name,
    baseCurrency: w.baseCurrency,
    createdAt: w.createdAt,
    memberCount: store.memberships.filter((m) => m.workspaceId === w.id).length,
  }));

  const stats = {
    totalUsers: store.users.size,
    totalWorkspaces: store.workspaces.size,
    totalEntries: store.entries.size,
    totalMemberships: store.memberships.length,
  };

  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Admin Dashboard</h1>
            <p className="mt-1 text-sm text-slate-400">
              Signed in as <span className="text-cyan-400">{session.email}</span>
            </p>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-700 hover:text-white"
          >
            ← Back to app
          </Link>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            { label: "Total Users", value: stats.totalUsers },
            { label: "Workspaces", value: stats.totalWorkspaces },
            { label: "Time Entries", value: stats.totalEntries },
            { label: "Memberships", value: stats.totalMemberships },
          ].map((card) => (
            <div key={card.label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-2 text-3xl font-bold text-white">{card.value}</p>
            </div>
          ))}
        </div>

        {/* Users table */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Users</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Display Name</th>
                  <th className="px-4 py-3">Timezone</th>
                  <th className="px-4 py-3">Role</th>
                  <th className="px-4 py-3">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950">
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">No users yet.</td>
                  </tr>
                ) : (
                  users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-900/60">
                      <td className="px-4 py-3 font-medium text-white">
                        {u.email}
                        {isAdminEmail(u.email) && (
                          <span className="ml-2 rounded-full bg-cyan-900/50 px-2 py-0.5 text-[10px] font-semibold uppercase text-cyan-400">
                            admin
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-300">{u.displayName ?? <span className="text-slate-600">—</span>}</td>
                      <td className="px-4 py-3 text-slate-300">{u.timezone}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          u.role === "owner" ? "bg-amber-900/40 text-amber-400" :
                          u.role === "manager" ? "bg-violet-900/40 text-violet-400" :
                          "bg-slate-800 text-slate-400"
                        }`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Workspaces table */}
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Workspaces</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3">Name / Slug</th>
                  <th className="px-4 py-3">Currency</th>
                  <th className="px-4 py-3">Members</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 bg-slate-950">
                {workspaces.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-500">No workspaces yet.</td>
                  </tr>
                ) : (
                  workspaces.map((w) => (
                    <tr key={w.id} className="hover:bg-slate-900/60">
                      <td className="px-4 py-3">
                        <p className="font-medium text-white">{w.name}</p>
                        <p className="text-xs text-slate-500">{w.slug}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{w.baseCurrency}</td>
                      <td className="px-4 py-3 text-slate-300">{w.memberCount}</td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(w.createdAt).toLocaleDateString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
