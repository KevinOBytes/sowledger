import { expect, test } from '@playwright/test';
import { gotoApp, requestGetApp } from './helpers/navigation';

async function expectNoHorizontalOverflow(page: import('@playwright/test').Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const root = document.documentElement;
        return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
      }),
    )
    .toBeLessThanOrEqual(1);
}

const internalAppRoutes = [
  { path: '/dashboard', heading: 'Today’s command center' },
  { path: '/activity', heading: 'Activity' },
  { path: '/reports', heading: 'Work performance and billable output' },
  { path: '/exports', heading: 'Complete and filtered data exports' },
  { path: '/settings/developers', heading: 'Agency integrations, API keys, usage, and docs' },
];

test.describe('Mobile Web Support', () => {
  test('iPhone viewport supports public pages, auth, and core bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: 'Recover revenue. Prove every invoice.' })).toBeVisible();
    await expect(page.getByLabel('Billabled capability navigation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoice Proof Packs', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retainer Leak Radar', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client Sign-Off Portal', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Missing Billable Recovery', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Developer/Agency Integration Layer', exact: true })).toBeVisible();
    await expect(page.getByRole('img', { name: /Billabled invoice proof pack screenshot/i }).first()).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/support');
    await expect(page.getByRole('heading', { level: 1, name: 'Get help moving work into invoice proof.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Open API guide/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/support/api');
    await expect(page.getByRole('heading', { level: 1, name: 'Build on Billabled.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Support home/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/security');
    await expect(page.getByRole('heading', { level: 1, name: 'Security posture for proof-backed billing.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Contact security/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/contact');
    await expect(page.getByRole('heading', { level: 1, name: 'Contact Billabled with the right context.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /support@billabled\.com/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/terms');
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/billing-policy');
    await expect(page.getByRole('heading', { level: 1, name: 'Billing and refund policy' })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    const manifest = await page.request.get('/manifest.webmanifest');
    expect(manifest.ok()).toBeTruthy();
    expect((await manifest.json()).display).toBe('standalone');

    await gotoApp(page, '/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();

    const workspace = `mobile-e2e-${Date.now()}`;
    const login = await requestGetApp(page, `/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    for (const route of internalAppRoutes) {
      await gotoApp(page, route.path);
      await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick time entry' })).toBeVisible();

    await page.getByRole('link', { name: 'Calendar' }).click();
    await expect(page).toHaveURL(/.*\/calendar/);
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  });
});
