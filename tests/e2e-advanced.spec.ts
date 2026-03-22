import { test, expect } from '@playwright/test';

test.describe('Deep Authenticated Workflows', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Authenticate with a standard free plan before each test unless specifically overridden
    const res = await page.goto('/api/test/login?plan=free');
    const data = await res?.json();
    expect(data?.success).toBe(true);
    await page.goto('/dashboard');
  });

  test('Test 11: Create a Project & Goal via Timer Dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Manage Projects, Goals & FX').click();
    await page.getByPlaceholder('Project name').fill('Automated E2E Project');
    await page.getByPlaceholder('Project name').press('Enter');
    
    // Verify success toast
    await expect(page.locator('text=Project "Automated E2E Project" created')).toBeVisible();
  });

  test('Test 12: Create a Task in Kanban Board', async ({ page }) => {
    // 1. Create a project
    await page.goto('/dashboard');
    await page.getByText('Manage Projects, Goals & FX').click();
    await page.getByPlaceholder('Project name').fill('Kanban Test Project');
    await page.locator('div').filter({ hasText: 'New Project' }).getByRole('button', { name: 'Add' }).first().click();
    await expect(page.locator('text=Project "Kanban Test Project" created')).toBeVisible();
    
    // 2. Go to projects, click project
    await page.goto('/projects');
    await page.getByText('Kanban Test Project').click(); // navigates to project
    
    // 3. Create task by clicking the plus icon in the TO DO column
    await page.locator('.w-80').filter({ hasText: 'To Do' }).getByRole('button').first().click();
    await page.getByPlaceholder('What needs to be done?').fill('E2E Generated Task');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E Generated Task')).toBeVisible();
  });

  test('Test 13: Goal Creation in Dashboard', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByText('Manage Projects, Goals & FX').click();
    await page.getByPlaceholder('Goal name').fill('E2E Automated Goal');
    await page.getByPlaceholder('Goal name').press('Enter');
    await expect(page.locator('text=Goal "E2E Automated Goal" created')).toBeVisible({ timeout: 15000 });
  });

  test('Test 14: Planner Visualization Renders', async ({ page }) => {
    await page.goto('/planner');
    await expect(page.getByRole('heading', { level: 1, name: 'Resource Planner' })).toBeVisible();
    await expect(page.getByText('Total Backlog Output')).toBeVisible();
  });

  test('Test 15: Reports Dashboard Maps Telemetry', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByRole('heading', { level: 1, name: 'Workforce Intelligence' })).toBeVisible();
    await expect(page.getByText('Total Logged Hours')).toBeVisible();
    await expect(page.getByText('Total Billable Pipeline')).toBeVisible();
  });

  test('Test 16: Client Segregation', async ({ page }) => {
    await page.goto('/client');
    // Members inherently get bounced to dashboard or remain on it, or trigger login wall
    await expect(page).toHaveURL(/.*(\/dashboard|\/login)/);
  });

  test('Test 17: Approvals Pipeline Renders for Managers', async ({ page }) => {
    await page.goto('/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet Approvals' })).toBeVisible();
    await expect(page.getByText('All caught up!').or(page.locator('text=Duration'))).toBeVisible();
  });

  test('Test 18: Enterprise/SMB Plan Accesses Invoices properly', async ({ page }) => {
    // Re-auth as SMB explicitly overcoming the global test hook
    await page.goto('/api/test/login?plan=smb');
    await page.goto('/invoices');
    await expect(page.locator('text=Approved Billables Pipeline')).toBeVisible();
    await expect(page.locator('text=Invoicing is a Pro feature')).not.toBeVisible();
  });

  test('Test 19: Dashboard Context Persistence', async ({ page }) => {
    await page.goto('/dashboard');
    await page.getByPlaceholder('focus, deep-work').fill('playwright-test');
    await expect(page.locator('span').filter({ hasText: '#playwright-test' })).toBeVisible();
  });

  test('Test 20: 404 Route on Authenticated State', async ({ page }) => {
    await page.goto('/dashboard/fake-route-for-testing');
    await expect(page.locator('text=404').or(page.locator('text=Not Found').or(page.locator('text=Could not find requested resource')))).toBeVisible();
  });

});
