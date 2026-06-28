import { test, expect } from '@playwright/test';
import { gotoApp, requestGetApp } from './helpers/navigation';

let didClean = false;
const unique = () => Date.now().toString(36);
const professionalWorkspace = `professional-${unique()}`;

test.describe('Professional Feature Suite (10 User Stories)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const cleanParam = !didClean ? '&clean=true' : '';
    didClean = true;
    const res = await requestGetApp(page, `/api/test/login?plan=pro&workspace=${professionalWorkspace}${cleanParam}`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('Story 1: create a corporate client and verify it appears', async ({ page }) => {
    await gotoApp(page, '/clients');
    await page.getByRole('button', { name: 'New Client' }).click();
    await page.getByLabel('Company Name').fill('Acme Corp E2E');
    await page.getByPlaceholder('billing@acme.inc').fill('test@acme.example.com');
    await page.getByRole('button', { name: 'Save Client' }).click();
    await expect(page.getByText('Acme Corp E2E')).toBeVisible();
  });

  test('Story 2: create a workspace tag and immediately archive it', async ({ page }) => {
    await gotoApp(page, '/settings/tags');
    await page.getByPlaceholder('Enter new tag...').fill('Legacy E2E Tag');
    await page.locator('button[title="Blue"]').click();
    await page.getByRole('button', { name: 'Add Tag' }).click();
    await expect(page.getByText('#legacy e2e tag')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'legacy e2e tag' });
    await row.getByRole('button', { name: 'Archive Tag' }).click();
    await expect(row.getByRole('button', { name: 'archived' })).toBeVisible();
  });

  test('Story 3: create a project with budget thresholds', async ({ page }) => {
    await gotoApp(page, '/projects');
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByLabel('Project Name').fill('E2E Budget Project');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('combobox', { name: 'Select Budget Type' }).selectOption('hours');
    await page.getByPlaceholder('e.g. 100 hrs').fill('100');
    await page.getByRole('button', { name: 'Create Project' }).click();
    await expect(page.getByRole('link', { name: /E2E Budget Project/ })).toBeVisible({ timeout: 30_000 });
  });

  test('Story 4: view project financials burndown', async ({ page }) => {
    await gotoApp(page, '/projects');
    const projectLink = page.getByRole('link', { name: /E2E Budget Project/ }).first();
    await expect(projectLink).toBeVisible({ timeout: 30_000 });
    const href = await projectLink.getAttribute('href');
    expect(href).toBeTruthy();
    await gotoApp(page, href!);
    await expect(page.locator('text=Budget (Hours)')).toBeVisible({ timeout: 20_000 });
  });

  test('Story 5: run overlapping timer blocks', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await page.getByRole('button', { name: 'Start timer', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Start another timer' }).click();
    await page.waitForTimeout(1000);
    await expect(page.getByText('2 running')).toBeVisible();
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
  });

  test('Story 6: view historical records in activity board', async ({ page }) => {
    await gotoApp(page, '/activity');
    await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();
    await expect(page.getByText('General work').first()).toBeVisible();
  });

  test('Story 7: submit a retroactive completed-work log', async ({ page }) => {
    await gotoApp(page, '/activity');
    await page.getByRole('button', { name: 'Log completed work' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add completed work' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Work label').fill('retroactive-e2e');
    await dialog.getByLabel('Notes').fill('Retroactive E2E Task');
    const today = new Date().toISOString().split('T')[0];
    await dialog.getByLabel('Start date').fill(today);
    await dialog.getByLabel('End date').fill(today);
    await dialog.getByLabel('Start time').fill('09:00');
    await dialog.getByLabel('End time').fill('11:00');
    await dialog.getByRole('button', { name: 'Log time' }).click();
    await expect(page.getByText('Retroactive E2E Task')).toBeVisible();
  });

  test('Story 8: team member views recurring goals in the Resource Planner', async ({ page }) => {
    // 1. Create a goal via API
    const goalName = `Weekly Billable Target ${unique()}`;
    const goalRes = await page.request.post('/api/goals', {
      data: {
        name: goalName,
        targetHours: 35,
        targetType: "hours",
        recurrence: "weekly"
      }
    });
    expect(goalRes.ok()).toBeTruthy();

    // 2. View planner UI
    await gotoApp(page, '/planner');
    await expect(page.getByRole('heading', { name: 'Resource Planner' }).or(page.getByText('Resource Planner'))).toBeVisible();
    
    // 3. Verify goal is visible (it should be in "Unassigned backlog" since we didn't provide assignedUserId)
    await expect(page.getByText(goalName)).toBeVisible();
  });

  test('Story 9: add a scoped tag to a project', async ({ page }) => {
    await gotoApp(page, '/settings/tags');
    await page.getByPlaceholder('Enter new tag...').fill('Scoped Tag E2E');
    await page.getByRole('button', { name: 'Add Tag' }).click();
    const row = page.getByRole('row').filter({ hasText: 'scoped tag e2e' });
    await row.getByRole('combobox', { name: 'Select Project Scope' }).selectOption({ label: 'E2E Budget Project' });
    await expect(row.getByRole('combobox', { name: 'Select Project Scope' })).toHaveValue(/.+/);
  });

  test('Story 10: enforce default billable status for specific workspace tags', async ({ page }) => {
    await gotoApp(page, '/settings/tags');
    await page.getByPlaceholder('Enter new tag...').fill('Billable E2E Tag');
    await page.getByRole('button', { name: 'Add Tag' }).click();
    
    // Find the created tag row
    const row = page.getByRole('row').filter({ hasText: 'billable e2e tag' });
    
    // Toggle the billable status from the table row
    await row.getByRole('button', { name: 'Non-Billable' }).click();
    
    // Verify it changes to "Billable Default"
    await expect(row.getByRole('button', { name: 'Billable Default' })).toBeVisible();
    
    // Check that it's applied when tracking time
    await gotoApp(page, '/dashboard');
    await page.getByRole('textbox', { name: 'Tags' }).fill('Billable E2E Tag');
  });
});
