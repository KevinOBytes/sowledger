"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BuildingIcon, ClockIcon, DollarSignIcon, PlusIcon, XIcon } from "lucide-react";

type ClientOption = { id: string; name: string };

export function CreateProjectButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [billingModel, setBillingModel] = useState<"hourly" | "fixed_fee">("hourly");
  const [budgetType, setBudgetType] = useState<"hours" | "fees" | "none">("none");
  const [budgetAmount, setBudgetAmount] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    fetch("/api/clients")
      .then((res) => res.json())
      .then((data) => setClients(data.clients ?? []))
      .catch(() => null);
  }, [isOpen]);

  function resetForm() {
    setName("");
    setClientId("");
    setBillingModel("hourly");
    setBudgetType("none");
    setBudgetAmount("");
    setStep(1);
    setError("");
  }

  function close() {
    setIsOpen(false);
    resetForm();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), clientId: clientId || undefined, billingModel, budgetType, budgetAmount: budgetAmount ? Number.parseFloat(budgetAmount) : undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create project");
      close();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button onClick={() => setIsOpen(true)} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800">
        <PlusIcon className="h-4 w-4" />
        New Project
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight">Create New Project</h2>
                <p className="text-sm text-slate-500">Step {step} of 2</p>
              </div>
              <button onClick={close} title="Close" aria-label="Close modal" className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XIcon className="h-5 w-5" /></button>
            </div>

            <form onSubmit={submit} className="space-y-6 p-6">
              {step === 1 ? (
                <>
                  <label htmlFor="projectName" className="block text-sm font-bold text-slate-700">Project Name<input id="projectName" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Website Redesign" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
                  <label className="block text-sm font-bold text-slate-700">Client <span className="font-normal text-slate-400">(Optional)</span><span className="relative mt-1 block"><BuildingIcon className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><select aria-label="Select Client" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full appearance-none rounded-2xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-4 text-sm outline-none transition focus:border-cyan-500 focus:bg-white"><option value="">No Client (Internal)</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></span></label>
                </>
              ) : (
                <>
                  <div>
                    <p className="mb-2 text-sm font-bold text-slate-700">Billing Model</p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <button type="button" onClick={() => setBillingModel("hourly")} className={`rounded-2xl border p-4 text-left transition ${billingModel === "hourly" ? "border-cyan-300 bg-cyan-50 text-cyan-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}><ClockIcon className="mb-2 h-5 w-5" /><p className="font-bold">Time & Materials</p><p className="text-xs">Bill by the hour</p></button>
                      <button type="button" onClick={() => setBillingModel("fixed_fee")} className={`rounded-2xl border p-4 text-left transition ${billingModel === "fixed_fee" ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-slate-200 bg-slate-50 text-slate-600"}`}><DollarSignIcon className="mb-2 h-5 w-5" /><p className="font-bold">Fixed Fee</p><p className="text-xs">Set project total</p></button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                    <label className="text-sm font-bold text-slate-700">Budget Type<select aria-label="Select Budget Type" value={budgetType} onChange={(e) => setBudgetType(e.target.value as "hours" | "fees" | "none")} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm outline-none focus:border-cyan-500"><option value="none">No Budget</option><option value="hours">Total Hours</option><option value="fees">Total Fees</option></select></label>
                    <label className="text-sm font-bold text-slate-700">Amount<input disabled={budgetType === "none"} type="number" min="0" value={budgetAmount} onChange={(e) => setBudgetAmount(e.target.value)} placeholder={budgetType === "hours" ? "e.g. 100 hrs" : "e.g. $5,000"} className="mt-1 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none transition focus:border-cyan-500 disabled:opacity-50" /></label>
                  </div>
                </>
              )}

              {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
                {step === 2 && <button type="button" onClick={() => setStep(1)} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Back</button>}
                <button type="submit" disabled={loading || (step === 1 && !name.trim())} className="rounded-2xl bg-cyan-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">{loading ? "Saving..." : step === 1 ? "Next" : "Create Project"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
