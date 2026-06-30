"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie } from "lucide-react";
import { useRouter } from "next/navigation";

export function CookieConsent() {
  const [show, setShow] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // Check if consent cookie exists
    const hasConsent = document.cookie.includes("sowledger-cookie-consent=");
    if (!hasConsent) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setShow(true);
    }
  }, []);

  const handleAccept = () => {
    // Set cookie for 1 year
    document.cookie = "sowledger-cookie-consent=true; path=/; max-age=31536000; SameSite=Lax";
    setShow(false);
    // Refresh the router so the server-side layout reads the cookie and renders GA
    router.refresh();
  };

  const handleDecline = () => {
    // Set cookie to false to remember their choice and not ask again
    document.cookie = "sowledger-cookie-consent=false; path=/; max-age=31536000; SameSite=Lax";
    setShow(false);
    router.refresh();
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="fixed bottom-4 right-4 left-4 z-[100] sm:left-auto sm:w-[24rem]"
        >
          <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface p-5 shadow-2xl shadow-stone-900/10">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cyan-50 text-cyan-700">
                <Cookie className="h-5 w-5" />
              </div>
              <h3 className="font-semibold text-slate-950">We use cookies</h3>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-slate-600">
              We use necessary cookies to make our site work. We&apos;d also like to set optional analytics cookies to help us improve it. We won&apos;t set optional cookies unless you enable them.
            </p>
            <div className="mt-5 flex items-center justify-end gap-3">
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
