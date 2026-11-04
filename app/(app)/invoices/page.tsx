"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, DollarSign, Download, FileText, Receipt, RefreshCcw, ShieldCheck } from "lucide-react";
import type { InvoiceProofPack } from "@/lib/invoice-proof-pack";
import { ModalDialog } from "@/components/modal-dialog";
import { formatInvoiceCents, sumDisplayCents } from "@/lib/invoice-amount";
import { invoiceGroupKey, invoiceHistoryCents, invoiceSelectionCents, readCreatedInvoice, readInvoiceList, reconcileInvoiceSelection, type BillableEntry, type InvoiceRecord, type InvoiceHistoryRecord } from "@/lib/invoice-client-state";

import {
  AppEmptyState,
  AppMetricCard,
  AppPageHeader,
  AppPageShell,
  AppWorkflowRail,
} from "@/components/app-page-shell";

type ProofPack = {
  invoice?: Partial<InvoiceRecord>;
  totals?: {
    plannedSeconds?: number;
    actualSeconds?: number;
    auditEventCount?: number;
  };
  sourceMix?: Record<string, unknown> | { source?: string; label?: string; seconds?: number; hours?: number; count?: number }[];
  entries?: InvoiceProofPack["entries"];
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
  approval?: { digest: string; signedOffAt: string; current: boolean } | null;
};

function formatHours(seconds?: number) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return "0.0h";
  return `${(seconds / 3600).toFixed(1)}h`;
}

// Approximate billable-line presentation only: never used for money or proof.
function formatBillableDuration(seconds: number | null | undefined) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return "Time unavailable";
  if (seconds === 0) return "0 sec";
  if (seconds < 1) return "<1 sec";
  if (seconds < 60) return `${Number(seconds.toFixed(2))} sec`;
  if (seconds < 3600) return `${Number((seconds / 60).toFixed(1))} min`;
  return `${Number((seconds / 3600).toFixed(1))} hr`;
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

const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));

// PATCH returns a raw saved row, without GET's derived billing audience. Confirm
// the complete core record before retaining that audience and changing status.
function confirmedStatus(value: unknown, invoice: InvoiceRecord, status: "sent" | "paid") {
  if (!record(value) || value.ok !== true || !record(value.invoice)) return false;
  const saved = value.invoice;
  return saved.id === invoice.id && saved.workspaceId === invoice.workspaceId && saved.status === status
    && saved.number === invoice.number && saved.amount === invoice.amount && saved.dueDate === invoice.dueDate
    && saved.createdAt === invoice.createdAt && (saved.projectId === null || typeof saved.projectId === "string")
    && saved.projectId === (invoice as InvoiceRecord & { projectId?: unknown }).projectId
    && JSON.stringify(saved.timeEntryIds) === JSON.stringify(invoice.timeEntryIds);
}

