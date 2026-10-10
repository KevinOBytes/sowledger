import { test, expect } from '@playwright/test';
import { gotoApp, requestGetApp } from './helpers/navigation';

test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'sowledger-cookie-consent', value: 'false', url: 'http://localhost:3008' }]);
});

async function expectWorkflowStage(page: import('@playwright/test').Page, stage: string) {
  const workflow = page.locator('section[aria-label="SOWLedger workflow"]');
  if (!(await workflow.isVisible())) await page.locator('details').filter({ has: workflow }).locator('summary').click();
  await expect(workflow).toBeVisible();
  const activeStep = workflow.locator('[aria-current="step"]');
  await expect(activeStep).toHaveCount(1);
  await expect(activeStep).toContainText(stage);
}

async function expectVisibleMainText(page: import('@playwright/test').Page, text: string) {
  await expect(page.locator('main').getByText(text, { exact: true }).first()).toBeVisible();
}

test.describe('Unauthenticated Flows', () => {
  test('Test 1: marketing homepage loads with brand', async ({ page }) => {
    await gotoApp(page, '/');
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('heading', { level: 1, name: 'Your work, your time, your invoices. Together.' })).toBeVisible();
    await expect(page.getByLabel('SOWLedger capability navigation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Show the work behind the total.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'One monthly price for your workspace.' })).toBeVisible();
    await expect(page.getByTestId('pricing-plan')).toHaveCount(4);
    await expect(page.getByRole('link', { name: 'Read API docs', exact: true })).toHaveAttribute('href', '/support/api');
    await expect(page.getByRole('main')).not.toContainText(/Retainer Leak Radar|dispute risk/i);
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
    await gotoApp(page, '/support');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'How can we help?' })).toBeVisible();
    await expect(page.getByText('Plan work', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Track your time', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Add completed work', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Review your hours', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Approve and invoice', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Export or connect tools', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoices', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Analytics and time review' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client review' }).first()).toBeVisible();

    await gotoApp(page, '/support/api');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { name: 'Connect your work records.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What you can connect' })).toBeVisible();
    await expect(page.getByText(/oauth2-bearer/).first()).toBeVisible();
    await expect(page.getByText('/api/v1/proof-packs?invoiceId=...')).toBeVisible();
    await expect(page.getByText('/api/v1/revenue-intelligence').first()).toBeVisible();

    await gotoApp(page, '/security');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'How access and data are handled.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workspace access' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API keys', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Subscription billing' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export checksums' })).toBeVisible();
    await expect(page.getByText('No secrets, tokens, or card data')).toBeVisible();

    await gotoApp(page, '/billing-policy');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Billing and refund policy' })).toBeVisible();
    await expect(page.getByText('Last updated May 4, 2026')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Checkout boundary' })).toBeVisible();
    await expect(page.getByText('Starter: $9/month')).toBeVisible();

    await gotoApp(page, '/privacy');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible();
    await expect(page.getByText(/API key secrets are shown once and stored only as hashes/)).toBeVisible();

    await gotoApp(page, '/terms');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeVisible();
    await expect(page.getByText('Do not abuse public APIs')).toBeVisible();

    await gotoApp(page, '/contact');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Get in touch.' })).toBeVisible();
    await expect(page.getByText(/Please leave out passwords, API keys/)).toBeVisible();
  });

  test('Test 4b: operational public endpoints are not session-cookie gated', async ({ page }) => {
    const health = await page.request.get('/api/health');
    expect(health.ok()).toBeTruthy();

    const publicApi = await page.request.get('/api/v1/projects');
    expect(publicApi.status()).toBe(401);

    const stripeWebhook = await page.request.post('/api/webhooks/stripe', { data: '{}' });
    expect(stripeWebhook.status()).toBe(400);

    const reminderCron = await page.request.get('/api/cron/scheduled-block-reminders');
    expect([200, 401]).toContain(reminderCron.status());
  });
});

