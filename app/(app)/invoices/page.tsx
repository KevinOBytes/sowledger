"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, DollarSign, Download, FileText, Receipt, RefreshCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import {
  AppEmptyState,
  AppMetricCard,
  AppPageHeader,
  AppPageShell,
  AppWorkflowRail,
} from "@/components/app-page-shell";

type InvoiceRecord = {
  id: string;
  number: string;
  projectName: string;
  amount: number;
  status: string;
  dueDate?: string;
  createdAt: string;
};

type BillableEntry = {
  id: string;
  userEmail: string;
  projectName: string;
  description: string;
  startedAt: string;
  durationSeconds: number;
  hourlyRate: number;
  amount: number;
};

type ProofPack = {
  invoice?: Partial<InvoiceRecord>;
  totals?: {
    plannedSeconds?: number;
    actualSeconds?: number;
    auditEventCount?: number;
  };
  sourceMix?: Record<string, unknown> | { source?: string; label?: string; seconds?: number; hours?: number; count?: number }[];
  entries?: unknown[];
  plannedSeconds?: number;
  actualSeconds?: number;
  auditEvents?: unknown[];
};

type ProofPackState = {
  invoiceId: string;
  loading: boolean;
  error?: string;
  digest?: string;
  proofPack?: ProofPack;
};

