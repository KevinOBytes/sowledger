"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Loader2Icon, XIcon, BuildingIcon, ClockIcon, DollarSignIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CreateProjectButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  
  // Step/Wizard State
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Data State
  const [clients, setClients] = useState<{id: string; name: string}[]>([]);
  
  // Form State
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState("");
  const [billingModel, setBillingModel] = useState<"hourly" | "fixed_fee">("hourly");
  const [budgetType, setBudgetType] = useState<"hours" | "fees" | "none">("none");
  const [budgetAmount, setBudgetAmount] = useState("");

  useEffect(() => {
    if (isOpen) {
      // Fetch clients for the dropdown
      fetch("/api/clients")
        .then((res) => res.json())
        .then((data) => {
          if (data.ok) setClients(data.clients);
        })
        .catch(console.error);
    }
  }, [isOpen]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: name.trim(), 
          clientId: clientId || undefined,
          billingModel,
          budgetType,
          budgetAmount: budgetAmount ? parseFloat(budgetAmount) : undefined
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create project");
      }

      setIsOpen(false);
      resetForm();
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName("");
    setClientId("");
    setBillingModel("hourly");
    setBudgetType("none");
    setBudgetAmount("");
    setStep(1);
    setError("");
  }

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-500 to-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-cyan-500/25 transition hover:from-cyan-400 hover:to-cyan-500"
      >
        <PlusIcon strokeWidth={2.5} className="h-4 w-4" />
        New Project
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => { setIsOpen(false); resetForm(); }}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-white/5 bg-slate-800/50 p-6">
                <div>
                  <h2 className="text-xl font-bold text-white">Create New Project</h2>
                  <p className="text-sm text-slate-400">Step {step} of 2</p>
                </div>
                <button 
                  onClick={() => { setIsOpen(false); resetForm(); }}
                  title="Close"
                  aria-label="Close modal"
                  className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>

              {/* Body */}
              <form onSubmit={step === 2 ? submit : (e) => { e.preventDefault(); setStep(2); }} className="p-6">
                
                {step === 1 && (
                  <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="space-y-5">
                    
                    <div>
                      <label htmlFor="projectName" className="mb-1.5 block text-sm font-medium text-slate-300">Project Name</label>
                      <input
                        id="projectName"
                        autoFocus
                        type="text"
                        placeholder="e.g. Acme Website Redesign"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 transition"
                      />
                    </div>

                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-300">Client <span className="text-slate-500 font-normal">(Optional)</span></label>
                      <div className="relative">
                        <BuildingIcon className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                        <select
                           aria-label="Select Client"
                           value={clientId}
                           onChange={(e) => setClientId(e.target.value)}
                           className="w-full appearance-none rounded-xl border border-white/10 bg-black/20 pl-10 pr-4 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none transition"
                        >
                          <option value="" className="bg-slate-900">No Client (Internal)</option>
                          {clients.map(c => (
                            <option key={c.id} value={c.id} className="bg-slate-900">{c.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                  </motion.div>
                )}

                {step === 2 && (
                  <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="space-y-6">
                    
                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-slate-300">Billing Model</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          type="button"
                          onClick={() => setBillingModel("hourly")}
                          className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${billingModel === "hourly" ? "border-cyan-500 bg-cyan-500/10 text-cyan-400" : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20"}`}
                        >
                          <ClockIcon className="h-5 w-5" />
                          <div>
                            <p className="text-sm font-semibold">Time & Materials</p>
                            <p className="text-xs opacity-80 mt-1">Bill by the hour</p>
                          </div>
                        </button>
                        <button
                          type="button"
                          onClick={() => setBillingModel("fixed_fee")}
                          className={`flex items-center gap-3 rounded-xl border p-4 text-left transition ${billingModel === "fixed_fee" ? "border-emerald-500 bg-emerald-500/10 text-emerald-400" : "border-white/10 bg-black/20 text-slate-400 hover:border-white/20"}`}
                        >
                          <DollarSignIcon className="h-5 w-5" />
                          <div>
                            <p className="text-sm font-semibold">Fixed Fee</p>
                            <p className="text-xs opacity-80 mt-1">Set project total</p>
                          </div>
                        </button>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <label className="block text-sm font-medium text-slate-300">Budget Constraint <span className="text-slate-500 font-normal">(Optional)</span></label>
                      <div className="flex gap-2">
                        <select
                           aria-label="Select Budget Type"
                           value={budgetType}
                           onChange={(e) => setBudgetType(e.target.value as "hours" | "fees" | "none")}
                           className="w-1/3 rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm text-white focus:border-cyan-500 focus:outline-none transition"
                        >
                          <option value="none">No Budget</option>
                          <option value="hours">Total Hours</option>
                          <option value="fees">Total Fees</option>
                        </select>
                        {budgetType !== "none" && (
                          <input
                            type="number"
                            min="0"
                            placeholder={budgetType === "hours" ? "e.g. 100 hrs" : "e.g. $5,000"}
                            value={budgetAmount}
                            onChange={(e) => setBudgetAmount(e.target.value)}
                            className="flex-1 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none transition"
                          />
                        )}
                      </div>
                    </div>

                  </motion.div>
                )}

                {/* Footer Controls */}
                <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                  <div>
                    {error && <p className="text-xs text-rose-400 font-medium">{error}</p>}
                  </div>
                  <div className="flex gap-3">
                    {step === 2 && (
                       <button
                         type="button"
                         onClick={() => { setStep(1); setError(""); }}
                         className="rounded-xl px-5 py-2.5 text-sm font-semibold text-slate-300 hover:bg-white/5 hover:text-white transition"
                       >
                         Back
                       </button>
                    )}
                    <button
                      type="submit"
                      disabled={loading || (step === 1 && !name.trim())}
                      className="flex items-center justify-center min-w-[100px] gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-cyan-500 transition disabled:opacity-50"
                    >
                      {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : step === 1 ? "Next" : "Create Project"}
                    </button>
                  </div>
                </div>

              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
