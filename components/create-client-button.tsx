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
        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 transition hover:from-emerald-400 hover:to-emerald-500"
      >
        <PlusIcon strokeWidth={2.5} className="h-4 w-4" />
        New Client
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
            />
            
            {/* Modal */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-slate-900 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-white/5 bg-slate-800/50 p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-emerald-500/20 p-2">
                    <Building2Icon className="h-5 w-5 text-emerald-400" />
                  </div>
                  <h2 className="text-xl font-bold text-white">Add Client</h2>
                </div>
                <button 
                  onClick={() => setIsOpen(false)}
                  title="Close"
                  aria-label="Close modal"
                  className="rounded-full p-2 text-slate-400 hover:bg-white/10 hover:text-white transition"
                >
                  <XIcon className="h-5 w-5" />
                </button>
              </div>

              <form onSubmit={submit} className="p-6 space-y-5">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Company Name</label>
                  <input
                    autoFocus
                    type="text"
                    required
                    placeholder="Acme Corp"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Billing Email <span className="text-slate-500 font-normal">(Optional)</span></label>
                  <input
                    type="email"
                    placeholder="billing@acme.inc"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-300">Address <span className="text-slate-500 font-normal">(Optional)</span></label>
                  <textarea
                    rows={3}
                    placeholder="123 Corporate Blvd&#10;Suite 400"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition resize-none"
                  />
                </div>

                <div className="mt-8 pt-6 border-t border-white/5 flex items-center justify-between">
                  <p className="text-xs text-rose-400 font-medium">{error}</p>
                  <button
                    type="submit"
                    disabled={loading || !name.trim()}
                    className="flex items-center justify-center min-w-[120px] gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-emerald-500 transition disabled:opacity-50"
                  >
                    {loading ? <Loader2Icon className="h-4 w-4 animate-spin" /> : "Save Client"}
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