export default function InvoicesPage() {
  const [invoices, setInvoices] = useState<InvoiceHistoryRecord[]>([]);
  const [billables, setBillables] = useState<BillableEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [requiresUpgrade, setRequiresUpgrade] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [updatingInvoiceId, setUpdatingInvoiceId] = useState<string | null>(null);
  const [proofPackState, setProofPackState] = useState<ProofPackState | null>(null);
  const [generatingInvoice, setGeneratingInvoice] = useState(false);
  const [quickBooksConnected, setQuickBooksConnected] = useState(false);
  const [pushingInvoiceId, setPushingInvoiceId] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null);
  const [creationNotice, setCreationNotice] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<InvoiceHistoryRecord | null>(null);
  const [voidConfirmed, setVoidConfirmed] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState<string | null>(null);
  const [voidPending, setVoidPending] = useState(false);
  const voidOpener = useRef<HTMLButtonElement | null>(null);
  const voidCheckbox = useRef<HTMLInputElement | null>(null);
  const generatingInvoiceRef = useRef(false);
  const selectedRef = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const refreshingRef = useRef(false);
  const invoiceActionRef = useRef(false);
  const selectedProofRef = useRef<string | null>(null);
  const proofGeneration = useRef(0);
  const canManageRef = useRef(false);
  const currentHistory = useRef<{ workspaceId: string | null; invoices: InvoiceHistoryRecord[] }>({ workspaceId: null, invoices: [] });
  const billableAmount = useMemo(() => sumDisplayCents(billables.filter(entry => entry.eligible).map(entry => entry.amountCents)), [billables]);
  const selectedAmount = useMemo(() => invoiceSelectionCents(selectedEntries, billables), [billables, selectedEntries]);
  const invoiceAmount = useMemo(() => invoiceHistoryCents(invoices), [invoices]);
  const selectedGroup = billables.find(entry => selectedEntries.has(entry.id));

  const setSelection = useCallback((next: Set<string>) => { selectedRef.current = next; setSelectedEntries(next); }, []);

  const fetchData = useCallback(async (afterCreate = false) => {
    if (invoiceActionRef.current || generatingInvoiceRef.current && !afterCreate) return false;
    const generation = ++loadGeneration.current;
    refreshingRef.current = true;
    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/invoices");
      const data: unknown = await res.json();
      if (generation !== loadGeneration.current) return false;
      if (res.ok) {
        const snapshot = readInvoiceList(data);
        canManageRef.current = snapshot.canManage;
        const selectedProof = selectedProofRef.current;
        if (!snapshot.canManage || selectedProof && (currentHistory.current.workspaceId !== snapshot.workspaceId || !snapshot.invoices.some(invoice => invoice.id === selectedProof && !invoice.historyIssue && invoice.status !== "void"))) {
          proofGeneration.current++;
          selectedProofRef.current = null;
          setProofPackState(null);
        }
        currentHistory.current = { workspaceId: snapshot.workspaceId, invoices: snapshot.invoices };
        setInvoices(snapshot.invoices);
        setBillables(snapshot.billableEntries);
        setCanManage(snapshot.canManage);
        setWorkspaceId(snapshot.workspaceId);
        setRequiresUpgrade(false);
        setHasLoaded(true);
        setNeedsRefresh(false);
        const next = reconcileInvoiceSelection(selectedRef.current, snapshot.billableEntries);
        if (next.size !== selectedRef.current.size || [...next].some(id => !selectedRef.current.has(id))) setSelectionNotice("Your selection changed after refresh. Unavailable entries were removed and one compatible billing group was kept. Review it before creating an invoice.");
        setSelection(next);
      } else if (res.status === 402 && data && typeof data === "object" && "requiresUpgrade" in data && data.requiresUpgrade === true) {
        setRequiresUpgrade(true);
      } else {
        throw new Error();
      }
      // Integration discovery is auxiliary; it cannot turn an invoice refresh
      // into failure or let an older response replace current invoice state.
      void fetch("/api/integrations").then(async response => {
        if (!response.ok) return;
        const integrations = await response.json() as { connections?: Array<{ provider: string; status: string }> };
        if (generation === loadGeneration.current && Array.isArray(integrations.connections)) setQuickBooksConnected(integrations.connections.some(connection => connection.provider === "quickbooks" && connection.status === "connected"));
      }).catch(() => undefined);
      return true;
    } catch {
      if (generation === loadGeneration.current) setError(afterCreate ? "Draft invoice created, but the list could not refresh. Refresh invoices before selecting more time." : "Could not load invoices. Your last list and selection have been kept. Please try again.");
      return false;
    } finally {
      if (generation === loadGeneration.current) { refreshingRef.current = false; setRefreshing(false); setLoading(false); }
    }
  }, [setSelection]);

  useEffect(() => {
    const pendingReads = loadGeneration;
    const pendingProofs = proofGeneration;
    // Mount starts external I/O; the generation guard fences abandoned responses.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchData();
    return () => { pendingReads.current++; pendingProofs.current++; };
  }, [fetchData]);

  async function updateInvoiceStatus(invoice: InvoiceRecord, status: "sent" | "paid") {
    const current = currentHistory.current.invoices.find(item => item.id === invoice.id && item.workspaceId === invoice.workspaceId);
    if (!current || current.historyIssue) return;
    if (!canManage || invoiceActionRef.current || refreshingRef.current || generatingInvoiceRef.current || invoice.status !== (status === "sent" ? "draft" : "sent")) return;
    invoiceActionRef.current = true;
    const message = status === "sent" ? invoice.billingAudience === "internal" ? "Mark this internal invoice as sent? It is not shared in the client portal. SOWLedger does not email it; send it separately if needed." : "Mark this invoice as sent? SOWLedger does not email it; send it separately. Client portal access depends on the verified client associated with every linked entry." : "Mark this invoice as paid? Only do this after you have received payment outside SOWLedger. This records an acknowledgement; it does not process a payment.";
    if (!window.confirm(message)) { invoiceActionRef.current = false; return; }
    setUpdatingInvoiceId(invoice.id);
    setActionFeedback({ error: false, message: "Saving invoice status..." });
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
      const data: unknown = await res.json();
      if (!res.ok || !confirmedStatus(data, invoice, status)) throw new Error();
      loadGeneration.current++;
      currentHistory.current = { ...currentHistory.current, invoices: currentHistory.current.invoices.map(item => item.id === invoice.id ? { ...item, status } : item) };
      setInvoices((current) => current.map((item) => item.id === invoice.id ? { ...item, status } : item));
      setActionFeedback({ error: false, message: status === "sent" ? "Invoice marked as sent. SOWLedger has not emailed it." : "Invoice marked as paid. External payment acknowledged; no payment was processed." });
      if (selectedProofRef.current === invoice.id) await openProofPack(invoice.id);
    } catch { setActionFeedback({ error: true, message: "We could not confirm the invoice status update. Your last displayed record has been kept. Refresh invoices to check the saved status before trying again." }); }
    finally { invoiceActionRef.current = false; setUpdatingInvoiceId(null); }
  }

  function toggleSelection(id: string) {
    if (invoiceActionRef.current || generatingInvoiceRef.current || refreshingRef.current || !canManage) return;
    const updated = new Set(selectedRef.current);
    if (updated.has(id)) updated.delete(id);
    else {
      const entry = billables.find(entry => entry.id === id);
      const first = billables.find(entry => updated.has(entry.id));
      if (!entry?.eligible || updated.size >= 100 || first && invoiceGroupKey(first) !== invoiceGroupKey(entry)) return;
      updated.add(id);
    }
    setSelection(updated);
  }

  async function handleGenerateInvoice() {
    const ids = [...selectedRef.current];
    const expectedTotal = invoiceSelectionCents(selectedRef.current, billables);
    const group = billables.find(entry => selectedRef.current.has(entry.id));
    if (invoiceActionRef.current || generatingInvoiceRef.current || refreshingRef.current || !canManage || !workspaceId || !group || ids.length === 0 || ids.length > 100 || expectedTotal === null) return;
    generatingInvoiceRef.current = true;
    loadGeneration.current++;
    setGeneratingInvoice(true);
    setError(null);
    setCreationNotice(null);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timeEntryIds: ids }),
      });
      const data: unknown = await res.json();
      if (!res.ok) {
        if (res.status === 422 && data && typeof data === "object" && "code" in data && data.code === "INVOICE_AMOUNT_NOT_REPRESENTABLE") {
          setError("This total cannot be stored without changing a cent. No invoice was created and your time remains approved. Choose a smaller selection or contact your workspace administrator.");
          return;
        }
        throw new Error();
      }
      const created = readCreatedInvoice(data, { workspaceId, ids, amountCents: expectedTotal, group, existingIds: invoices.map(invoice => invoice.id) });
      currentHistory.current = { workspaceId, invoices: [created, ...currentHistory.current.invoices] };
      setSelection(new Set());
      setNeedsRefresh(true);
      // Remove consumed entries immediately, even if the confirmed save's refresh fails.
      setBillables(current => current.filter(entry => !ids.includes(entry.id)));
      setInvoices(current => [created, ...current]);
      setCreationNotice(created.billingAudience === "internal" ? "Draft invoice created. Internal — not shared in the client portal." : "Draft invoice created. Review the draft before sending it.");
      await fetchData(true);
    } catch {
      setError("We could not confirm the invoice was saved. Your selection has been kept. Refresh invoices and check the history before trying again.");
    } finally {
      generatingInvoiceRef.current = false;
      setGeneratingInvoice(false);
    }
  }

  async function openProofPack(invoiceId: string) {
    // Read the latest accepted capability even for a stale click handler.
    if (!canManageRef.current) return;
    const invoice = currentHistory.current.invoices.find(item => item.id === invoiceId);
    if (!invoice || invoice.historyIssue || invoice.status === "void") return;
    const generation = ++proofGeneration.current;
    selectedProofRef.current = invoiceId;
    setProofPackState({ invoiceId, loading: true });
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/${invoice.status === "draft" ? "preview" : "proof-pack"}`);
      const data = await res.json().catch(() => ({}));
      if (!canManageRef.current || generation !== proofGeneration.current) return;
      if (!res.ok || data.ok !== true || data.proofPack?.invoice?.id !== invoiceId || typeof data.digest !== "string" || !/^[a-f0-9]{64}$/.test(data.digest)) throw new Error("Could not confirm the invoice details. Please try again.");
      setProofPackState({
        invoiceId,
        loading: false,
        digest: data.digest || res.headers.get("x-sowledger-proof-sha256") || undefined,
        proofPack: data.proofPack || {},
        approval: data.approval ?? null,
      });
    } catch (error) {
      if (!canManageRef.current || generation !== proofGeneration.current) return;
      setProofPackState({
        invoiceId,
        loading: false,
        error: error instanceof Error ? error.message : "Unable to load proof pack",
      });
    }
  }

  async function confirmVoid() {
    if (!voiding || !voidConfirmed || invoiceActionRef.current || refreshingRef.current || generatingInvoiceRef.current || !canManageRef.current) return;
    const current = currentHistory.current.invoices.find(row => row.id === voiding.id && row.workspaceId === voiding.workspaceId);
    if (!current || current.status !== "draft" || current.voidEligibility?.eligible !== true) return;
    invoiceActionRef.current = true;
    setVoidPending(true); setVoidError(null);
    try {
      const response = await fetch(`/api/invoices/${current.id}/void`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmNotBilledElsewhere: true, reason: voidReason }) });
      const data: unknown = await response.json();
      if (!response.ok) throw new Error(record(data) && typeof data.error === "string" ? data.error : "Could not confirm the correction. Refresh invoices before trying again.");
      if (!record(data) || data.ok !== true || !record(data.invoice) || data.invoice.id !== current.id || data.invoice.workspaceId !== current.workspaceId || data.invoice.status !== "void") throw new Error("Could not confirm the correction. Refresh invoices before trying again.");
      proofGeneration.current++; selectedProofRef.current = null; setProofPackState(null);
      loadGeneration.current++;
      setNeedsRefresh(true);
      setVoiding(null);
      invoiceActionRef.current = false;
      const refreshed = await fetchData();
      setActionFeedback({ error: !refreshed, message: refreshed ? "Invoice voided. Its time is Approved again; invoice history was preserved. Nothing was canceled in QuickBooks." : "Invoice voided, but the list could not refresh. Refresh invoices before selecting more time." });
    } catch (error) {
      setVoidError(error instanceof Error ? error.message : "Could not confirm the correction. Refresh invoices before trying again.");
    } finally { invoiceActionRef.current = false; setVoidPending(false); }
  }

  async function pushToQuickBooks(invoiceId: string) {
    const invoice = currentHistory.current.invoices.find(item => item.id === invoiceId);
    if (invoice?.historyIssue) return;
    if (!canManage || !quickBooksConnected || !invoice || (invoice.status !== "sent" && invoice.status !== "paid") || invoiceActionRef.current || refreshingRef.current || generatingInvoiceRef.current) return;
    invoiceActionRef.current = true;
    if (!window.confirm("Push this invoice to QuickBooks? This may create an external invoice. If the result cannot be confirmed, check QuickBooks before retrying to avoid a duplicate.")) { invoiceActionRef.current = false; return; }
    setPushingInvoiceId(invoiceId);
    setActionFeedback({ error: false, message: "Waiting for QuickBooks confirmation..." });
    try {
      const res = await fetch("/api/integrations/quickbooks/push-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId }),
      });
      const data: unknown = await res.json();
      if (!res.ok || !record(data) || data.ok !== true || !record(data.result) || typeof data.result.externalId !== "string" || !data.result.externalId.trim() || typeof data.result.reused !== "boolean") throw new Error();
      setActionFeedback({ error: false, message: `${data.result.reused ? "Invoice already linked to QuickBooks" : "Invoice linked to QuickBooks"}. QuickBooks invoice ID: ${data.result.externalId}` });
    } catch {
      setActionFeedback({ error: true, message: "We could not confirm the QuickBooks push. An external invoice may have been created. Check QuickBooks before retrying to avoid a duplicate; no automatic retry was made." });
    } finally {
      invoiceActionRef.current = false;
      setPushingInvoiceId(null);
    }
  }

  if (loading) {
    return (
      <AppPageShell contentClassName="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center">
          <div className="mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-t-2 border-cyan-500" />
          <p>Loading invoices...</p>
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
          description="Upgrade to Starter to create invoices from approved billable time."
          action={(
            <a href="/settings/billing" className="inline-flex rounded-xl bg-cyan-600 px-6 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-cyan-500">
              Move to Starter
            </a>
          )}
        />
      </AppPageShell>
    );
  }

  if (!hasLoaded) return <AppPageShell><AppPageHeader eyebrow="Output" title="Invoicing" description="Review approved time and invoice history." icon={Receipt} /><div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error ?? "Could not load invoices."}<button disabled={refreshing} onClick={() => void fetchData()} className="ml-3 font-bold underline">Retry loading invoices</button></div></AppPageShell>;

  return (
    <AppPageShell>
      <AppPageHeader
        eyebrow="Output"
        title="Invoicing"
        description="Create a draft from approved time, print it for your client, and record when it has been sent or paid."
        icon={Receipt}
        metadata={[
          { label: `${billables.length} billable`, tone: "cyan", icon: DollarSign },
          { label: `${invoices.length} ${invoices.length === 1 ? "invoice" : "invoices"}`, tone: "slate", icon: FileText },
        ]}
        primaryAction={(
          <button
            onClick={handleGenerateInvoice}
            disabled={!canManage || Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing || needsRefresh || selectedEntries.size === 0 || selectedAmount === null}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <Receipt className="h-4 w-4" />
            {generatingInvoice ? "Creating draft..." : `Create draft invoice (${selectedEntries.size})`}
          </button>
        )}
      />

      <AppWorkflowRail current="approve" />
      {error && <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{error}</div>}
      {creationNotice && <p role="status" className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900">{creationNotice}</p>}
      {selectionNotice && <p role="status" className="rounded-2xl bg-cyan-50 p-4 text-sm text-cyan-900">{selectionNotice}</p>}
      <button disabled={Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing} onClick={() => void fetchData()} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"><RefreshCcw className="h-4 w-4" />{refreshing ? "Refreshing invoices..." : "Refresh invoices"}</button>
      {actionFeedback && <div role={actionFeedback.error ? "alert" : "status"} className={`break-words rounded-2xl border p-4 text-sm ${actionFeedback.error ? "border-rose-200 bg-rose-50 text-rose-800" : "border-cyan-200 bg-cyan-50 text-cyan-900"}`}>{actionFeedback.message}</div>}
      <p className="text-sm text-slate-500">SOWLedger does not email invoices or process payments. Send the printed invoice yourself, then update its status.{!canManage && " A manager or owner must create invoices and update their status."}</p>
      {!canManage && <p className="text-sm text-slate-500">Full invoice proof packs and printouts are available to workspace owners and managers.</p>}

      <section className="grid gap-4 sm:grid-cols-3">
        <AppMetricCard label="Approved billables" value={billables.filter(entry => entry.eligible).length} detail={`${formatInvoiceCents(billableAmount)} awaiting invoice.`} accent="emerald" icon={DollarSign} />
        <AppMetricCard label="Selected for invoice" value={selectedEntries.size} detail={`${formatInvoiceCents(selectedAmount)} selected.`} accent={selectedEntries.size > 0 ? "cyan" : "slate"} icon={Receipt} />
        <AppMetricCard label="Active invoices" value={invoices.filter(invoice => invoice.status !== "void").length} detail={`${formatInvoiceCents(invoiceAmount)} across active invoices.`} accent="slate" icon={FileText} />
      </section>

        <section className="grid items-start gap-6 lg:grid-cols-2">
          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              Approved billable time
            </h2>
            <p className="mt-2 text-sm text-slate-500">Select up to 100 approved entries for one client, or select entirely internal time. Different clients and internal time cannot share an invoice.</p>
            {selectedGroup && <p className="mt-2 text-sm font-semibold text-cyan-800">{selectedGroup.billingAudience === "internal" ? "Internal — not shared in the client portal" : `Client: ${selectedGroup.clientName}`}</p>}
            {selectedEntries.size === 100 && <p role="status" className="mt-2 text-sm text-amber-800">100-entry limit reached. Deselect an entry to choose another.</p>}
            {selectedAmount === null && <p role="alert" className="mt-2 text-sm text-rose-800">Selected amount unavailable. Choose fewer entries or refresh the list.</p>}
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
                  disabled={!canManage || Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing || needsRefresh || !selectedEntries.has(entry.id) && (!entry.eligible || selectedEntries.size >= 100 || Boolean(selectedGroup && invoiceGroupKey(selectedGroup) !== invoiceGroupKey(entry)))}
                  aria-pressed={selectedEntries.has(entry.id)}
                  className={`w-full min-w-0 rounded-3xl border p-4 text-left transition disabled:cursor-not-allowed ${selectedEntries.has(entry.id) ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-slate-50 hover:border-cyan-200 hover:bg-cyan-50/50"}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-slate-950">{entry.projectName}</p>
                      <p className="mt-1 break-words text-xs text-slate-500">{entry.description || "No description provided"}</p>
                      <p className="mt-2 break-all text-xs text-slate-400">{entry.userEmail}</p>
                      <p className="mt-2 break-words text-xs text-slate-700">{entry.eligible ? entry.billingAudience === "internal" ? "Internal — not shared in the client portal" : `Client: ${entry.clientName} · Eligible` : `Not eligible: ${entry.ineligibleReason}`}</p>
                      {entry.eligible && !selectedEntries.has(entry.id) && selectedGroup && invoiceGroupKey(selectedGroup) !== invoiceGroupKey(entry) && <p className="mt-1 text-xs text-amber-800">Deselect the current billing group to choose this time.</p>}
                    </div>
                    <div className="shrink-0 sm:text-right">
                      <p className="break-all font-bold text-emerald-700">{formatInvoiceCents(entry.amountCents)}</p>
                      <p className="break-words text-xs text-slate-500">{formatBillableDuration(entry.durationSeconds)} × {entry.hourlyRate === null ? "Rate unavailable" : `$${entry.hourlyRate}/hr`}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-[32px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="flex items-center gap-2 text-xl font-semibold">
              <FileText className="h-5 w-5 text-cyan-700" />
              Invoice history
            </h2>
            <p className="mt-2 text-sm text-slate-500">Review the time and rates behind each saved total. Clients see their own sent or paid invoices in the portal. Internal invoices are not shared there.</p>
            {invoices.some(invoice => invoice.historyIssue) && <p className="mt-2 text-sm text-amber-800">Saved totals include invoices that need review.</p>}
            <div className="mt-5 space-y-3">
              {invoices.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
                  <FileText className="mx-auto mb-3 h-8 w-8 text-slate-400" />
                  <p className="font-semibold text-slate-700">No invoices generated yet.</p>
                  <p className="mt-1">Select approved time to create your first draft.</p>
                </div>
              ) : invoices.map((invoice) => (
                <article key={invoice.id} className="flex flex-col gap-3 rounded-3xl border border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 break-words">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-bold text-slate-950">{invoice.number}</span>
                      <span className="rounded-full bg-white px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-slate-500">{invoice.status}</span>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">Total: <span className="font-semibold text-slate-950">${invoice.amount.toFixed(2)}</span></p>
                    <p className="mt-1 text-xs text-slate-500">{invoice.billingAudience === "internal" ? "Internal — not shared in the client portal" : invoice.billingAudience === "client" ? `Client: ${invoice.clientName}` : "Client portal access requires verified linked time."}</p>
                    {invoice.historyIssue ? <div className="mt-3 space-y-2 text-sm text-amber-900">
                      <p>This saved invoice needs review. Some time entries are listed more than once. We haven&apos;t changed the invoice.</p>
                      <p>Actions are unavailable for this record here. Ask a workspace manager to review the saved time entries.</p>
                      <details className="break-all"><summary className="cursor-pointer font-semibold">Saved record details</summary><p className="mt-2">Invoice ID: <span>{invoice.id}</span></p><p>Original time entry IDs, in saved order:</p><ol className="list-inside list-decimal">{invoice.timeEntryIds.map((id, index) => <li key={index}>{id}</li>)}</ol></details>
                    </div> : canManage && invoice.status === "draft" && <p className="mt-1 text-xs text-slate-500">Review the draft before printing or marking it as sent. SOWLedger does not email the invoice.</p>}
                  </div>
                  {canManage && invoice.status === "draft" && invoice.voidEligibility?.eligible === false && <p className="text-xs text-amber-800">{invoice.voidEligibility.reason}</p>}
                  {canManage && !invoice.historyIssue && invoice.status !== "void" && <div className="flex flex-wrap gap-2">
                    <button onClick={() => openProofPack(invoice.id)} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800">
                      <ShieldCheck className="h-4 w-4" />
                      {invoice.status === "draft" ? "Review draft" : "Open proof pack"}
                    </button>
                    <a href={`/api/invoices/${invoice.id}/print`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 transition hover:border-cyan-200 hover:text-cyan-700">
                      <Download className="h-4 w-4" />
                      Print
                    </a>
                    {invoice.status === "draft" && invoice.voidEligibility?.eligible === true && <button disabled={Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing || voidPending} onClick={event => { if (invoiceActionRef.current || refreshingRef.current || generatingInvoiceRef.current) return; voidOpener.current = event.currentTarget; setVoiding(invoice); setVoidConfirmed(false); setVoidReason(""); setVoidError(null); }} className="inline-flex h-10 items-center justify-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-50">Void draft</button>}
                    {canManage && (invoice.status === "draft" || invoice.status === "sent") && <button disabled={Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing} onClick={() => void updateInvoiceStatus(invoice, invoice.status === "draft" ? "sent" : "paid")} className="inline-flex h-10 items-center justify-center rounded-2xl border border-cyan-200 bg-white px-4 text-sm font-bold text-cyan-800 disabled:opacity-50">{updatingInvoiceId === invoice.id ? "Saving..." : invoice.status === "draft" ? "Mark as sent" : "Mark as paid"}</button>}
                    {canManage && quickBooksConnected && (invoice.status === "sent" || invoice.status === "paid") ? (
                      <button onClick={() => void pushToQuickBooks(invoice.id)} disabled={Boolean(updatingInvoiceId || pushingInvoiceId) || generatingInvoice || refreshing} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-50">
                        <RefreshCcw className={`h-4 w-4 ${pushingInvoiceId === invoice.id ? "animate-spin" : ""}`} />
                        {pushingInvoiceId === invoice.id ? "Pushing..." : "Push QuickBooks"}
                      </button>
                    ) : null}
                  </div>}
                </article>
              ))}
            </div>

            {canManage && <div className="mt-5 rounded-3xl border border-slate-200 bg-slate-50 p-5">
              {!proofPackState ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-sm text-slate-500">
                  <ShieldCheck className="mb-3 h-8 w-8 text-slate-400" />
                  Select an invoice to review its supporting time entries.
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
                    <button onClick={() => void openProofPack(proofPackState.invoiceId)} className="mt-2 font-bold underline">Try again</button>
                  </div>
                </div>
              ) : (
                <ProofPackSummary state={proofPackState} />
              )}
            </div>}
          </div>
        </section>
      {voiding && <ModalDialog label="Void draft invoice" className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-3xl border border-slate-200 bg-white shadow-xl" onClose={() => { if (!invoiceActionRef.current) setVoiding(null); }} initialFocusRef={voidCheckbox} returnFocusRef={voidOpener}>
        <form className="space-y-4 overflow-y-auto p-6" onSubmit={event => { event.preventDefault(); void confirmVoid(); }}>
          <h2 className="text-xl font-semibold">Void draft invoice</h2>
          <p className="text-sm text-slate-600">{voiding.number}: this returns the time to Approved so you can correct it or create a new invoice. We&apos;ll keep this invoice and its history. This does not cancel anything in QuickBooks or elsewhere.</p>
          <label className="flex gap-3 text-sm font-medium"><input ref={voidCheckbox} type="checkbox" checked={voidConfirmed} disabled={voidPending} onChange={event => setVoidConfirmed(event.target.checked)} />I confirm this invoice has not been billed elsewhere.</label>
          <label className="block text-sm font-medium">Reason (optional)<textarea value={voidReason} onChange={event => setVoidReason(event.target.value)} maxLength={500} disabled={voidPending} className="mt-2 w-full rounded-xl border border-slate-200 p-3" /></label>
          {voidError && <p role="alert" className="text-sm text-rose-800">{voidError}</p>}
          <div className="flex justify-end gap-3"><button type="button" disabled={voidPending} onClick={() => setVoiding(null)} className="rounded-xl border border-slate-200 px-4 py-2 disabled:opacity-50">Cancel</button><button type="submit" disabled={!voidConfirmed || voidPending} className="rounded-xl bg-slate-950 px-4 py-2 font-semibold text-white disabled:opacity-50">{voidPending ? "Voiding..." : "Void invoice"}</button></div>
        </form>
      </ModalDialog>}
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
          Details SHA-256: {state.digest || "Unavailable"}
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
      {state.approval && <div className="rounded-2xl bg-emerald-50 p-4 text-sm text-emerald-900"><p className="font-semibold">{state.approval.current ? "Client approved this version" : "Client approved a previous version"} on {new Date(state.approval.signedOffAt).toLocaleDateString()}.</p><p className="mt-2 break-all font-mono text-xs">Approved SHA-256: {state.approval.digest}</p><a className="mt-2 inline-block underline" href={`/api/invoices/${state.invoiceId}/print?approved=true`} target="_blank" rel="noopener noreferrer">View approved version</a></div>}

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
      <div className="space-y-2">
        <h4 className="font-bold text-slate-950">Time entries</h4>
        {proofPack.entries?.map((entry) => <article key={entry.id} className="rounded-2xl bg-white p-4 text-sm"><p className="font-semibold">{entry.taskId}</p><p className="mt-1 text-slate-600">{entry.description || "No notes"}</p><p className="mt-2 text-slate-500">{entry.startedAt ? new Date(entry.startedAt).toLocaleDateString() : ""} · {entry.userEmail} · {entry.source}</p><p className="mt-2">{(entry.durationSeconds / 3600).toFixed(2)} hours × ${entry.hourlyRate?.toFixed(2) ?? "0.00"}/hour = <strong>${entry.amount.toFixed(2)}</strong></p></article>)}
      </div>
    </div>
  );
}
