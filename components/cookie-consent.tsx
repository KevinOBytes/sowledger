"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie } from "lucide-react";
import { hasBrowserConsentChoice, setBrowserConsent, subscribeBrowserConsent } from "@/lib/browser-consent";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const sync = () => setShow(!hasBrowserConsentChoice());
    const unsubscribe = subscribeBrowserConsent(sync);
    sync();
    return unsubscribe;
  }, []);

  const handleAccept = () => {
    setBrowserConsent(true);
    setShow(false);
  };

  const handleDecline = () => {
    setBrowserConsent(false);
    setShow(false);
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          role="region"
          aria-label="Cookie preferences"
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="fixed bottom-4 right-4 left-4 z-[100] sm:left-auto sm:w-[24rem]"
        >
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-2xl shadow-stone-900/10 sm:p-5">
            <div className="flex items-center gap-3">
              <div className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700 sm:flex">
                <Cookie className="h-5 w-5" aria-hidden="true" />
              </div>
              <h3 className="font-semibold text-slate-950">Cookie preferences</h3>
            </div>
            <p className="mt-2 text-sm leading-5 text-slate-600 sm:mt-3 sm:leading-relaxed">
              Necessary cookies keep the site working. Optional analytics stay off unless you accept.
            </p>
            <div className="mt-3 flex items-center justify-end gap-3 sm:mt-5">
              <button
                onClick={handleDecline}
                className="rounded-full px-4 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                Decline
              </button>
              <button
                onClick={handleAccept}
                className="rounded-full bg-slate-950 px-5 py-2 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Accept All
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
