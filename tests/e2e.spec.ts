import { test, expect } from '@playwright/test';

test.describe('Unauthenticated Flows', () => {
  test('Test 1: marketing homepage loads with brand', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('a[href="/login"]').first()).toBeVisible();
  });

  test('Test 2: login page renders auth form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
  });

  test('Test 3: unauthenticated request redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*\/login/);
  });

  test('Test 4: support and API docs are public', async ({ page }) => {
    await page.goto('/support/api');
    await expect(page.getByRole('heading', { name: 'Build on Billabled.' })).toBeVisible();
    await expect(page.getByText('Authorization: Bearer blb_your_api_key', { exact: true })).toBeVisible();
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
  test.beforeEach(async ({ page }) => {
    const res = await page.goto('/api/test/login?plan=free');
    const data = await res?.json();
    expect(data?.success).toBe(true);
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('Test 5: dashboard renders app layout', async ({ page }) => {
    await expect(page.getByText('Today’s command center')).toBeVisible();
    await expect(page.getByRole('link', { name: /Billabled/i })).toBeVisible();
  });

  test('Test 6: sidebar navigation works', async ({ page }) => {
    await page.getByRole('link', { name: 'Workspace' }).click();
    await expect(page).toHaveURL(/.*\/settings/);
  });

  test('Test 7: billing settings shows plan and usage meters', async ({ page }) => {
    await page.goto('/settings/billing');
    await expect(page.getByRole('heading', { name: 'Plans and subscription' })).toBeVisible();
    await expect(page.getByText('Workspace members')).toBeVisible();
    await expect(page.getByText('Active projects')).toBeVisible();
  });

  test('Test 8: invoices free plan paywall triggers', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.locator('text=Invoicing is a Starter feature')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move to Starter' })).toBeVisible();
  });

  test('Test 9: webhooks free plan paywall triggers', async ({ page }) => {
    await page.goto('/settings/webhooks');
    await expect(page.getByText('Advanced integrations')).toBeVisible();
    await expect(page.getByRole('link', { name: /Move to Studio/i })).toBeVisible();
  });

  test('Test 10: global timer interface present', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log time' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Plan work/i })).toBeVisible();
  });
});