function formatHours(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "0.0h";
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatSourceMix(sourceMix: ProofPack["sourceMix"]) {
  if (!sourceMix) return [];
  if (Array.isArray(sourceMix)) {
    return sourceMix.map((source, index) => ({
      label: source.label || source.source || `Source ${index + 1}`,
      value: source.seconds != null ? formatHours(source.seconds) : source.hours != null ? `${source.hours.toFixed(1)}h` : `${source.count ?? 0}`,
    }));
  }
  return Object.entries(sourceMix).map(([label, value]) => ({
    label,
    value: typeof value === "number" ? `${value}` : String(value ?? "0"),
  }));
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [billables, setBillables] = useState<BillableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [requiresUpgrade, setRequiresUpgrade] = useState(false);
  const [proofPackState, setProofPackState] = useState<ProofPackState | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [quickBooksConnected, setQuickBooksConnected] = useState(false);
  const [pushingInvoiceId, setPushingInvoiceId] = useState<string | null>(null);
  const generatingInvoiceRef = useRef(false);
  const billableAmount = useMemo(() => billables.reduce((sum, entry) => sum + entry.amount, 0), [billables]);
  const selectedAmount = useMemo(
    () => billables.reduce((sum, entry) => selectedEntries.has(entry.id) ? sum + entry.amount : sum, 0),
    [billables, selectedEntries],
  );
  const invoiceAmount = useMemo(() => invoices.reduce((sum, invoice) => sum + invoice.amount, 0), [invoices]);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    try {
      const res = await fetch("/api/invoices");
      if (res.ok) {
        const data = await res.json();
        setInvoices(data.invoices || []);
        setBillables(data.billableEntries || []);
      } else if (res.status === 402) {
        setRequiresUpgrade(true);
      }
      const integrationsRes = await fetch("/api/integrations").catch(() => null);
      if (integrationsRes?.ok) {
        const integrations = await integrationsRes.json() as { connections?: Array<{ provider: string; status: string }> };
        setQuickBooksConnected(Boolean(integrations.connections?.some((connection) => connection.provider === "quickbooks" && connection.status === "connected")));
      }
    } catch {
      // The visible page state stays useful; toast noise here would repeat on refresh.
    } finally {
      setLoading(false);
    }
  }

  function toggleSelection(id: string) {
    const updated = new Set(selectedEntries);
    if (updated.has(id)) updated.delete(id);
    else updated.add(id);
    setSelectedEntries(updated);
  }

  async function handleGenerateInvoice() {
    if (generatingInvoiceRef.current || selectedEntries.size === 0) return;
    generatingInvoiceRef.current = true;
    setGeneratingInvoice(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryIds: Array.from(selectedEntries) }),
      });
      if (res.ok) {
        setSelectedEntries(new Set());
        await fetchData();
        toast.success("Invoice generated");
      } else {
        const data = await res.json();
        toast.error("Could not generate invoice", { description: data.error });
      }
    } catch {
      toast.error("Could not generate invoice");
    } finally {
      generatingInvoiceRef.current = false;
      setGeneratingInvoice(false);
    }
  }

  async function openProofPack(invoiceId: string) {
    setProofPackState({ invoiceId, loading: true });
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/proof-pack`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || "Unable to load proof pack");
      setProofPackState({
        invoiceId,
        loading: false,
        digest: data.digest || res.headers.get("x-sowledger-proof-sha256") || undefined,
        proofPack: data.proofPack || {},
      });
    } catch (error) {
      setProofPackState({
        invoiceId,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load proof pack",
      });
    }
  }

  async function pushToQuickBooks(invoiceId: string) {
    setPushingInvoiceId(invoiceId);
    try {
      const res = await fetch("/api/integrations/quickbooks/push-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data = await res.json().catch(() => ({})) as { error?: string; result?: { externalId?: string; reused?: boolean } };
      if (!res.ok) throw new Error(data.error || "Could not push invoice");
      toast.success(data.result?.reused ? "Invoice already linked to QuickBooks" : "Invoice pushed to QuickBooks", {
        description: data.result?.externalId ? `QuickBooks invoice ID: ${data.result.externalId}` : undefined,
      });
    } catch (error) {
      toast.error("QuickBooks push failed", { description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setPushingInvoiceId(null);
    }
  }

  if (loading) {
    return (
      <AppPageShell contentClassName="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500" />
          <p>Tallying financials...</p>
        </div>
      </AppPageShell>
    );
  }

  if (requiresUpgrade) {
    return (
      <AppPageShell width="standard">
        <AppPageHeader
          eyebrow="Output"
          title="Invoicing"
          description="Turn approved billable time into invoice records, then print or export supporting detail."
          icon={Receipt}
          metadata={[{ label: "Starter plan required", tone: "cyan", icon: ShieldCheck }]}
        />
        <AppWorkflowRail current="approve" />
        <AppEmptyState
          icon={Receipt}
          title="Invoicing is a Starter feature"
          description="Move to Starter for $9/workspace/month to turn approved billable time into invoices and exports."
          action={(
            <a href="/settings/billing" className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500">
              Move to Starter
            </a>
          )}
        />
      </AppPageShell>
    );
  }

  return (
    <AppPageShell>
      <AppPageHeader
        eyebrow="Output"
        title="Invoicing"
        description="Turn approved billable time into invoice records, then print or export supporting detail."
        icon={Receipt}
        metadata={[
          { label: `${billables.length} billable`, tone: "cyan", icon: DollarSign },
          { label: `${invoices.length} issued`, tone: "slate", icon: FileText },
        ]}
        primaryAction={(
          <button
            onClick={handleGenerateInvoice}
            disabled={generatingInvoice || selectedEntries.size === 0}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Receipt className="h-4 w-4" />
            {generatingInvoice ? "Generating invoice..." : `Generate invoice (${selectedEntries.size})`}
          </button>
        )}
      />

      <AppWorkflowRail current="approve" />

      <section className="grid gap-4 sm:grid-cols-3">
        <AppMetricCard label="Approved billables" value={billables.length} detail={`$${billableAmount.toFixed(2)} awaiting invoice.`} accent="emerald" icon={DollarSign} />
        <AppMetricCard label="Selected for invoice" value={selectedEntries.size} detail={`$${selectedAmount.toFixed(2)} selected.`} accent={selectedEntries.size > 0 ? "cyan" : "slate"} icon={Receipt} />
        <AppMetricCard label="Issued invoices" value={invoices.length} detail={`$${invoiceAmount.toFixed(2)} total issued.`} accent="slate" icon={FileText} />
      </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Approved Billables Pipeline
            </h2>
            <p className="mt-2 text-sm text-slate-500">Select approved entries to create the next invoice.</p>
            <div className="mt-5 space-y-3">
              {billables.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  <DollarSign className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                  <p className="font-semibold text-slate-700">No approved billables awaiting invoice.</p>
                  <p className="mt-1">Approve submitted time first, then select billables here to generate the next invoice.</p>
                </div>
              ) : billables.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => toggleSelection(entry.id)}
                  className={`w-full rounded-3xl border p-4 text-left transition ${selectedEntries.has(entry.id) ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-slate-50 hover:border-cyan-200 hover:bg-cyan-50/50"}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-950">{entry.projectName}</p>
                      <p className="mt-1 text-xs text-slate-500">{entry.description || "No description provided"}</p>
                      <p className="mt-2 text-xs text-slate-400">{entry.userEmail}</p>
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <p className="font-bold text-emerald-700">${entry.amount.toFixed(2)}</p>
                      <p className="text-xs text-slate-500">{(entry.durationSeconds / 3600).toFixed(1)} hrs x ${entry.hourlyRate}/hr</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <FileText className="h-5 w-5 text-cyan-700" />
              Issued invoices
            </h2>
            <p className="mt-2 text-sm text-slate-500">Open approval-ready proof packs with source mix, audit events, and digest integrity.</p>
            <div className="mt-5 space-y-3">
              {invoices.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                  <p className="font-semibold text-slate-700">No invoices generated yet.</p>
                  <p className="mt-1">Approved billables will become proof packs once invoiced.</p>
                </div>
              ) : invoices.map((invoice) => (
                <article key={invoice.id} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-950">{invoice.number}</span>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{invoice.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Amount due: <span className="font-semibold text-slate-950">${invoice.amount.toFixed(2)}</span></p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button onClick={() => openProofPack(invoice.id)} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800">
                      <ShieldCheck className="h-4 w-4" />
                      Open proof pack
                    </button>
                    <button onClick={() => window.print()} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                      <Download className="h-4 w-4" />
                      Print
                    </button>
                    {quickBooksConnected ? (
                      <button onClick={() => void pushToQuickBooks(invoice.id)} disabled={pushingInvoiceId === invoice.id} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">
                        <RefreshCcw className={`h-4 w-4 ${pushingInvoiceId === invoice.id ? "animate-spin" : ""}`} />
                        {pushingInvoiceId === invoice.id ? "Pushing..." : "Push QuickBooks"}
                      </button>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              {!proofPackState ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-slate-500">
                  <ShieldCheck className="mb-3 h-8 w-8 text-slate-400" />
                  Select an issued invoice to inspect its proof pack.
                </div>
              ) : proofPackState.loading ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-slate-500">
                  <div className="mb-3 h-7 w-7 animate-spin rounded-full border-b-2 border-t-2 border-cyan-600" />
                  Building proof pack...
                </div>
              ) : proofPackState.error ? (
                <div className="flex items-start gap-3 rounded-2xl border border-rose-200 bg-white p-4 text-sm text-rose-700">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-bold">Proof pack unavailable</p>
                    <p className="mt-1 text-rose-600">{proofPackState.error}</p>
                  </div>
                </div>
              ) : (
                <ProofPackSummary state={proofPackState} />
              )}
            </div>
          </div>
        </section>
    </AppPageShell>
  );
}

function ProofPackSummary({ state }: { state: ProofPackState }) {
  const proofPack = state.proofPack || {};
  const invoiceNumber = proofPack.invoice?.number;
  const sourceMix = formatSourceMix(proofPack.sourceMix);
  const plannedSeconds = proofPack.totals?.plannedSeconds ?? proofPack.plannedSeconds;
  const actualSeconds = proofPack.totals?.actualSeconds ?? proofPack.actualSeconds;
  const auditEventCount = proofPack.totals?.auditEventCount ?? proofPack.auditEvents?.length ?? 0;
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-700">Proof pack</p>
        <h3 className="mt-1 text-lg font-semibold text-slate-950">{invoiceNumber || "Invoice evidence"}</h3>
        <p className="mt-1 break-all rounded-2xl bg-white px-3 py-2 font-mono text-xs text-slate-500">
          Digest: {state.digest || "Digest pending from API"}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Entries</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{proofPack.entries?.length ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Audit events</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{auditEventCount}</p>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Planned</p>
          <p className="mt-1 text-2xl font-semibold text-cyan-700">{formatHours(plannedSeconds)}</p>
        </div>
        <div className="rounded-2xl bg-white p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Actual</p>
          <p className="mt-1 text-2xl font-semibold text-emerald-700">{formatHours(actualSeconds)}</p>
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4">
        <p className="text-sm font-bold text-slate-950">Source mix</p>
        {sourceMix.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No source mix returned yet.</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {sourceMix.map((source) => (
              <span key={source.label} className="rounded-full border border-cyan-100 bg-cyan-50 px-3 py-1 text-xs font-bold text-cyan-800">
                {source.label}: {source.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
