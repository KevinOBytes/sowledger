/** Returns true when the email belongs to the @kevinbytes.com admin domain. */
export function isAdminEmail(email: string): boolean {
  return email.trim().toLowerCase().endsWith("@kevinbytes.com");
}
