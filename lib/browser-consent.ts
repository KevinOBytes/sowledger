const CONSENT_COOKIE = "sowledger-cookie-consent";
const CONSENT_SIGNAL = "sowledger-cookie-consent-change";
const listeners = new Set<() => void>();
let interval: number | undefined;
let signalRevision = 0;
// A failed revoke must not be undone by rereading a stale true cookie. This
// page-local fence cannot pretend to persist a decision the browser rejected.
let deniedInPage = false;

function storedChoice(header: string): boolean | undefined {
  let count = 0;
  let choice: boolean | undefined;
  for (const part of header.split(";")) {
    const cookie = part.trimStart();
    const separator = cookie.indexOf("=");
    const name = separator < 0 ? cookie : cookie.slice(0, separator);
    if (name.trimEnd() !== CONSENT_COOKIE) continue;
    count++;
    const value = separator < 0 ? "" : cookie.slice(separator + 1);
    choice = name === CONSENT_COOKIE && value === "true" ? true
      : name === CONSENT_COOKIE && value === "false" ? false : undefined;
  }
  return count === 1 ? choice : undefined;
}

function browserChoice(): boolean | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") return undefined;
  try { return storedChoice(document.cookie); } catch { return undefined; }
}

export function readBrowserConsent(cookieHeader?: string): boolean {
  if (cookieHeader !== undefined) return storedChoice(cookieHeader) === true;
  return !deniedInPage && browserChoice() === true;
}

// The banner must remember an exact false choice without interpreting a
// malformed, shadow-name, or duplicate cookie as a completed decision.
export function hasBrowserConsentChoice(): boolean {
  return browserChoice() !== undefined;
}

function notify() {
  for (const listener of [...listeners]) {
    // One failed vendor must not prevent other subscribers from revoking.
    try { listener(); } catch { /* Optional analytics fail closed locally. */ }
  }
}

export function subscribeBrowserConsent(listener: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  // Each subscription owns its cleanup even if a caller reuses a callback.
  const subscription = () => listener();
  listeners.add(subscription);
  if (listeners.size === 1) {
    window.addEventListener("storage", notify);
    window.addEventListener("focus", notify);
    interval = window.setInterval(notify, 1000);
  }
  return () => {
    listeners.delete(subscription);
    if (listeners.size === 0) {
      window.removeEventListener("storage", notify);
      window.removeEventListener("focus", notify);
      if (interval !== undefined) window.clearInterval(interval);
      interval = undefined;
    }
  };
}

export function setBrowserConsent(accepted: boolean): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  deniedInPage = true;
  const write = (value: boolean) => {
    document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=31536000; SameSite=Lax`;
    return browserChoice() === value;
  };
  try {
    // Before granting, prove writes work with a denied value. Otherwise a
    // silently ignored write could mistake a stale grant for persisted consent.
    const stored = accepted ? write(false) && write(true) : write(false);
    if (stored) deniedInPage = false;
  } catch { /* Keep the current page denied if persistence is unavailable. */ }
  notify();
  try {
    // A signal only: other tabs always reread the cookie, never this value.
    window.localStorage.setItem(CONSENT_SIGNAL, `${Date.now()}-${++signalRevision}`);
  } catch { /* Focus/fallback still work; failed storage never grants consent. */ }
}
