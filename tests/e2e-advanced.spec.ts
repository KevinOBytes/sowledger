import { test, expect } from '@playwright/test';
import 'dotenv/config';
import { and, eq } from 'drizzle-orm';
import { db } from '../lib/db';
import { clients, scheduledWorkBlocks, timeEntries, userActions } from '../lib/db/schema';
import { getPaidPlanById } from '../lib/billing-plans';
import { buildStripeCheckoutParams, hasActivePaidBilling } from '../lib/stripe-checkout';
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

  test('Test 23: client portal and signoff are limited to entitled client records', async ({ page }) => {
    const workspace = `client-portal-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();

    const clientResponse = await page.request.post('/api/clients', {
      data: { name: 'Entitled Client', email: `client-${workspace}@example.com` },
    });
    expect(clientResponse.ok()).toBeTruthy();
    const client = (await clientResponse.json()).client;
    await db
      .update(clients)
      .set({ email: `Client-${workspace}@Example.COM` })
      .where(and(eq(clients.id, client.id), eq(clients.workspaceId, ownerData.workspaceId)));

    const projectResponse = await page.request.post('/api/projects', {
      data: { name: 'Entitled Project', clientId: client.id, hourlyRate: 100 },
    });
    expect(projectResponse.ok()).toBeTruthy();
    const project = (await projectResponse.json()).project;

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Client Portal E2E', scopes: ['write:time'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const startedAt = '2026-05-01T13:00:00.000Z';
    const stoppedAt = '2026-05-01T14:00:00.000Z';
    const entryResponse = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        projectId: project.id,
        startedAt,
        stoppedAt,
        hourlyRate: 100,
        status: 'submitted',
      },
    });
    expect(entryResponse.ok()).toBeTruthy();
    const entry = (await entryResponse.json()).entry;

    const approveResponse = await page.request.post('/api/timer/approve', { data: { entryId: entry.id } });
    expect(approveResponse.ok()).toBeTruthy();

    const invoiceResponse = await page.request.post('/api/invoices', {
      data: { timeEntryIds: [entry.id], projectId: project.id },
    });
    expect(invoiceResponse.ok()).toBeTruthy();
    const invoice = (await invoiceResponse.json()).invoice;

    const unrelatedClientLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=client&email=other-${workspace}%40example.com&workspace=${workspace}`);
    expect(unrelatedClientLogin.ok()).toBeTruthy();
    const unrelatedPortal = await page.request.get('/api/client');
    expect(unrelatedPortal.ok()).toBeTruthy();
    const unrelatedPortalBody = await unrelatedPortal.json();
    expect(unrelatedPortalBody.projects).toEqual([]);
    expect(unrelatedPortalBody.invoices).toEqual([]);
    const unrelatedSignoff = await page.request.post('/api/client/signoff', { data: { invoiceId: invoice.id } });
    expect(unrelatedSignoff.status()).toBe(404);

    const entitledClientLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=client&email=client-${workspace}%40example.com&workspace=${workspace}`);
    expect(entitledClientLogin.ok()).toBeTruthy();
    const entitledPortal = await page.request.get('/api/client');
    expect(entitledPortal.ok()).toBeTruthy();
    const entitledPortalBody = await entitledPortal.json();
    expect(entitledPortalBody.projects.map((item: { id: string }) => item.id)).toContain(project.id);
    expect(entitledPortalBody.invoices.map((item: { id: string }) => item.id)).toContain(invoice.id);
    const entitledSignoff = await page.request.post('/api/client/signoff', { data: { invoiceId: invoice.id } });
    expect(entitledSignoff.ok()).toBeTruthy();
  });

  test('Test 24: client portal rejects mixed-client invoices even when one entry is entitled', async ({ page }) => {
    const workspace = `mixed-client-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();

    const entitledClientResponse = await page.request.post('/api/clients', {
      data: { name: 'Entitled Mixed Client', email: `client-${workspace}@example.com` },
    });
    expect(entitledClientResponse.ok()).toBeTruthy();
    const entitledClient = (await entitledClientResponse.json()).client;
    const unrelatedClientResponse = await page.request.post('/api/clients', {
      data: { name: 'Unrelated Mixed Client', email: `unrelated-${workspace}@example.com` },
    });
    expect(unrelatedClientResponse.ok()).toBeTruthy();
    const unrelatedClient = (await unrelatedClientResponse.json()).client;

    const entitledProjectResponse = await page.request.post('/api/projects', {
      data: { name: 'Entitled Mixed Project', clientId: entitledClient.id, hourlyRate: 100 },
    });
    expect(entitledProjectResponse.ok()).toBeTruthy();
    const entitledProject = (await entitledProjectResponse.json()).project;
    const unrelatedProjectResponse = await page.request.post('/api/projects', {
      data: { name: 'Unrelated Mixed Project', clientId: unrelatedClient.id, hourlyRate: 100 },
    });
    expect(unrelatedProjectResponse.ok()).toBeTruthy();
    const unrelatedProject = (await unrelatedProjectResponse.json()).project;

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Mixed Client E2E', scopes: ['write:time'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const createEntry = async (projectId: string, hour: number) => {
      const response = await page.request.post('/api/v1/time-entries', {
        headers: { authorization: `Bearer ${rawKey}` },
        data: {
          userId: ownerData.userId,
          projectId,
          startedAt: `2026-05-03T${String(hour).padStart(2, '0')}:00:00.000Z`,
          stoppedAt: `2026-05-03T${String(hour + 1).padStart(2, '0')}:00:00.000Z`,
          hourlyRate: 100,
          status: 'submitted',
        },
      });
      expect(response.ok()).toBeTruthy();
      const entry = (await response.json()).entry;
      const approve = await page.request.post('/api/timer/approve', { data: { entryId: entry.id } });
      expect(approve.ok()).toBeTruthy();
      return entry;
    };

    const entitledEntry = await createEntry(entitledProject.id, 13);
    const unrelatedEntry = await createEntry(unrelatedProject.id, 15);
    const mixedInvoiceResponse = await page.request.post('/api/invoices', {
      data: { timeEntryIds: [entitledEntry.id, unrelatedEntry.id] },
    });
    expect(mixedInvoiceResponse.ok()).toBeTruthy();
    const mixedInvoice = (await mixedInvoiceResponse.json()).invoice;

    const entitledClientLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=client&email=client-${workspace}%40example.com&workspace=${workspace}`);
    expect(entitledClientLogin.ok()).toBeTruthy();
    const portal = await page.request.get('/api/client');
    expect(portal.ok()).toBeTruthy();
    const portalBody = await portal.json();
    expect(portalBody.invoices.map((item: { id: string }) => item.id)).not.toContain(mixedInvoice.id);

    const signoff = await page.request.post('/api/client/signoff', { data: { invoiceId: mixedInvoice.id } });
    expect(signoff.status()).toBe(404);
  });

  test('Test 25: invoice creation and public API time writes enforce launch-blocker status boundaries', async ({ page }) => {
    const workspace = `status-boundary-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Status Boundary E2E', scopes: ['write:time', 'read:time'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const approvedCreate = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        startedAt: '2026-05-02T13:00:00.000Z',
        stoppedAt: '2026-05-02T14:00:00.000Z',
        hourlyRate: 100,
        status: 'approved',
      },
    });
    expect(approvedCreate.status()).toBe(400);

    const submittedCreate = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        startedAt: '2026-05-02T15:00:00.000Z',
        stoppedAt: '2026-05-02T16:00:00.000Z',
        hourlyRate: 100,
        status: 'submitted',
      },
    });
    expect(submittedCreate.ok()).toBeTruthy();
    const entry = (await submittedCreate.json()).entry;

    const patchToInvoiced = await page.request.patch('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: { entryId: entry.id, status: 'invoiced' },
    });
    expect(patchToInvoiced.status()).toBe(400);

    const patchToDraft = await page.request.patch('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: { entryId: entry.id, status: 'draft', description: 'Allowed downgrade before approval' },
    });
    expect(patchToDraft.ok()).toBeTruthy();
    const resubmit = await page.request.patch('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: { entryId: entry.id, status: 'submitted' },
    });
    expect(resubmit.ok()).toBeTruthy();

    const memberLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=member&email=member-${workspace}%40example.com&workspace=${workspace}`);
    expect(memberLogin.ok()).toBeTruthy();
    const memberInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [entry.id] } });
    expect(memberInvoice.status()).toBe(403);

    const ownerRelogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}`);
    expect(ownerRelogin.ok()).toBeTruthy();
    const draftInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [entry.id] } });
    expect(draftInvoice.status()).toBe(400);

    const approveResponse = await page.request.post('/api/timer/approve', { data: { entryId: entry.id } });
    expect(approveResponse.ok()).toBeTruthy();
    const patchApprovedDescription = await page.request.patch('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: { entryId: entry.id, description: 'Should stay locked despite otherwise safe field' },
    });
    expect(patchApprovedDescription.status()).toBe(409);

    const validInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [entry.id] } });
    expect(validInvoice.ok()).toBeTruthy();
    expect((await validInvoice.json()).invoice.number).toMatch(/^INV-\d{8}-[A-F0-9]{8}$/);
    const duplicateInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [entry.id] } });
    expect(duplicateInvoice.status()).toBe(400);

    const patchInvoicedDescription = await page.request.patch('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: { entryId: entry.id, description: 'Still locked after invoicing' },
    });
    expect(patchInvoicedDescription.status()).toBe(409);

    const openTimer = await page.request.post('/api/timer/start', { data: { taskId: 'open-invoice-e2e' } });
    expect(openTimer.ok()).toBeTruthy();
    const openEntry = (await openTimer.json()).entry;
    await db
      .update(timeEntries)
      .set({ status: 'approved' })
      .where(and(eq(timeEntries.id, openEntry.id), eq(timeEntries.workspaceId, ownerData.workspaceId)));
    const openInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [openEntry.id] } });
    expect(openInvoice.status()).toBe(400);

    const invalidRateEntryResponse = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        startedAt: '2026-05-02T17:00:00.000Z',
        stoppedAt: '2026-05-02T18:00:00.000Z',
        hourlyRate: -25,
        status: 'submitted',
      },
    });
    expect(invalidRateEntryResponse.ok()).toBeTruthy();
    const invalidRateEntry = (await invalidRateEntryResponse.json()).entry;
    const approveInvalidRate = await page.request.post('/api/timer/approve', { data: { entryId: invalidRateEntry.id } });
    expect(approveInvalidRate.ok()).toBeTruthy();
    const invalidRateInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [invalidRateEntry.id] } });
    expect(invalidRateInvoice.status()).toBe(400);

    const invalidDurationEntryResponse = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        startedAt: '2026-05-02T18:00:00.000Z',
        stoppedAt: '2026-05-02T18:30:00.000Z',
        hourlyRate: 25,
        status: 'submitted',
      },
    });
    expect(invalidDurationEntryResponse.ok()).toBeTruthy();
    const invalidDurationEntry = (await invalidDurationEntryResponse.json()).entry;
    const approveInvalidDuration = await page.request.post('/api/timer/approve', { data: { entryId: invalidDurationEntry.id } });
    expect(approveInvalidDuration.ok()).toBeTruthy();
    await db
      .update(timeEntries)
      .set({ durationSeconds: -1 })
      .where(and(eq(timeEntries.id, invalidDurationEntry.id), eq(timeEntries.workspaceId, ownerData.workspaceId)));
    const invalidDurationInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [invalidDurationEntry.id] } });
    expect(invalidDurationInvoice.status()).toBe(400);

    const validSecondEntryResponse = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        startedAt: '2026-05-02T19:00:00.000Z',
        stoppedAt: '2026-05-02T20:00:00.000Z',
        hourlyRate: 50,
        status: 'submitted',
      },
    });
    expect(validSecondEntryResponse.ok()).toBeTruthy();
    const validSecondEntry = (await validSecondEntryResponse.json()).entry;
    const approveValidSecond = await page.request.post('/api/timer/approve', { data: { entryId: validSecondEntry.id } });
    expect(approveValidSecond.ok()).toBeTruthy();
    const mixedValidityInvoice = await page.request.post('/api/invoices', { data: { timeEntryIds: [validSecondEntry.id, invalidRateEntry.id] } });
    expect(mixedValidityInvoice.status()).toBe(400);
    const validSecondEntries = await page.request.get(`/api/v1/time-entries?status=approved&userId=${ownerData.userId}`, {
      headers: { authorization: `Bearer ${rawKey}` },
    });
    expect(validSecondEntries.ok()).toBeTruthy();
    const approvedEntries = (await validSecondEntries.json()).entries;
    expect(approvedEntries.map((item: { id: string }) => item.id)).toContain(validSecondEntry.id);
  });

  test('Test 25b: public API time writes reject unavailable and cross-user scheduled blocks', async ({ page }) => {
    const workspace = `public-api-schedule-time-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Scheduled Block Guard E2E', scopes: ['write:time'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const memberLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=member&email=member-${workspace}%40example.com&workspace=${workspace}`);
    expect(memberLogin.ok()).toBeTruthy();
    const memberData = await memberLogin.json();

    const unavailableBlockId = crypto.randomUUID();
    await db.insert(scheduledWorkBlocks).values({
      id: unavailableBlockId,
      workspaceId: ownerData.workspaceId,
      userId: ownerData.userId,
      title: 'OOO unavailable hold',
      notes: 'External calendar busy block',
      tags: ['unavailable', 'external-calendar'],
      startsAt: new Date('2026-05-05T13:00:00.000Z'),
      endsAt: new Date('2026-05-05T14:00:00.000Z'),
      status: 'planned',
      createdByUserId: ownerData.userId,
    });

    const unavailableTime = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        scheduledBlockId: unavailableBlockId,
        startedAt: '2026-05-05T13:00:00.000Z',
        stoppedAt: '2026-05-05T14:00:00.000Z',
        status: 'submitted',
      },
    });
    expect(unavailableTime.status()).toBe(400);
    await expect(unavailableTime.json()).resolves.toMatchObject({ error: expect.stringContaining('Unavailable') });

    const memberBlockId = crypto.randomUUID();
    await db.insert(scheduledWorkBlocks).values({
      id: memberBlockId,
      workspaceId: ownerData.workspaceId,
      userId: memberData.userId,
      title: 'Member-owned work',
      startsAt: new Date('2026-05-05T15:00:00.000Z'),
      endsAt: new Date('2026-05-05T16:00:00.000Z'),
      status: 'planned',
      createdByUserId: memberData.userId,
    });

    const crossUserTime = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        scheduledBlockId: memberBlockId,
        startedAt: '2026-05-05T15:00:00.000Z',
        stoppedAt: '2026-05-05T16:00:00.000Z',
        status: 'submitted',
      },
    });
    expect(crossUserTime.status()).toBe(400);
    await expect(crossUserTime.json()).resolves.toMatchObject({ error: expect.stringContaining('belong to the time entry userId') });
  });

  test('Test 25c: invoice creation rejects supplied projectId that differs from selected entries', async ({ page }) => {
    const workspace = `invoice-project-mismatch-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();

    const projectAResponse = await page.request.post('/api/projects', {
      data: { name: 'Invoice Entry Project', hourlyRate: 100 },
    });
    expect(projectAResponse.ok()).toBeTruthy();
    const projectA = (await projectAResponse.json()).project;
    const projectBResponse = await page.request.post('/api/projects', {
      data: { name: 'Mismatched Invoice Project', hourlyRate: 100 },
    });
    expect(projectBResponse.ok()).toBeTruthy();
    const projectB = (await projectBResponse.json()).project;

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Invoice Project Mismatch E2E', scopes: ['write:time'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const entryResponse = await page.request.post('/api/v1/time-entries', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        projectId: projectA.id,
        startedAt: '2026-05-06T13:00:00.000Z',
        stoppedAt: '2026-05-06T14:00:00.000Z',
        hourlyRate: 100,
        status: 'submitted',
      },
    });
    expect(entryResponse.ok()).toBeTruthy();
    const entry = (await entryResponse.json()).entry;
    const approve = await page.request.post('/api/timer/approve', { data: { entryId: entry.id } });
    expect(approve.ok()).toBeTruthy();

    const mismatchedInvoice = await page.request.post('/api/invoices', {
      data: { timeEntryIds: [entry.id], projectId: projectB.id },
    });
    expect(mismatchedInvoice.status()).toBe(400);
    await expect(mismatchedInvoice.json()).resolves.toMatchObject({ error: expect.stringContaining('projectId') });

    const storedEntry = await db
      .select({ projectId: timeEntries.projectId })
      .from(timeEntries)
      .where(and(eq(timeEntries.id, entry.id), eq(timeEntries.workspaceId, ownerData.workspaceId)));
    expect(storedEntry[0]?.projectId).toBe(projectA.id);
  });

  test('Test 25d: public API schedule create and patch reject actions outside the scheduled user', async ({ page }) => {
    const workspace = `schedule-action-ownership-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();
    const ownerData = await ownerLogin.json();
    const memberLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=member&email=member-${workspace}%40example.com&workspace=${workspace}`);
    expect(memberLogin.ok()).toBeTruthy();
    const memberData = await memberLogin.json();
    const ownerRelogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}`);
    expect(ownerRelogin.ok()).toBeTruthy();

    const ownerActionId = crypto.randomUUID();
    const memberActionId = crypto.randomUUID();
    await db.insert(userActions).values([
      { id: ownerActionId, workspaceId: ownerData.workspaceId, userId: ownerData.userId, name: 'Owner Engineering', hourlyRate: 120 },
      { id: memberActionId, workspaceId: ownerData.workspaceId, userId: memberData.userId, name: 'Member Engineering', hourlyRate: 80 },
    ]);

    const keyResponse = await page.request.post('/api/settings/api-keys', {
      data: { name: 'Schedule Action Guard E2E', scopes: ['write:schedule'] },
    });
    expect(keyResponse.ok()).toBeTruthy();
    const rawKey = (await keyResponse.json()).rawKey;

    const invalidCreate = await page.request.post('/api/v1/schedule', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        actionId: memberActionId,
        title: 'Wrong action owner',
        startsAt: '2026-05-07T13:00:00.000Z',
        endsAt: '2026-05-07T14:00:00.000Z',
      },
    });
    expect(invalidCreate.status()).toBe(400);
    await expect(invalidCreate.json()).resolves.toMatchObject({ error: expect.stringContaining('actionId') });

    const validCreate = await page.request.post('/api/v1/schedule', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        userId: ownerData.userId,
        actionId: ownerActionId,
        title: 'Correct action owner',
        startsAt: '2026-05-07T15:00:00.000Z',
        endsAt: '2026-05-07T16:00:00.000Z',
      },
    });
    expect(validCreate.ok()).toBeTruthy();
    const block = (await validCreate.json()).block;

    const invalidPatch = await page.request.patch('/api/v1/schedule', {
      headers: { authorization: `Bearer ${rawKey}` },
      data: {
        blockId: block.id,
        actionId: memberActionId,
      },
    });
    expect(invalidPatch.status()).toBe(400);
    await expect(invalidPatch.json()).resolves.toMatchObject({ error: expect.stringContaining('actionId') });

    const unchangedBlock = await db
      .select({ actionId: scheduledWorkBlocks.actionId })
      .from(scheduledWorkBlocks)
      .where(and(eq(scheduledWorkBlocks.id, block.id), eq(scheduledWorkBlocks.workspaceId, ownerData.workspaceId)));
    expect(unchangedBlock[0]?.actionId).toBe(ownerActionId);
  });

  test('Test 26: Stripe checkout refuses duplicate active workspace billing before creating checkout', async ({ page }) => {
    const workspace = `stripe-duplicate-${unique()}`;
    const ownerLogin = await requestGetApp(page, `/api/test/login?plan=smb&role=owner&email=owner-${workspace}%40example.com&workspace=${workspace}&clean=true`);
    expect(ownerLogin.ok()).toBeTruthy();

    const duplicateCheckout = await page.request.post('/api/stripe/checkout', {
      data: { planId: 'enterprise' },
    });
    expect(duplicateCheckout.status()).toBe(409);
    const body = await duplicateCheckout.json();
    expect(body.portalPath).toBe('/settings/billing');
  });

  test('Test 26b: Stripe retained-customer checkout params preserve customer without duplicate state', async () => {
    const retainedCustomerId = `cus_retained_${unique()}`;
    const plan = getPaidPlanById('enterprise');
    expect(plan).toBeTruthy();

    expect(hasActivePaidBilling({ plan: 'free', stripeSubscriptionId: null })).toBe(false);
    expect(hasActivePaidBilling({ plan: 'free', stripeSubscriptionId: 'sub_active' })).toBe(true);
    expect(hasActivePaidBilling({ plan: 'smb', stripeSubscriptionId: null })).toBe(true);

    const params = buildStripeCheckoutParams({
      workspaceId: 'ws_retained_customer',
      plan: plan!,
      customerEmail: 'owner@example.com',
      stripeCustomerId: retainedCustomerId,
      appUrl: 'https://billabled.test',
    });

    expect(params.customer).toBe(retainedCustomerId);
    expect(params.customer_email).toBeUndefined();
    expect(params.line_items).toEqual([{ price: plan!.priceId, quantity: 1 }]);
    expect(params.metadata).toMatchObject({ workspaceId: 'ws_retained_customer', planId: plan!.planId });
    expect(params.subscription_data?.metadata).toMatchObject({ workspaceId: 'ws_retained_customer', planId: plan!.planId });
    expect(params.success_url).toBe('https://billabled.test/settings/billing?success=true');
    expect(params.cancel_url).toBe('https://billabled.test/settings/billing?canceled=true');
  });
});
