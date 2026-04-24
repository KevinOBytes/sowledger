import { test, expect } from '@playwright/test';

let didClean = false;
const unique = () => Date.now().toString(36);

test.describe('Professional Feature Suite (10 User Stories)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const cleanParam = !didClean ? '&clean=true' : '';
    didClean = true;
    const res = await page.goto(`/api/test/login?plan=pro${cleanParam}`);
    const data = await res?.json();
    expect(data?.success).toBe(true);
  });

  test('Story 1: create a corporate client and verify it appears', async ({ page }) => {
    await page.goto('/clients');
    await page.getByRole('button', { name: 'New Client' }).click();
    await page.getByLabel('Company Name').fill('Acme Corp E2E');
    await page.getByPlaceholder('billing@acme.inc').fill('test@acme.example.com');
    await page.getByRole('button', { name: 'Save Client' }).click();
    await expect(page.getByText('Acme Corp E2E')).toBeVisible();
  });

  test('Story 2: create a workspace tag and immediately archive it', async ({ page }) => {
    await page.goto('/settings/tags');
    await page.getByPlaceholder('Enter new tag...').fill('Legacy E2E Tag');
    await page.locator('button[title="Blue"]').click();
    await page.getByRole('button', { name: 'Add Tag' }).click();
    await expect(page.getByText('#legacy e2e tag')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'legacy e2e tag' });
    await row.getByRole('button', { name: 'Archive Tag' }).click();
    await expect(row.getByRole('button', { name: 'archived' })).toBeVisible();
  });

  test('Story 3: create a project with budget thresholds', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByLabel('Project Name').fill('E2E Budget Project');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select Budget Type' }).selectOption('hours');
    await page.getByPlaceholder('e.g. 100 hrs').fill('100');
    await page.getByRole('button', { name: 'Create Project' }).click();
    await expect(page.getByRole('link', { name: /E2E Budget Project/ })).toBeVisible();
  });

  test('Story 4: view project financials burndown', async ({ page }) => {
    await page.goto('/projects');
    await page.getByRole('link', { name: /E2E Budget Project/ }).first().click();
    await expect(page.locator('text=Budget (Hours)')).toBeVisible();
  });

  test('Story 5: run overlapping timer blocks', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByRole('button', { name: 'Start timer' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Start another timer' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('2 running')).toBeVisible();
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
  });

  test('Story 6: view historical records in activity board', async ({ page }) => {
    await page.goto('/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByText('TASK-1').first()).toBeVisible();
  });

  test('Story 7: submit a retroactive manual time log', async ({ page }) => {
    await page.goto('/activity');
    await page.getByRole('button', { name: 'Log manual time' }).click();
    await page.getByLabel('Work reference').fill('retroactive-e2e');
    await page.getByLabel('Notes').fill('Retroactive E2E Task');
    const today = new Date().toISOString().split('T')[0];
    await page.getByLabel('Start date').fill(today);
    await page.getByLabel('End date').fill(today);
    await page.getByLabel('Start time').fill('09:00');
    await page.getByLabel('End time').fill('11:00');
    await page.getByRole('button', { name: 'Log time' }).click();
    await expect(page.getByText('Retroactive E2E Task')).toBeVisible();
  });

  test('Story 8: calendar schedules a planned work block', async ({ page }) => {
    const title = `Calendar E2E ${unique()}`;
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Schedule work' }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save planned block' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
  });

  test('Story 9: add a scoped tag to a project', async ({ page }) => {
    await page.goto('/settings/tags');
    await page.getByPlaceholder('Enter new tag...').fill('Scoped Tag E2E');
    await page.getByRole('button', { name: 'Add Tag' }).click();
    const row = page.getByRole('row').filter({ hasText: 'scoped tag e2e' });
    await row.getByRole('combobox', { name: 'Select Project Scope' }).selectOption({ label: 'E2E Budget Project' });
    await expect(row.getByRole('combobox', { name: 'Select Project Scope' })).toHaveValue(/.+/);
  });

  test('Story 10: complete filtered export is available', async ({ page }) => {
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: 'Complete and filtered data exports' })).toBeVisible();
    await page.getByLabel('Format').selectOption('csv');
    const response = await page.request.get('/api/export/csv?format=csv&include=projects,timeEntries');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['x-billabled-export-sha256']).toBeTruthy();
  });
});