test.describe('Authenticated Flows (Free Plan)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    const workspaceSlug = testInfo.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const workspace = `free-e2e-${workspaceSlug}-${Date.now()}`;
    const res = await requestGetApp(page, `/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    await gotoApp(page, '/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('Test 5: dashboard renders app layout', async ({ page }) => {
    await expect(page.getByText('Your time today')).toBeVisible();
    await expectVisibleMainText(page, 'Focused timer');
    await expectVisibleMainText(page, 'Upcoming work');
    await expectVisibleMainText(page, 'All active timers');
    await expectWorkflowStage(page, 'Track');
    await expect(page.getByRole('link', { name: /SOWLedger/i })).toBeVisible();
  });

  test('Test 5b: redesigned internal workflow spine marks each app stage', async ({ page }) => {
    test.setTimeout(60_000);
    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('heading', { name: 'Your time today' })).toBeVisible();
    await expectVisibleMainText(page, 'Focused timer');
    await expectVisibleMainText(page, 'Upcoming work');
    await expectVisibleMainText(page, 'All active timers');
    await expectWorkflowStage(page, 'Track');

    await gotoApp(page, '/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expectWorkflowStage(page, 'Log');

    await gotoApp(page, '/reports');
    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    await expectWorkflowStage(page, 'Review');

    await gotoApp(page, '/exports');
    await expect(page.getByRole('heading', { name: 'Exports', exact: true })).toBeVisible();
    await expect(page.getByText('Each download includes a SHA-256 checksum.', { exact: false })).toBeVisible();
    await expectWorkflowStage(page, 'Invoice');

    await gotoApp(page, '/settings/developers');
    await expect(page.getByRole('heading', { name: 'Developers', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create API key' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workspace keys' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent API requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Protect your API keys' })).toBeVisible();
    await expectWorkflowStage(page, 'Integrate');

    await gotoApp(page, '/integrations');
    await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Calendar sync controls' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slack manual setup' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'QuickBooks invoice defaults' })).toBeVisible();
    await expectWorkflowStage(page, 'Integrate');
  });

  test('Test 6: sidebar navigation works', async ({ page }) => {
    const workspaceLink = page.locator('nav[aria-label="Application navigation"] a[href="/settings"]').first();
    await expect(workspaceLink).toBeVisible();
    await workspaceLink.click();
    await expect(page).toHaveURL(/.*\/settings/, { timeout: 20_000 });
  });

  test('Test 7: billing settings shows plan and usage meters', async ({ page }) => {
    await gotoApp(page, '/app/billing');
    await expect(page).toHaveURL(/.*\/settings\/billing/);
    await gotoApp(page, '/settings/billing');
    await expect(page.getByRole('heading', { name: 'Billing', exact: true })).toBeVisible();
    await expect(page.getByText('Workspace members')).toBeVisible();
    await expect(page.locator('main').getByText('Projects', { exact: true })).toBeVisible();
  });

  test('Test 8: invoices free plan paywall triggers', async ({ page }) => {
    await gotoApp(page, '/invoices');
    await expect(page.locator('text=Invoicing is a Starter feature')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Move to Starter' })).toBeVisible();
  });

  test('Test 9: webhooks free plan paywall triggers', async ({ page }) => {
    await gotoApp(page, '/settings/webhooks');
    await expect(page.getByRole('heading', { name: 'Webhooks', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /View plans/i })).toBeVisible();
  });

  test('Test 10: global timer interface present', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('button', { name: 'Start timer', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log completed work', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Schedule work/i }).first()).toBeVisible();
  });

  test('Test 10b: first setup repairs a workspace with no manager', async ({ page }) => {
    const login = await requestGetApp(page, '/api/test/login?plan=free&role=member&clean=true');
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
    const login = await requestGetApp(page, `/api/test/login?plan=free&role=member&email=kevin%40tkoresearch.com&workspace=${workspace}&clean=true`);
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
    const login = await requestGetApp(page, `/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(login.ok()).toBeTruthy();
    const loginData = await login.json();
    expect(loginData.success).toBe(true);

    await gotoApp(page, '/dashboard');
    await page.locator('summary').filter({ hasText: 'Workspace setup and shortcuts' }).click();
    await expect(page.getByText('Setup checklist')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByText('Setup hidden')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Resume setup' }).click();
    await expect(page.getByText('Setup checklist')).toBeVisible({ timeout: 15_000 });
  });
});
