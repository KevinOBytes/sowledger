import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers/navigation';

test.describe('Mobile Web Support', () => {
  test('iPhone viewport supports public pages, auth, and core bottom navigation', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const manifest = await page.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBeTruthy();
    expect((await manifest.json()).display).toBe('standalone');

    await gotoApp(page, '/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    const workspace = `mobile-e2e-${Date.now()}`;
    const login = await page.request.get(`/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick time entry' })).toBeVisible();

    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/.*\/calendar/);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });
});
