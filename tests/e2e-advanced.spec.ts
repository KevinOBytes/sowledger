import { test, expect } from '@playwright/test';

const unique = () => Date.now().toString(36);

test.describe('Deep Authenticated Workflows', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const workspace = `advanced-${unique()}`;
    const res = await page.goto(`/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    const data = await res?.json();
    expect(data?.success).toBe(true);
  });

  test('Test 11: schedule a work block from dashboard', async ({ page }) => {
    const title = `Dashboard Plan ${unique()}`;
    await page.goto('/dashboard');
    await page.getByRole('button', { name: /Schedule work/i }).first().click();
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save scheduled work' }).click();
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

  test('Test 13b: calendar drag selection creates and reschedules work', async ({ page }) => {
    const title = `Drag Calendar ${unique()}`;
    await page.goto('/calendar');
    const slot = page.locator('[data-calendar-slot="true"]').first();
    await expect(slot).toBeVisible();

    const slotBox = await slot.boundingBox();
    expect(slotBox).toBeTruthy();
    await page.mouse.move(slotBox!.x + slotBox!.width / 2, slotBox!.y + 8);
    await page.mouse.down();
    await page.mouse.move(slotBox!.x + slotBox!.width / 2, slotBox!.y + 132, { steps: 4 });
    await page.mouse.up();

    await expect(page.getByRole('dialog', { name: 'Create calendar work block' })).toBeVisible();
    await page.getByRole('button', { name: 'Plan work' }).click();
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save scheduled work' }).click();
    await expect(page.getByText(title).first()).toBeVisible();

    const handle = page.getByRole('button', { name: new RegExp(`Drag to reschedule ${title}`) }).first();
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + 110, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Move scheduled work' })).toBeVisible();
    await page.getByRole('button', { name: 'Move block' }).click();
    await expect(page.getByText(title).first()).toBeVisible();
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

  test('Test 21: integration endpoints reject unsafe cross-boundary input', async ({ page }) => {
    await page.goto('/api/test/login?plan=smb');

    const unsafeWebhook = await page.request.post('/api/webhooks', {
      data: { url: 'https://127.0.0.1/internal', events: ['time.created'] },
    });
    expect(unsafeWebhook.status()).toBe(400);

    const unsafeIpv6Webhook = await page.request.post('/api/webhooks', {
      data: { url: 'https://[::1]/internal', events: ['time.created'] },
    });
    expect(unsafeIpv6Webhook.status()).toBe(400);

    const invalidAssigneeImport = await page.request.post('/api/integrations/calendar/import', {
      data: {
        provider: 'google',
        assigneeUserId: 'not-a-workspace-member',
        events: [{ id: 'security-e2e', title: 'Security E2E', startsAt: '2026-05-04T09:00:00.000Z', endsAt: '2026-05-04T10:00:00.000Z' }],
      },
    });
    expect(invalidAssigneeImport.status()).toBe(400);
  });

  test('Test 22: managers cannot promote other members to elevated roles', async ({ page }) => {
    const workspace = `rbac-${unique()}`;
    await page.goto(`/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    await page.goto(`/api/test/login?plan=smb&role=member&email=member-${workspace}%40example.com&workspace=${workspace}`);
    await page.goto(`/api/test/login?plan=smb&role=manager&email=manager-${workspace}%40example.com&workspace=${workspace}`);

    const people = await page.request.get('/api/people');
    expect(people.ok()).toBeTruthy();
    const body = await people.json();
    const member = body.people.find((person: { email?: string; id: string }) => person.email === `member-${workspace}@example.com`);
    expect(member?.id).toBeTruthy();

    const promote = await page.request.patch('/api/people', {
      data: { personId: member.id, workspaceRole: 'manager' },
    });
    expect(promote.status()).toBe(403);
  });
});
