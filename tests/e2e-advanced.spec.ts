import { test, expect } from '@playwright/test';
import { gotoApp, requestGetApp } from './helpers/navigation';

const unique = () => Date.now().toString(36);

test.describe('Deep Authenticated Workflows', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    const workspace = `advanced-${unique()}`;
    const res = await requestGetApp(page, `/api/test/login?plan=free&workspace=${workspace}&clean=true`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('Test 11: schedule a work block from dashboard', async ({ page }) => {
    const title = `Dashboard Plan ${unique()}`;
    await gotoApp(page, '/dashboard');
    await page.getByRole('button', { name: /Schedule work/i }).first().click();
    await page.getByLabel('Title').fill(title);
    await page.getByRole('button', { name: 'Save scheduled work' }).click();
    await expect(page.getByText(title)).toBeVisible();
  });

  test('Test 12: create a project and task in Kanban board', async ({ page }) => {
    const projectName = `Kanban Test ${unique()}`;
    await gotoApp(page, '/projects');
    await page.getByRole('button', { name: 'New Project' }).click();
    await page.getByLabel('Project Name').fill(projectName);
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Create Project' }).click();
    const projectLink = page.getByRole('link', { name: new RegExp(projectName) });
    await expect(projectLink).toBeVisible({ timeout: 30_000 });
    const projectHref = await projectLink.getAttribute('href');
    expect(projectHref).toBeTruthy();
    await gotoApp(page, projectHref!);
    await page.locator('.w-80').filter({ hasText: 'To Do' }).getByRole('button').first().click();
    await page.getByPlaceholder('What needs to be done?').fill('E2E Generated Task');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('E2E Generated Task')).toBeVisible();
  });

  test('Test 13: calendar planning surface renders', async ({ page }) => {
    await gotoApp(page, '/calendar');
    await expect(page.getByRole('heading', { level: 1, name: 'Calendar', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: /Schedule/i })).toBeVisible();
  });

  test('Test 13b: calendar drag selection creates and keyboard-reschedules work', async ({ page }) => {
    const title = `Drag Calendar ${unique()}`;
    await gotoApp(page, '/calendar');
    await expect(page.getByText('Loading calendar...')).toBeHidden({ timeout: 20_000 });
    const slot = page.locator('[data-calendar-slot="true"]').first();
    await expect(slot).toBeVisible({ timeout: 20_000 });
    await slot.scrollIntoViewIfNeeded();

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
    let blockStart: string | null = null;
    await expect.poll(async () => {
      const scheduled = await page.request.get('/api/schedule?status=planned');
      if (!scheduled.ok()) return false;
      const scheduledData = await scheduled.json();
      const block = scheduledData.blocks.find((item: { title?: string; startsAt?: string }) => item.title === title);
      blockStart = block?.startsAt ?? null;
      return Boolean(blockStart);
    }, { timeout: 20_000 }).toBe(true);

    const blockCard = page.getByTestId('calendar-block').filter({ hasText: title }).first();
    await expect(blockCard).toBeVisible({ timeout: 20_000 });
    await blockCard.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => {
      const response = await page.request.get('/api/schedule?status=planned');
      const data = await response.json();
      return data.blocks.some((item: { title?: string; startsAt?: string }) => item.title === title && item.startsAt !== blockStart);
    }, { timeout: 20_000 }).toBe(true);
  });

  test('Test 14: planner visualization renders', async ({ page }) => {
    await gotoApp(page, '/planner');
    await expect(page.getByRole('heading', { level: 1, name: 'Resource Planner' })).toBeVisible();
    await expect(page.getByText('Total Backlog Output')).toBeVisible();
  });

  test('Test 15: analytics dashboard maps telemetry', async ({ page }) => {
    await gotoApp(page, '/reports');
    await expect(page.getByRole('heading', { name: 'Work performance and billable output' })).toBeVisible();
    await expect(page.getByText('Logged hours', { exact: true })).toBeVisible();
    await expect(page.getByText('Billable pipeline', { exact: true })).toBeVisible();
  });

  test('Test 16: client route blocks member access', async ({ page }) => {
    await gotoApp(page, '/client');
    await expect(page).toHaveURL(/.*(\/dashboard|\/login)/);
  });

  test('Test 17: approvals pipeline renders for managers', async ({ page }) => {
    await gotoApp(page, '/approvals');
    await expect(page.getByRole('heading', { level: 1, name: 'Timesheet Approvals' })).toBeVisible();
    await expect(page.getByText('All caught up!').or(page.getByText('Duration').first())).toBeVisible();
  });

  test('Test 18: Studio plan accesses invoices properly', async ({ page }) => {
    const login = await requestGetApp(page, '/api/test/login?plan=smb');
    expect(login.ok()).toBeTruthy();
    await gotoApp(page, '/invoices');
    await expect(page.locator('text=Approved Billables Pipeline')).toBeVisible();
    await expect(page.locator('text=Invoicing is a Starter feature')).not.toBeVisible();
  });

  test('Test 19: export center returns digest header', async ({ page }) => {
    await gotoApp(page, '/exports');
    await expect(page.getByRole('heading', { name: 'Complete and filtered data exports' })).toBeVisible();
    const response = await page.request.get('/api/export/csv?format=json');
    expect(response.ok()).toBeTruthy();
    expect(response.headers()['x-billabled-export-sha256']).toBeTruthy();
  });

  test('Test 20: developers page creates a scoped API key once', async ({ page }) => {
    await gotoApp(page, '/settings/developers');
    await expect(page.getByRole('heading', { name: 'Agency integrations, API keys, usage, and docs' })).toBeVisible();
    await expect(page.getByText('read:proof-packs')).toBeVisible();
    await expect(page.getByText('read:revenue-intelligence')).toBeVisible();
    await page.getByLabel('Name').fill(`E2E API Key ${unique()}`);
    await page.getByRole('button', { name: 'Create API key' }).click();
    await expect(page.getByText('New API key. It is shown only once.')).toBeVisible();
  });

  test('Test 21: integration endpoints reject unsafe cross-boundary input', async ({ page }) => {
    const login = await requestGetApp(page, '/api/test/login?plan=smb');
    expect(login.ok()).toBeTruthy();

    const unsafeWebhook = await page.request.post('/api/webhooks', {
      data: { url: 'https://127.0.0.1/internal', events: ['time.created'] },
    });
    expect(unsafeWebhook.status()).toBe(400);

    const unsafeIpv6Webhook = await page.request.post('/api/webhooks', {
      data: { url: 'https://[::1]/internal', events: ['time.created'] },
    });
    expect(unsafeIpv6Webhook.status()).toBe(400);

    const unsafeMappedIpv6Webhook = await page.request.post('/api/webhooks', {
      data: { url: 'https://[::ffff:7f00:1]/internal', events: ['time.created'] },
    });
    expect(unsafeMappedIpv6Webhook.status()).toBe(400);

    const secretWebhookPath = 'hooks/super-secret-token';
    const safeWebhook = await page.request.post('/api/webhooks', {
      data: { url: `https://1.1.1.1/${secretWebhookPath}`, events: ['time.created'] },
    });
    expect(safeWebhook.ok()).toBeTruthy();
    const safeWebhookBody = await safeWebhook.json();
    expect(safeWebhookBody.webhook.maskedUrl).toBe('https://1.1.1.1/...');
    expect(JSON.stringify(safeWebhookBody)).not.toContain(secretWebhookPath);

    const listedWebhooks = await page.request.get('/api/webhooks');
    expect(listedWebhooks.ok()).toBeTruthy();
    expect(JSON.stringify(await listedWebhooks.json())).not.toContain(secretWebhookPath);

    const invalidAssigneeImport = await page.request.post('/api/integrations/calendar/import', {
      data: {
        provider: 'google',
        assigneeUserId: 'not-a-workspace-member',
        events: [{ id: 'security-e2e', title: 'Security E2E', startsAt: '2026-05-04T09:00:00.000Z', endsAt: '2026-05-04T10:00:00.000Z' }],
      },
    });
    expect(invalidAssigneeImport.status()).toBe(400);

    await gotoApp(page, '/integrations');
    await expect(page.getByRole('heading', { name: 'Connect the systems around Billabled' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Google Calendar' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Slack alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'QuickBooks Online' })).toBeVisible();

    const integrations = await page.request.get('/api/integrations');
    expect(integrations.ok()).toBeTruthy();
    const integrationsBody = await integrations.json();
    expect(integrationsBody.readiness).toBeTruthy();

    const syncWithoutConnection = await page.request.post('/api/integrations/google-calendar/sync', { data: {} });
    expect(syncWithoutConnection.status()).toBe(400);

    const unsafeSlackWebhook = await page.request.post('/api/integrations/slack/manual', {
      data: { webhookUrl: 'https://127.0.0.1/services/test', channelLabel: '#ops' },
    });
    expect(unsafeSlackWebhook.status()).toBe(400);

    const quickBooksWithoutConnection = await page.request.post('/api/integrations/quickbooks/push-invoice', {
      data: { invoiceId: 'missing-invoice' },
    });
    expect(quickBooksWithoutConnection.status()).toBe(400);
  });

  test('Test 22: managers cannot promote other members to elevated roles', async ({ page }) => {
    const workspace = `rbac-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const memberLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=member&email=member-${workspace}%40example.com&workspace=${workspace}`);
    expect(memberLogin.ok()).toBeTruthy();
    const managerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=manager&email=manager-${workspace}%40example.com&workspace=${workspace}`);
    expect(managerLogin.ok()).toBeTruthy();

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
