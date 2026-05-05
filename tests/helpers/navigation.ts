import type { Page, Response } from "@playwright/test";

const TRANSIENT_NAVIGATION_ERRORS = ["ERR_CONNECTION_REFUSED", "ERR_EMPTY_RESPONSE", "ECONNRESET"];

export async function gotoApp(page: Page, url: string, attempts = 3): Promise<Response | null> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await page.goto(url);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      const transient = TRANSIENT_NAVIGATION_ERRORS.some((token) => message.includes(token));
      if (!transient || attempt === attempts) throw error;
      await page.waitForTimeout(250 * attempt);
    }
  }

  throw lastError;
}
