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
  { path: '/dashboard', heading: 'Your time today' },
  { path: '/activity', heading: 'Activity' },
  { path: '/reports', heading: 'Analytics' },
  { path: '/exports', heading: 'Exports' },
  { path: '/integrations', heading: 'Integrations' },
  { path: '/settings/developers', heading: 'Developers' },
];

test.describe('Mobile Web Support', () => {
  test.setTimeout(60_000);
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: 'sowledger-cookie-consent', value: 'false', url: 'http://localhost:3008' }]);
  });

  test('iPhone viewport supports public pages, auth, and core bottom navigation', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: 'Your work, your time, your invoices. Together.' })).toBeVisible();
    await expect(page.getByLabel('SOWLedger capability navigation')).toBeVisible();
    await page.getByRole('button', { name: 'Open marketing menu' }).click();
    await expect(page.getByRole('navigation', { name: 'Mobile marketing navigation' }).getByRole('link', { name: 'Built for', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close marketing menu' }).click();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/support');
    await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Read API docs', exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/support/api');
    await expect(page.getByRole('heading', { level: 1, name: 'Connect your work records.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Support home/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/security');
    await expect(page.getByRole('heading', { level: 1, name: 'How access and data are handled.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Contact security/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/contact');
    await expect(page.getByRole('heading', { level: 1, name: 'Get in touch.' })).toBeVisible();
    await expect(page.getByRole('link', { name: /support@sowledger\.com/i })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await gotoApp(page, '/privacy');
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
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
      await gotoApp(page, route.path, 3, route.path === '/integrations' ? 'domcontentloaded' : 'load');
      await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
    }

    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Quick time entry' })).toBeVisible();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    const moreDialog = page.getByRole('dialog', { name: 'More SOWLedger navigation' });
    await expect(moreDialog).toBeVisible();
    for (const linkName of ['Projects', 'Clients', 'Planner', 'Approvals', 'Invoices', 'Exports', 'People', 'Integrations', 'Developers', 'Billing', 'Settings']) {
      await expect(moreDialog.getByRole('link', { name: new RegExp(linkName) })).toBeVisible();
    }
    await moreDialog.getByRole('link', { name: /Integrations/i }).click();
    await expect(page).toHaveURL(/.*\/integrations/);

    await page.getByRole('link', { name: 'Calendar', exact: true }).click();
    await expect(page).toHaveURL(/.*\/calendar/);
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar', exact: true })).toBeVisible();
  });
});
