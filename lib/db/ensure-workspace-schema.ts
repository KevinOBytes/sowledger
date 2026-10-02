/**
 * Schema changes are deployment-time responsibilities. Keeping this function
 * as a compatibility no-op avoids breaking existing route call sites while
 * preventing a request (especially authentication) from running DDL against
 * the shared Neon database.
 */
export async function ensureWorkspaceSchema(): Promise<void> {
  return;
}
