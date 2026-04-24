"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, PlusIcon, XIcon } from "lucide-react";

export function CreateClientButton() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  function close() {
    setIsOpen(false);
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() || undefined, address: address.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create client");
      setName("");
      setEmail("");
      setAddress("");
      setIsOpen(false);
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
        New Client
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md overflow-hidden rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Building2Icon className="h-5 w-5" /></div>
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight">Add Client</h2>
                  <p className="text-sm text-slate-500">Create a billing and project account.</p>
                </div>
              </div>
              <button onClick={close} title="Close" aria-label="Close modal" className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><XIcon className="h-5 w-5" /></button>
            </div>

            <form onSubmit={submit} className="space-y-5 p-6">
              <label htmlFor="companyName" className="block text-sm font-bold text-slate-700">Company Name<input id="companyName" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label className="block text-sm font-bold text-slate-700">Billing Email <span className="font-normal text-slate-400">(Optional)</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@acme.inc" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label className="block text-sm font-bold text-slate-700">Address <span className="font-normal text-slate-400">(Optional)</span><textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Corporate Blvd" className="mt-1 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              {error && <p className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-5">
                <button type="button" onClick={close} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={loading || !name.trim()} className="rounded-2xl bg-cyan-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">{loading ? "Saving..." : "Save Client"}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
