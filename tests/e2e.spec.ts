import { test, expect } from '@playwright/test';

// Unauthenticated Tests
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

  test('Test 4: unauthenticated unknown route redirects to login due to protection boundary', async ({ page }) => {
    await page.goto('/this-route-does-not-exist');
    await expect(page).toHaveURL(/.*\/login/);
  });
});

// Authenticated Tests
test.describe('Authenticated Flows (Free Plan)', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the test login endpoint which provisions a free plan workspace and sets the session cookie
    const res = await page.goto('/api/test/login?plan=free');
    const data = await res?.json();
    expect(data?.success).toBe(true);
    
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/); // Wait for redirect to complete
  });

  test('Test 5: dashboard renders app layout', async ({ page }) => {
    await page.goto('/dashboard');
    // Basic structural check inside the app shell
    await expect(page.locator('text=Timed').first()).toBeVisible();
  });

  test('Test 6: sidebar navigation works', async ({ page }) => {
    await page.goto('/dashboard');
    // Click Settings in sidebar
    await page.click('text=Settings');
    await expect(page).toHaveURL(/.*\/settings/);
  });

  test('Test 7: billing settings shows meters', async ({ page }) => {
    await page.goto('/settings/billing');
    await expect(page.locator('text=Billing & Plans')).toBeVisible();
    await expect(page.locator('text=Workspace Members').first()).toBeVisible();
  });

  test('Test 8: invoices free plan paywall triggers', async ({ page }) => {
    await page.goto('/invoices');
    await expect(page.locator('text=Invoicing is a Pro feature')).toBeVisible();
    await expect(page.locator('text=Upgrade to Pro')).toBeVisible();
  });

  test('Test 9: webhooks free plan paywall triggers', async ({ page }) => {
    await page.goto('/settings/webhooks');
    await expect(page.getByText('Advanced Integrations')).toBeVisible();
    await expect(page.getByRole('link', { name: /Upgrade to SMB/i })).toBeVisible();
  });

  test('Test 10: global timer interface present', async ({ page }) => {
    await page.goto('/dashboard');
    // Looking for the timer start button
    await expect(page.locator('text=Start Session').first()).toBeVisible();
  });
});
