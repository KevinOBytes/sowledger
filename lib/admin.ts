import { isInternalHighestAccessEmail } from "./internal-accounts";

const SITE_ADMIN_DOMAINS = ["tkoresearch.com", "sowledger.com", "kevinbytes.com"];

/** Returns true when the email belongs to an internal highest-access account. */
export function isAdminEmail(email: string): boolean {
  const normalized = email.trim().toLowerCase();

  return SITE_ADMIN_DOMAINS.some((domain) => normalized.endsWith(`@${domain}`))
    || isInternalHighestAccessEmail(normalized);
}
