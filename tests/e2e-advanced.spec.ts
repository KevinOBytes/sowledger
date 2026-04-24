import { test, expect } from '@playwright/test';

const unique = () => Date.now().toString(36);

test.describe('Deep Authenticated Workflows', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const res = await page.goto('/api/test/login?plan=free');
    const data = await res?.json();
    expect(data?.success).toBe(true);
  });

  test('Test 11: schedule a work block from dashboard', async ({ page }) => {
    const title = `Dashboard Plan ${unique()}`;
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Plan work/i }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('Test 12: create a project and task in Kanban board', async ({ page }) => {
    const projectName = `Kanban Test ${unique()}`;
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByLabel('Project Name').fill(projectName);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Create Project' }).click();
    await expect(page.getByRole('link', { name: new RegExp(projectName) })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(projectName) }).click();
    await page.locator('.w-80').filter({ hasText: 'To Do' }).getByRole('button').first().click();
    await page.getByPlaceholder('What needs to be done?').fill('E2E Generated Task');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E Generated Task')).toBeVisible();
  });

  test('Test 13: calendar planning surface renders', async ({ page }) => {
    await page.goto('/calendar');
    await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Schedule/i })).toBeVisible();
  });

  test('Test 14: planner visualization renders', async ({ page }) => {
    await page.goto('/planner');
    await expect(page.getByRole('heading', { level: 1, name: 'Resource Planner' })).toBeVisible();
    await expect(page.getByText('Total Backlog Output')).toBeVisible();
  });

  test('Test 15: analytics dashboard maps telemetry', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { name: 'Work performance and billable output' })).toBeVisible();
    await expect(page.getByText('Logged hours', { exact: true })).toBeVisible();
    await expect(page.getByText('Billable pipeline', { exact: true })).toBeVisible();
  });

  test('Test 16: client route blocks member access', async ({ page }) => {
    await page.goto('/client');
    await expect(page).toHaveURL(/.*(\/dashboard|\/login)/);
  });

  test('Test 17: approvals pipeline renders for managers', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet Approvals' })).toBeVisible();
    await expect(page.getByText('All caught up!').or(page.getByText('Duration').first())).toBeVisible();
  });

  test('Test 18: Studio plan accesses invoices properly', async ({ page }) => {
    await page.goto('/api/test/login?plan=smb');
    await page.goto('/invoices');
    await expect(page.locator('text=Approved Billables Pipeline')).toBeVisible();
    await expect(page.locator('text=Invoicing is a Starter feature')).not.toBeVisible();
  });

  test('Test 19: export center returns digest header', async ({ page }) => {
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: 'Complete and filtered data exports' })).toBeVisible();
    const response = await page.request.get('/api/export/csv?format=json');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['x-billabled-export-sha256']).toBeTruthy();
  });

  test('Test 20: developers page creates a scoped API key once', async ({ page }) => {
    await page.goto('/settings/developers');
    await expect(page.getByRole('heading', { name: 'API keys, usage, and docs' })).toBeVisible();
    await page.getByLabel('Name').fill(`E2E API Key ${unique()}`);
    await page.getByRole('button', { name: 'Create API key' }).click();
    await expect(page.getByText('New API key. It is shown only once.')).toBeVisible();
  });
});
