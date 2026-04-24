import { expect, test } from '@playwright/test';

test.describe('Mobile Web Support', () => {
  test('iPhone viewport supports public pages, auth, and core bottom navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    const workspace = `mobile-e2e-${Date.now()}`;
    const login = await page.goto(`/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    const loginData = await login?.json();
    expect(loginData?.success).toBe(true);

    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick time entry' })).toBeVisible();

    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/.*\/calendar/);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });
});
