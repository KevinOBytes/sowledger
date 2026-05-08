import { test, expect } from '@playwright/test';
import { gotoApp, requestGetApp } from './helpers/navigation';

async function expectWorkflowStage(page: import('@playwright/test').Page, stage: string) {
  const workflow = page.locator('section[aria-label="Billabled workflow"]');
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
    await expect(page.getByRole('heading', { level: 1, name: 'Recover revenue. Prove every invoice.' })).toBeVisible();
    await expect(page.getByLabel('Billabled capability navigation')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Invoice Proof Packs', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retainer Leak Radar', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Client Sign-Off Portal', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Missing Billable Recovery', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Developer/Agency Integration Layer', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The work path ends in proof, not a timesheet dump.' })).toBeVisible();
    await expect(page.getByText('read:proof-packs')).toBeVisible();
    await expect(page.getByText('read:revenue-intelligence')).toBeVisible();
    await expect(page.getByRole('img', { name: /Billabled invoice proof pack screenshot/i }).first()).toBeVisible();
    await expect(page.getByRole('img', { name: /Billabled analytics screenshot/i }).first()).toBeVisible();
    await expect(page.getByRole('img', { name: /Billabled client sign-off portal screenshot/i }).first()).toBeVisible();
    await expect(page.getByText('Real screens for the work customers pay for.')).toBeVisible();
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /billabled-og\.png/);
    for (const asset of [
      '/images/marketing/invoice-proof-pack.png',
      '/images/marketing/revenue-radar.png',
      '/images/marketing/client-signoff-portal.png',
      '/images/marketing/billabled-og.png',
    ]) {
      const image = await page.request.get(asset);
      expect(image.ok()).toBeTruthy();
      expect(image.headers()['content-type']).toContain('image/png');
    }
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
    await expect(page.getByRole('heading', { level: 1, name: 'Get help moving work into invoice proof.' })).toBeVisible();
    await expect(page.getByText('Plan work', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Track live timers', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Log manual/calendar time', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Review analytics', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Approve/invoice/export', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Integrate by API', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Proof Packs' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recovery Radar' }).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sign-Off' }).first()).toBeVisible();

    await gotoApp(page, '/support/api');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { name: 'Build on Billabled.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API extends the workflow' })).toBeVisible();
    await expect(page.getByText(/oauth2-bearer/).first()).toBeVisible();
    await expect(page.getByText('/api/v1/proof-packs?invoiceId=...')).toBeVisible();
    await expect(page.getByText('/api/v1/revenue-intelligence').first()).toBeVisible();

    await gotoApp(page, '/security');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Security posture for proof-backed billing.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workspace isolation' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'API key lifecycle' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Billing boundary' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Export integrity' })).toBeVisible();
    await expect(page.getByText('No secrets, tokens, or card data')).toBeVisible();

    await gotoApp(page, '/billing-policy');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Billing and refund policy' })).toBeVisible();
    await expect(page.getByText('Last updated May 4, 2026')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Checkout boundary' })).toBeVisible();
    await expect(page.getByText('Starter: $9/month')).toBeVisible();

    await gotoApp(page, '/privacy');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
    await expect(page.getByText('API key secrets are shown once and stored only as hashes.')).toBeVisible();

    await gotoApp(page, '/terms');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of service' })).toBeVisible();
    await expect(page.getByText('Do not abuse public APIs')).toBeVisible();

    await gotoApp(page, '/contact');
    await expect(page).not.toHaveURL(/.*\/login/);
    await expect(page.getByRole('heading', { level: 1, name: 'Contact Billabled with the right context.' })).toBeVisible();
    await expect(page.getByText('Never send API keys or bearer tokens.')).toBeVisible();
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
    const res = await requestGetApp(page, `/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
    await gotoApp(page, '/dashboard');
    await expect(page).toHaveURL(/.*\/dashboard/);
  });

  test('Test 5: dashboard renders app layout', async ({ page }) => {
    await expect(page.getByText('Today’s command center')).toBeVisible();
    await expectVisibleMainText(page, 'Focused timer');
    await expectVisibleMainText(page, 'Planning queue');
    await expectVisibleMainText(page, 'Concurrent timer stack');
    await expectWorkflowStage(page, 'Track');
    await expect(page.getByRole('link', { name: /Billabled/i })).toBeVisible();
  });

  test('Test 5b: redesigned internal workflow spine marks each app stage', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await expect(page.getByRole('heading', { name: 'Today’s command center' })).toBeVisible();
    await expectVisibleMainText(page, 'Focused timer');
    await expectVisibleMainText(page, 'Planning queue');
    await expectVisibleMainText(page, 'Concurrent timer stack');
    await expectWorkflowStage(page, 'Track');

    await gotoApp(page, '/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expectWorkflowStage(page, 'Review');

    await gotoApp(page, '/reports');
    await expect(page.getByRole('heading', { name: 'Work performance and billable output' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Retainer Leak Radar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Missing Billable Recovery' })).toBeVisible();
    await expectWorkflowStage(page, 'Review');

    await gotoApp(page, '/exports');
    await expect(page.getByRole('heading', { name: 'Complete and filtered data exports' })).toBeVisible();
    await expect(page.getByText('x-billabled-export-sha256')).toBeVisible();
    await expectWorkflowStage(page, 'Approve / Invoice / Export');

    await gotoApp(page, '/settings/developers');
    await expect(page.getByRole('heading', { name: 'Agency integrations, API keys, usage, and docs' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create API key' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Workspace keys' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent API requests' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Security boundary' })).toBeVisible();
    await expectWorkflowStage(page, 'Integrate');
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
    await expect(page.getByText('Setup checklist')).toBeVisible();
    await page.getByRole('button', { name: 'Skip for now' }).click();
    await expect(page.getByText('Setup hidden')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Resume setup' }).click();
    await expect(page.getByText('Setup checklist')).toBeVisible({ timeout: 15_000 });
  });
});
