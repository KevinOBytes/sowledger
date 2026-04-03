import { test, expect } from '@playwright/test';

let didClean = false;

test.describe('Professional Feature Suite (10 User Stories)', () => {
  // We use sequential execution here to ensure DB mutations (creating a client, a project, a tag) 
  // can predictably carry over or not disrupt concurrent test assertions on the same user session.
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    // Authenticate with a standard pro plan so we have access to all features (like invoicing/financials)
    const cleanParam = !didClean ? '&clean=true' : '';
    didClean = true;
    
    const res = await page.goto(`/api/test/login?plan=pro${cleanParam}`);
    const data = await res?.json();
    expect(data?.success).toBe(true);
    await page.goto('/dashboard');
  });

  // -------------------------------------------------------------------------
  // 1. Client Management
  // -------------------------------------------------------------------------
  test('Story 1: Create a corporate client and verify it appears', async ({ page }) => {
    await page.goto('/clients');
    
    // Check if the new client button exists and click it
    await page.getByRole('button', { name: 'New Client' }).click();

    // Fill the modal
    await page.getByLabel('Company Name').fill('Acme Corp E2E');
    await page.getByPlaceholder('billing@acme.inc').fill('test@acme.example.com');
    await page.getByRole('button', { name: 'Save Client' }).click();

    // The modal should close and the new client should be visible
    await expect(page.locator('text=Acme Corp E2E')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 2. Entity Archiving
  // -------------------------------------------------------------------------
  test('Story 2: Create a workspace tag and immediately archive it', async ({ page }) => {
    await page.goto('/settings/tags');

    // Create a new tag
    await page.getByPlaceholder('New Tag Name').fill('Legacy E2E Tag');
    // Select the first color swatch
    await page.locator('button[title="Blue"]').click();
    await page.getByRole('button', { name: 'Add Tag' }).click();

    // Verify it exists in the active view
    await expect(page.locator('text=Legacy E2E Tag')).toBeVisible();

    // Archive it
    const tableRow = page.locator('tr').filter({ hasText: 'Legacy E2E Tag' });
    await tableRow.getByRole('button', { name: 'Archive Tag' }).click();
    
    // The tag should now be archived (opacity reduced). Wait a brief moment.
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // 3. Budget Envelopes
  // -------------------------------------------------------------------------
  test('Story 3: Create a project with financial budget thresholds', async ({ page }) => {
    await page.goto('/projects');
    
    // Click New Project
    await page.getByRole('button', { name: 'New Project' }).click();
    
    await page.getByLabel('Project Name').fill('E2E Budget Project');
    await page.getByRole('button', { name: 'Next', exact: true }).click();

    await page.getByRole('combobox', { name: 'Select Budget Type' }).selectOption('hours');
    await page.getByPlaceholder('e.g. 100 hrs').fill('100');
    
    await page.getByRole('button', { name: 'Create Project' }).click();

    // Wait for success
    await expect(page.locator('h3').filter({ hasText: 'E2E Budget Project' }).first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 4. Project Financials View
  // -------------------------------------------------------------------------
  test('Story 4: View project financials burndown', async ({ page }) => {
    await page.goto('/projects');
    
    // Click on the newly created project
    await page.locator('a', { hasText: 'E2E Budget Project' }).first().click();
    
    // We expect the Project Financials component to be rendered
    await expect(page.locator('text=Budget (Hours)')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 5. Concurrent Timekeeping
  // -------------------------------------------------------------------------
  test('Story 5: Log overlapping timer blocks', async ({ page }) => {
    await page.goto('/dashboard');

    // Start timer 1
    await page.getByRole('button', { name: 'Start Session' }).click();
    await page.waitForTimeout(1000);

    // Start timer 2
    await page.getByRole('button', { name: 'Start Concurrent Timer' }).click();
    await page.waitForTimeout(1000);

    // Wait until we have 2 Live
    await expect(page.locator('text=2 Live')).toBeVisible();

    // Stop hero timer 
    await page.getByRole('button', { name: 'Stop Logging' }).click();
    await page.waitForTimeout(1000);
    // The secondary timer becomes the primary, we stop it again
    await page.getByRole('button', { name: 'Stop Logging' }).click();
  });

  // -------------------------------------------------------------------------
  // 6. Activity Board
  // -------------------------------------------------------------------------
  test('Story 6: View historical records in activity board', async ({ page }) => {
    // Ensure the timers logged
    await page.goto('/activity');
    await expect(page.getByRole('heading', { level: 1, name: 'Activity' })).toBeVisible();
    
    // Verify our recently stopped tasks exist in the table (default description is "Focus block")
    await expect(page.locator('text=Focus block').first()).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 7. Manual Log Recovery
  // -------------------------------------------------------------------------
  test('Story 7: Submit a retroactive manual time log', async ({ page }) => {
    await page.goto('/activity');
    
    // Click Log Manual Time
    await page.getByRole('button', { name: 'Log Manual Time' }).click();

    // Identify a task input in manual log
    await page.getByLabel('Description').fill('Retroactive E2E Task');
    
    // Fill Date and times
    // Date fields might be native inputs, we fill them. Format YYYY-MM-DD
    const today = new Date().toISOString().split('T')[0];
    await page.getByLabel('Start Date').fill(today);
    await page.getByLabel('End Date').fill(today);
    
    // Times HH:MM
    await page.getByLabel('Start Time').fill('09:00');
    await page.getByLabel('End Time').fill('11:00');

    await page.getByRole('button', { name: 'Save Manual Entry' }).click();

    // Find it in the activity list
    await expect(page.locator('text=Retroactive E2E Task')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 8. Goal Alignment (Planner)
  // -------------------------------------------------------------------------
  test('Story 8: Goals display alongside resource planning', async ({ page }) => {
    // Create a goal first from the dashboard preference modal
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Workspace Preferences/i }).click();
    const goalInput = page.locator('#newGoalName');
    await goalInput.waitFor({ state: 'visible' });
    await goalInput.fill('Q4 Target Goal E2E');
    await goalInput.press('Enter');
    // Wait a brief moment for it to save and appear
    await page.waitForTimeout(1000);

    // Go to planner
    await page.goto('/planner');
    
    // Wait for data
    await expect(page.locator('text=Q4 Target Goal E2E')).toBeVisible();
  });

  // -------------------------------------------------------------------------
  // 9. Project-Scoped Tags
  // -------------------------------------------------------------------------
  test('Story 9: Add a scoped tag to a project and assign it from dashboard', async ({ page }) => {
    // 1. Create a tag mapped to E2E Budget Project
    await page.goto('/settings/tags');
    await page.getByPlaceholder('New Tag Name').fill('Scoped Tag E2E');
    await page.getByRole('button', { name: 'Add Tag' }).click();
    
    // There should be a project selector
    const tableRow = page.locator('tr').filter({ hasText: 'Scoped Tag E2E' });
    await tableRow.getByRole('combobox', { name: 'Select Project Scope' }).selectOption({ label: 'E2E Budget Project' });
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // 10. Default Billable Toggles
  // -------------------------------------------------------------------------
  test('Story 10: Create a default billable tag and assign it', async ({ page }) => {
    // 1. Create billable tag
    await page.goto('/settings/tags');
    await page.getByPlaceholder('New Tag Name').fill('Auto Billable Tag');
    await page.getByRole('button', { name: 'Add Tag' }).click();
    
    // Toggle the switch for billable default (default is true)
    const tableRow = page.locator('tr').filter({ hasText: 'Auto Billable Tag' });
    // Click the Billable Default button which will toggle it to Non-Billable
    await tableRow.getByText('Billable Default').click();

    // Verify it changed to Non-Billable
    await expect(tableRow.getByText('Non-Billable')).toBeVisible();
  });

});
