"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, Building2Icon, CheckIcon, Edit2, Mail, Users, XIcon } from "lucide-react";

type Client = { id: string; name: string; email: string | null; status: "active" | "archived" };
type Project = { id: string; clientId: string | null };
type Organization = { id: string; clientId: string | null };
type Person = { id: string; organizationId: string };

function isSavedClient(value: unknown): value is Client {
  if (!value || typeof value !== "object") return false;
  const client = value as Record<string, unknown>;
  return typeof client.id === "string" && !!client.id && typeof client.name === "string" && !!client.name.trim() && (client.email === null || typeof client.email === "string") && (client.status === "active" || client.status === "archived");
}

export function ClientsPageClient({ initialClients, projects, organizations, people, canManageClients }: {
  initialClients: Client[]; projects: Project[]; organizations: Organization[]; people: Person[]; canManageClients: boolean;
}) {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const focusAfterEdit = useRef<string | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);
  const [feedback, setFeedback] = useState<{ type: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setClients(initialClients), 0);
    return () => window.clearTimeout(timeout);
  }, [initialClients]);

  useEffect(() => {
    if (feedback?.type === "error") feedbackRef.current?.focus();
    if (!editingId && focusAfterEdit.current) {
      document.getElementById(`client-edit-${focusAfterEdit.current}`)?.focus();
      focusAfterEdit.current = null;
    }
  }, [feedback, editingId]);

  function startEdit(client: Client) {
    if (!canManageClients || pendingRef.current) return;
    setEditingId(client.id);
    setEditName(client.name);
    setEditEmail(client.email ?? "");
    setFeedback(null);
  }

  function cancelEdit(id: string) {
    if (pendingRef.current) return;
    focusAfterEdit.current = id;
    setEditingId(null);
    setFeedback(null);
  }

  async function saveClient(client: Client, action: "edit" | "status") {
    if (!canManageClients || pendingRef.current || (action === "edit" && (!editName.trim() || editingId !== client.id))) return;
    pendingRef.current = true;
    setPendingId(client.id);
    setFeedback(null);
    const expected = action === "edit"
      ? { name: editName.trim(), email: editEmail.trim().toLowerCase() || null, status: client.status }
      : { name: client.name, email: client.email, status: client.status === "active" ? "archived" : "active" };
    try {
      const response = await fetch("/api/clients", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "edit" ? { clientId: client.id, name: expected.name, email: editEmail.trim() } : { clientId: client.id, status: expected.status }),
      });
      const data = await response.json();
      // Other managers may change fields this operation did not submit.
      if (!response.ok || data?.ok !== true || !isSavedClient(data.client) || data.client.id !== client.id ||
        (action === "edit"
          ? data.client.name !== expected.name || data.client.email !== expected.email
          : data.client.status !== expected.status)) throw new Error("Unconfirmed client save");
      const saved: Client = data.client;
      setClients(current => current.map(item => item.id === saved.id ? saved : item));
      if (action === "edit") {
        focusAfterEdit.current = client.id;
        setEditingId(null);
      }
      setFeedback({ type: "success", text: action === "edit" ? "Client changes saved." : saved.status === "archived" ? "Client archived." : "Client restored." });
      router.refresh();
    } catch {
      setFeedback({ type: "error", text: action === "edit" ? "Could not confirm the client changes were saved. Your edits are still here; please try again." : "Could not confirm the client status was saved. Please try again." });
    } finally {
      pendingRef.current = false;
      setPendingId(null);
    }
  }

  function renderClient(client: Client) {
    const clientProjects = projects.filter(project => project.clientId === client.id);
    const organizationIds = organizations.filter(organization => organization.clientId === client.id).map(organization => organization.id);
    const peopleCount = people.filter(person => organizationIds.includes(person.organizationId)).length;
    const isEditing = editingId === client.id;
    const disabled = pendingId !== null;
    return (
      <article key={client.id} className="min-w-0 rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Building2Icon aria-hidden="true" className="h-5 w-5" /></div>
            <div className="min-w-0 flex-1">
              {isEditing ? (
                <div className="space-y-3" onKeyDown={event => {
                  if (event.key === "Escape") { event.preventDefault(); cancelEdit(client.id); }
                  if (event.key === "Enter") { event.preventDefault(); void saveClient(client, "edit"); }
                }}>
                  <label htmlFor={`client-name-${client.id}`} className="block text-sm font-semibold text-slate-700">Client name
                    <input id={`client-name-${client.id}`} type="text" required maxLength={255} disabled={disabled} value={editName} onChange={event => setEditName(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500 disabled:opacity-60" autoFocus />
                  </label>
                  <label htmlFor={`client-email-${client.id}`} className="block text-sm font-semibold text-slate-700">Billing email
                    <input id={`client-email-${client.id}`} type="email" maxLength={255} disabled={disabled} value={editEmail} onChange={event => setEditEmail(event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500 disabled:opacity-60" />
                  </label>
                </div>
              ) : <><h3 className="break-words text-xl font-semibold text-slate-950">{client.name}</h3><p className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-slate-500"><Mail aria-hidden="true" className="h-3 w-3 shrink-0" /><span className="break-all">{client.email || "No billing email"}</span></p></>}
            </div>
          </div>
          {canManageClients && <div className="flex shrink-0 gap-1">
            {isEditing ? <>
              <button disabled={disabled || !editName.trim()} onClick={() => void saveClient(client, "edit")} title="Save changes" aria-label="Save changes" className="rounded-xl bg-cyan-50 p-2 text-cyan-700 disabled:opacity-50"><CheckIcon aria-hidden="true" className="h-4 w-4" /></button>
              <button disabled={disabled} onClick={() => cancelEdit(client.id)} title="Cancel editing" aria-label="Cancel editing" className="rounded-xl bg-slate-50 p-2 text-slate-500 disabled:opacity-50"><XIcon aria-hidden="true" className="h-4 w-4" /></button>
            </> : <>
              <button id={`client-edit-${client.id}`} disabled={disabled} title="Edit Client" aria-label="Edit Client" onClick={() => startEdit(client)} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-50"><Edit2 aria-hidden="true" className="h-4 w-4" /></button>
              <button disabled={disabled} title={client.status === "active" ? "Archive Client" : "Restore Client"} aria-label={client.status === "active" ? "Archive Client" : "Restore Client"} onClick={() => void saveClient(client, "status")} className="rounded-xl bg-slate-50 p-2 text-slate-500 hover:bg-cyan-50 hover:text-cyan-700 disabled:opacity-50"><Archive aria-hidden="true" className="h-4 w-4" /></button>
            </>}
          </div>}
        </div>
        {pendingId === client.id && <p role="status" className="mt-3 text-sm text-slate-500">Saving client…</p>}
        <div className="mt-5 flex flex-wrap gap-3 text-xs font-semibold text-slate-500">
          <span>{clientProjects.length} project{clientProjects.length === 1 ? "" : "s"}</span>
          <span className="inline-flex items-center gap-1"><Users aria-hidden="true" className="h-3 w-3" />{peopleCount} people</span>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5 text-sm">
          <span className="text-slate-500">View projects or update contacts.</span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <Link href={`/people?client=${client.id}`} className="font-semibold text-slate-500 hover:text-slate-700">Manage contacts</Link>
            <Link href={`/projects?client=${client.id}`} className="font-semibold text-cyan-700 hover:text-cyan-600">View projects</Link>
          </div>
        </div>
      </article>
    );
  }

  if (!clients.length) return (
    <div className="rounded-[28px] border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm sm:p-12">
      <Building2Icon aria-hidden="true" className="mx-auto mb-4 h-10 w-10 text-slate-300" />
      <h3 className="text-xl font-semibold text-slate-950">No clients yet</h3>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{canManageClients ? "Add your first client to keep their projects and billing details together." : "Ask a workspace owner or manager to add clients. You can view their projects and contacts here."}</p>
    </div>
  );

  const archivedClients = clients.filter(client => client.status === "archived");
  return (
    <div className="space-y-6">
      {feedback && <p ref={feedbackRef} tabIndex={-1} role={feedback.type === "error" ? "alert" : "status"} className={`rounded-2xl border px-4 py-3 text-sm ${feedback.type === "error" ? "border-rose-200 bg-rose-50 text-rose-700" : "border-cyan-200 bg-cyan-50 text-cyan-800"}`}>{feedback.text}</p>}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{clients.filter(client => client.status === "active").map(renderClient)}</div>
      {archivedClients.length > 0 && <section className="space-y-4 border-t border-slate-200 pt-6"><h2 className="text-lg font-semibold text-slate-700">Archived clients</h2><div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{archivedClients.map(renderClient)}</div></section>}
    </div>
  );
}
