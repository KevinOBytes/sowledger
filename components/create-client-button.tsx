"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon, Loader2Icon, XIcon, Building2Icon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export function CreateClientButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          name: name.trim(), 
          email: email.trim() || undefined,
          address: address.trim() || undefined
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to create client");
      }

      setIsOpen(false);
      setName("");
      setEmail("");
      setAddress("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setIsOpen(true)}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="flex items-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-emerald-500 hover:shadow-emerald-400/40 relative overflow-hidden group"
      >
        <div className="absolute inset-0 bg-white/20 translate-y-[-100%] group-hover:translate-y-[100%] transition-transform duration-500" />
        <PlusIcon strokeWidth={2.5} className="h-4 w-4 relative z-10" />
        <span className="relative z-10">New Client</span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-slate-950/40 backdrop-blur-md"
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-[2rem] border border-white/10 bg-[#0a0f1c]/90 backdrop-blur-2xl shadow-[0_0_80px_rgba(16,185,129,0.15)]"
            >
              {/* Internal abstract glow */}
              <div className="absolute -top-32 -right-32 h-64 w-64 rounded-full bg-emerald-500/10 blur-3xl pointer-events-none" />

              <div className="relative flex items-center justify-between border-b border-white/5 bg-slate-900/40 p-6 z-10">
                <div className="flex items-center gap-4">
                  <div className="relative flex items-center justify-center w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 shadow-inner">
                    <Building2Icon className="h-6 w-6 text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />
                  </div>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Add Client</h2>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  title="Close"
                  aria-label="Close modal"
                  className="rounded-full p-2.5 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={submit} className="relative p-8 space-y-6 z-10">
                <div>
                  <label htmlFor="companyName" className="mb-2 block text-sm font-semibold text-slate-300">Company Name</label>
                  <input
                    id="companyName"
                    autoFocus
                    type="text"
                    required
                    placeholder="Acme Corp"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-sm text-white placeholder-slate-500 shadow-inner focus:border-emerald-500/50 focus:bg-black/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-300">Billing Email <span className="text-slate-500 font-normal ml-1">(Optional)</span></label>
                  <input
                    type="email"
                    placeholder="billing@acme.inc"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-sm text-white placeholder-slate-500 shadow-inner focus:border-emerald-500/50 focus:bg-black/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-300">Address <span className="text-slate-500 font-normal ml-1">(Optional)</span></label>
                  <textarea
                    rows={3}
                    placeholder="123 Corporate Blvd&#10;Suite 400"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-2xl border border-white/10 bg-black/40 px-5 py-3.5 text-sm text-white placeholder-slate-500 shadow-inner focus:border-emerald-500/50 focus:bg-black/60 focus:outline-none focus:ring-1 focus:ring-emerald-500/50 transition-all resize-none"
                  />
                </div>

                <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                  <p className="text-xs text-rose-400 font-medium">{error}</p>
                  <button
                    type="submit"
                    disabled={loading || !name.trim()}
                    className="flex items-center justify-center min-w-[140px] gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:from-emerald-400 hover:to-emerald-500 hover:shadow-emerald-400/40 disabled:opacity-50"
                  >
                    {loading ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white" /> : "Save Client"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}
