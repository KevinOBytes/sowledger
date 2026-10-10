"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, Clock, FolderKanban, Receipt, ShieldCheck } from "lucide-react";
import type { InvoiceProofPack } from "@/lib/invoice-proof-pack";

type ProjectAggregate = { id: string; name: string; percentComplete: number; totalHours: number };
type InvoiceRecord = {
  id: string; number: string; projectName: string; amount: number; status: string;
  signedOffAt?: string | null; approvedDigest?: string | null; approvalCurrent?: boolean;
};
type Review = { loading: boolean; proofPack?: InvoiceProofPack; digest?: string; error?: string; checked?: boolean };

export default function ClientDashboard() {
  const [projects, setProjects] = useState<ProjectAggregate[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [signingInvoiceId, setSigningInvoiceId] = useState<string | null>(null);
  const [signoffErrors, setSignoffErrors] = useState<Record<string, string>>({});

  useEffect(() => { void fetchData(); }, []);
  async function fetchData() {
    setError(null);
    try {
      const response = await fetch("/api/client");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not load your projects and invoices.");
      setProjects(data.projects || []);
      setInvoices(data.invoices || []);
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load your projects and invoices."); }
    finally { setLoading(false); }
  }

  async function openReview(invoiceId: string) {
    setReviews((current) => ({ ...current, [invoiceId]: { loading: true } }));
    setSignoffErrors((current) => ({ ...current, [invoiceId]: "" }));
    try {
      const response = await fetch(`/api/invoices/${invoiceId}/proof-pack`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.proofPack || !data.digest) throw new Error(data.error || "Could not load invoice details.");
      setReviews((current) => ({ ...current, [invoiceId]: { loading: false, proofPack: data.proofPack, digest: data.digest, checked: false } }));
    } catch (error) { setReviews((current) => ({ ...current, [invoiceId]: { loading: false, error: error instanceof Error ? error.message : "Could not load invoice details." } })); }
  }

  async function approveProof(invoiceId: string) {
    const review = reviews[invoiceId];
    if (!review?.proofPack || !review.digest || !review.checked || signingInvoiceId) return;
    setSigningInvoiceId(invoiceId);
    setSignoffErrors((current) => ({ ...current, [invoiceId]: "" }));
    try {
      const response = await fetch("/api/client/signoff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId, digest: review.digest }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409) setReviews((current) => ({ ...current, [invoiceId]: { loading: false, error: "These details changed. Reload and review the latest version." } }));
        throw new Error(data.error || "Could not approve this version.");
      }
      setInvoices((current) => current.map((invoice) => invoice.id === invoiceId ? { ...invoice, signedOffAt: data.signoff.signedOffAt, approvedDigest: data.signoff.digest, approvalCurrent: true } : invoice));
    } catch (error) { setSignoffErrors((current) => ({ ...current, [invoiceId]: error instanceof Error ? error.message : "Could not approve this version." })); }
    finally { setSigningInvoiceId(null); }
  }

  if (loading) return <div className="flex h-64 items-center justify-center text-slate-500"><p>Loading your projects and invoices...</p></div>;

  return (
    <div className="space-y-8">
      <header className="rounded-[32px] border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-bold uppercase tracking-[0.25em] text-cyan-700">Client portal</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Projects and invoices</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Review the work, hours and rates behind each invoice before approving it. Your approval records the exact version you reviewed; it does not make a payment.</p>
      </header>
      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error} <button onClick={() => void fetchData()} className="ml-3 font-bold underline">Try again</button></div>}
      {!error && <>
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><FolderKanban className="h-5 w-5 text-cyan-700" />Projects</h2>
          {projects.length === 0 ? <p className="rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-slate-500">No projects have been shared with you yet. Ask your workspace contact to link your email to the right client.</p> : <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{projects.map((project) => (
            <article key={project.id} className="rounded-3xl border border-stone-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold">{project.name}</h3>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Clock className="h-4 w-4" />{project.totalHours.toFixed(1)} approved hours</p>
              <p className="mt-4 text-sm">Project progress: {project.percentComplete}%</p>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-cyan-600" style={{ width: `${Math.max(0, Math.min(100, project.percentComplete))}%` }} /></div>
            </article>
          ))}</div>}
        </section>
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><Receipt className="h-5 w-5 text-cyan-700" />Invoices to review</h2>
          {invoices.length === 0 ? <p className="rounded-3xl border border-dashed border-stone-300 bg-white p-8 text-slate-500">No invoices have been shared yet. They will appear here when your workspace contact marks them as sent.</p> : invoices.map((invoice) => {
            const review = reviews[invoice.id];
            const currentApproved = invoice.approvedDigest === review?.digest || (!review && invoice.approvalCurrent);
            return <article key={invoice.id} className="rounded-3xl border border-stone-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-bold">{invoice.number}</h3>
                  <p className="mt-1 text-sm text-slate-500">{invoice.projectName} · {invoice.status}</p>
                  <p className="mt-2 text-xl font-semibold">${invoice.amount.toFixed(2)}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => void openReview(invoice.id)} disabled={review?.loading} className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{review?.loading ? "Loading details..." : "Review invoice"}</button>
                  <a href={`/api/invoices/${invoice.id}/print`} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-stone-200 px-4 py-2 text-sm font-bold">Print invoice</a>
                </div>
              </div>
              {invoice.approvedDigest && <div className="mt-4 rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">
                <p className="flex items-center gap-2 font-semibold"><CheckCircle2 className="h-4 w-4" />{currentApproved ? "This version is approved" : "A previous version was approved"}{invoice.signedOffAt ? ` on ${new Date(invoice.signedOffAt).toLocaleDateString()}` : ""}</p>
                <p className="mt-1 break-all font-mono text-xs">Approved SHA-256: {invoice.approvedDigest}</p>
                <a className="mt-2 inline-block underline" href={`/api/invoices/${invoice.id}/print?approved=true`} target="_blank" rel="noopener noreferrer">View the approved version</a>
              </div>}
              {review?.error && <div role="alert" className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">{review.error} <button className="ml-2 font-bold underline" onClick={() => void openReview(invoice.id)}>Reload details</button></div>}
              {review?.proofPack && <div className="mt-6 space-y-4 border-t border-stone-200 pt-5">
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-600"><span>{review.proofPack.entries.length} entries</span><span>{review.proofPack.totals.actualHours.toFixed(2)} logged hours</span><span>{review.proofPack.totals.plannedHours.toFixed(2)} planned hours</span><span>Due: {review.proofPack.invoice.dueDate ? new Date(review.proofPack.invoice.dueDate).toLocaleDateString() : "Not set"}</span></div>
                <div className="grid gap-3 sm:grid-cols-2">{review.proofPack.entries.map((entry) => <div key={entry.id} className="rounded-2xl border border-stone-200 p-4 text-sm">
                  <p className="font-semibold">{entry.taskId}</p><p className="mt-1 whitespace-pre-wrap text-slate-600">{entry.description || "No notes"}</p>
                  <p className="mt-2 text-xs text-slate-500">{entry.projectName} · {entry.userEmail} · {entry.source}</p>
                  <p className="mt-1 text-xs text-slate-500">{entry.startedAt ? new Date(entry.startedAt).toLocaleString() : ""} – {entry.stoppedAt ? new Date(entry.stoppedAt).toLocaleString() : ""}</p>
                  <p className="mt-3">{(entry.durationSeconds / 3600).toFixed(2)} hours × ${entry.hourlyRate?.toFixed(2) ?? "0.00"}/hour = <strong>${entry.amount.toFixed(2)}</strong></p>
                </div>)}</div>
                <details className="rounded-2xl bg-slate-50 p-4 text-sm"><summary className="cursor-pointer font-semibold">Planned work and change history</summary><pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify({ plannedBlocks: review.proofPack.plannedBlocks, sourceMix: review.proofPack.sourceMix, auditEvents: review.proofPack.auditEvents }, null, 2)}</pre></details>
                <p className="break-all font-mono text-xs text-slate-500">Reviewed details SHA-256: {review.digest}</p>
                {!currentApproved && <div className="space-y-3">
                  <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={Boolean(review.checked)} onChange={(event) => setReviews((current) => ({ ...current, [invoice.id]: { ...current[invoice.id], checked: event.target.checked } }))} className="mt-1" />I have reviewed the entries, rates and total shown above.</label>
                  <button onClick={() => void approveProof(invoice.id)} disabled={!review.checked || Boolean(signingInvoiceId)} className="inline-flex items-center gap-2 rounded-xl bg-cyan-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{signingInvoiceId === invoice.id ? "Saving approval..." : "Approve this version"}</button>
                </div>}
              </div>}
              {signoffErrors[invoice.id] && <p role="alert" className="mt-3 flex items-start gap-2 text-sm text-rose-700"><AlertCircle className="h-4 w-4 shrink-0" />{signoffErrors[invoice.id]}</p>}
            </article>;
          })}
        </section>
      </>}
    </div>
  );
}
