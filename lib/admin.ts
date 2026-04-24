import { isInternalHighestAccessEmail } from "./internal-accounts";

/** Returns true when the email belongs to an internal highest-access account. */
export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@kevinbytes.com") || isInternalHighestAccessEmail(email);
}
