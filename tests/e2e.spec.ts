import { test, expect } from '@playwright/test';
import { gotoApp } from './helpers/navigation';

test.describe('Unauthenticated Flows', () => {
  test('Test 1: marketing homepage loads with brand', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('heading', { level: 1, name: 'Recover revenue. Prove every invoice.' })).toBeVisible();
    await expect(page.getByText('Invoice Proof Packs')).toBeVisible();
    await expect(page.getByText('Retainer Leak Radar')).toBeVisible();
    await expect(page.getByText('Client Sign-Off Portal')).toBeVisible();
    await expect(page.getByText('Missing Billable Recovery')).toBeVisible();
    await expect(page.getByText('Developer/Agency Integration Layer')).toBeVisible();
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  });

  test('Test 2: login page renders auth form', async ({ page }) => {
    await gotoApp(page, '/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Test 3: unauthenticated request redirects to login', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('Test 4: support and API docs are public', async ({ page }) => {
    await gotoApp(page, '/support/api');
    await expect(page.getByRole('heading', { name: 'Build on Billabled.' })).toBeVisible();
    await expect(page.getByText(/oauth2-bearer/).first()).toBeVisible();
    await expect(page.getByText('/api/v1/proof-packs?invoiceId=...')).toBeVisible();
    await expect(page.getByText('/api/v1/revenue-intelligence').first()).toBeVisible();

    for (const path of ['/security', '/privacy', '/terms', '/billing-policy', '/contact']) {
      await gotoApp(page, path);
      await expect(page).not.toHaveURL(/.*\/login/);
    }
  });

  test('Test 4b: operational public endpoints are not session-cookie gated', async ({ page }) => {
    const health = await page.request.get('/api/health');
    expect(health.ok()).toBeTruthy();

    const publicApi = await page.request.get('/api/v1/projects');
    expect(publicApi.status()).toBe(401);

    const stripeWebhook = await page.request.post('/api/webhooks/stripe', { data: '{}' });
    expect(stripeWebhook.status()).toBe(400);
  });
});

test.describe('Authenticated Flows (Free Plan)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const workspaceSlug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const workspace = `free-e2e-${workspaceSlug}-${Date.now()}`;
    const res = await page.request.get(`/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    await gotoApp(page, '/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('Test 5: dashboard renders app layout', async ({ page }) => {
    await expect(page.getByText('Today’s command center')).toBeVisible();
    await expect(page.getByRole('link', { name: /Billabled/i })).toBeVisible();
  });

  test('Test 6: sidebar navigation works', async ({ page }) => {
    await page.getByRole('link', { name: 'Workspace', exact: true }).click();
    await expect(page).toHaveURL(/.*\/settings/);
  });

  test('Test 7: billing settings shows plan and usage meters', async ({ page }) => {
    await gotoApp(page, '/settings/billing');
    await expect(page.getByRole('heading', { name: 'Plans and subscription' })).toBeVisible();
    await expect(page.getByText('Workspace members')).toBeVisible();
    await expect(page.getByText('Active projects')).toBeVisible();
  });

  test('Test 8: invoices free plan paywall triggers', async ({ page }) => {
    await gotoApp(page, '/invoices');
    await expect(page.locator('text=Invoicing is a Starter feature')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move to Starter' })).toBeVisible();
  });

  test('Test 9: webhooks free plan paywall triggers', async ({ page }) => {
    await gotoApp(page, '/settings/webhooks');
    await expect(page.getByText('Advanced integrations')).toBeVisible();
    await expect(page.getByRole('link', { name: /Move to Studio/i })).toBeVisible();
  });

  test('Test 10: global timer interface present', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log completed work', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Schedule work/i }).first()).toBeVisible();
  });

  test('Test 10b: first setup repairs a workspace with no manager', async ({ page }) => {
    const login = await page.request.get('/api/test/login?plan=free&role=member&clean=true');
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    const me = await page.request.get('/api/auth/me');
    expect(me.ok()).toBeTruthy();
    const meData = await me.json();
    expect(meData.session.role).toBe('owner');

    const project = await page.request.post('/api/projects', {
      data: { name: `Setup Recovery ${Date.now()}` },
    });
    expect(project.ok()).toBeTruthy();
  });

  test('Test 10c: internal accounts receive owner role and Business limits', async ({ page }) => {
    const workspace = `internal-e2e-${Date.now()}`;
    const login = await page.request.get(`/api/test/login?plan=free&role=member&email=kevin%40tkoresearch.com&workspace=${workspace}&clean=true`);
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    const me = await page.request.get('/api/auth/me');
    expect(me.ok()).toBeTruthy();
    const meData = await me.json();
    expect(meData.session.email).toBe('kevin@tkoresearch.com');
    expect(meData.session.role).toBe('owner');

    const billing = await page.request.get('/api/billing');
    expect(billing.ok()).toBeTruthy();
    const billingData = await billing.json();
    expect(billingData.plan).toBe('enterprise');
    expect(billingData.planSource).toBe('internal');
    expect(billingData.limits.projects).toBeGreaterThanOrEqual(200);
  });

  test('Test 10d: first-run setup can be skipped and resumed', async ({ page }) => {
    const workspace = `onboarding-e2e-${Date.now()}`;
    const login = await page.request.get(`/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    await gotoApp(page, '/dashboard');
    await expect(page.getByText('First login setup')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByText('Setup hidden')).toBeVisible();
    await page.getByRole('button', { name: 'Resume setup' }).click();
    await expect(page.getByText('First login setup')).toBeVisible();
  });
});
