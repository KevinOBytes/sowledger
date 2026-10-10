const CANONICAL_APP_ORIGIN = "https://www.sowledger.com";
const LEGACY_HOSTS = new Set(["billabled.com", "www.billabled.com"]);

export function getAppOrigin(configured = process.env.NEXT_PUBLIC_APP_URL, requestOrigin?: string) {
  const fallback = process.env.NODE_ENV === "production" ? CANONICAL_APP_ORIGIN : requestOrigin ?? "http://localhost:3000";
  try {
    const url = new URL(configured || fallback);
    if (LEGACY_HOSTS.has(url.hostname)) return CANONICAL_APP_ORIGIN;
    if (url.username || url.password) throw new Error("Credentials are not an app origin");
    if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.protocol === "http:")) {
      throw new Error("Unsupported app origin");
    }
    return url.origin;
  } catch {
    return fallback;
  }
}
