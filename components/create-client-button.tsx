"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2Icon, PlusIcon, XIcon } from "lucide-react";
import { ModalDialog } from "@/components/modal-dialog";

export function CreateClientButton() {
  const router = useRouter();
  const titleId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const pendingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");

  useEffect(() => {
    const feedback = errorRef.current;
    if (!error || !feedback) return;
    // Scroll only the dialog body, never the fixed header or document.
    const body = feedback.parentElement;
    body?.scrollTo({ top: body.scrollHeight });
    feedback.focus({ preventScroll: true });
  }, [error]);

  function close() {
    if (pendingRef.current) return;
    setIsOpen(false);
    setError("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pendingRef.current || !name.trim()) return;
    pendingRef.current = true;
    setLoading(true);
    setError("");
    const submitted = { name: name.trim(), email: email.trim().toLowerCase() || null, address: address.trim() || null };
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submitted),
      });
      const data = await res.json();
      const saved = data?.client;
      if (!res.ok || data?.ok !== true || !saved || typeof saved.id !== "string" || !saved.id || saved.name !== submitted.name || saved.email !== submitted.email || saved.address !== submitted.address || saved.status !== "active") throw new Error("Unconfirmed client save");
      setName("");
      setEmail("");
      setAddress("");
      setIsOpen(false);
      router.refresh();
    } catch {
      setError("We couldn't confirm the client was saved. Your details are still here. Please try again. Before doing so, check the client list to avoid duplicates.");
    } finally {
      pendingRef.current = false;
      setLoading(false);
    }
  }

  return (
    <>
      <button ref={triggerRef} disabled={loading} onClick={() => { if (!pendingRef.current) setIsOpen(true); }} className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50">
        <PlusIcon className="h-4 w-4" />
        New Client
      </button>

      {isOpen && (
        <ModalDialog onClose={close} labelledBy={titleId} initialFocusRef={nameRef} returnFocusRef={triggerRef} className="inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md rounded-[28px] border border-slate-200 bg-white text-slate-950 shadow-2xl backdrop:bg-slate-950/55 backdrop:backdrop-blur-sm">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6 sm:py-5">
              <div className="flex min-w-0 items-center gap-3">
                <div className="rounded-2xl bg-cyan-50 p-3 text-cyan-700"><Building2Icon className="h-5 w-5" /></div>
                <div>
                  <h2 id={titleId} className="text-xl font-semibold tracking-tight sm:text-2xl">Add Client</h2>
                  <p className="text-sm text-slate-500">Create a billing and project account.</p>
                </div>
              </div>
              <button type="button" disabled={loading} onClick={close} title="Close" aria-label="Close modal" className="shrink-0 rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"><XIcon className="h-5 w-5" /></button>
            </div>

            <form onSubmit={submit} className="flex min-h-0 flex-col">
              <div className="min-h-0 space-y-5 overflow-y-auto overscroll-contain p-5 sm:p-6">
              <fieldset disabled={loading} className="min-w-0 space-y-5">
              <label htmlFor="companyName" className="block text-sm font-bold text-slate-700">Company Name<input ref={nameRef} id="companyName" type="text" maxLength={255} autoComplete="organization" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label className="block text-sm font-bold text-slate-700">Billing Email <span className="font-normal text-slate-400">(Optional)</span><input type="email" maxLength={255} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="billing@acme.inc" className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              <label className="block text-sm font-bold text-slate-700">Address <span className="font-normal text-slate-400">(Optional)</span><textarea rows={3} value={address} onChange={(e) => setAddress(e.target.value)} placeholder="123 Corporate Blvd" className="mt-1 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none transition focus:border-cyan-500 focus:bg-white" /></label>
              </fieldset>
              {error && <p ref={errorRef} tabIndex={-1} role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">{error}</p>}
              {loading && <p role="status" className="text-sm text-slate-500">Saving client…</p>}
              </div>
              <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-5 py-4 sm:px-6">
                <button type="button" disabled={loading} onClick={close} className="rounded-2xl border border-slate-200 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Cancel</button>
                <button type="submit" disabled={loading || !name.trim()} className="rounded-2xl bg-cyan-600 px-5 py-2 text-sm font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50">{loading ? "Saving..." : "Save Client"}</button>
              </div>
            </form>
        </ModalDialog>
      )}
    </>
  );
}
