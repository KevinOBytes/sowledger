export const INTERNAL_HIGHEST_ACCESS_EMAILS = [
  "kevin@tkoresearch.com",
  "kevin@kevinbytes.com",
  "kevo214@gmail.com",
  "rebeccacht@gmail.com",
  "rebeccagrapsy@gmail.com",
] as const;

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isInternalHighestAccessEmail(email: string) {
  return INTERNAL_HIGHEST_ACCESS_EMAILS.includes(normalizeEmail(email) as typeof INTERNAL_HIGHEST_ACCESS_EMAILS[number]);
}
