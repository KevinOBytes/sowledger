import type { Page } from '@playwright/test';
import { test, expect } from './helpers/stream-diagnostic-fixture';
import { gotoApp, requestGetApp } from './helpers/navigation';
import { completeActionRefresh, finishResponse, mutationResponse } from './helpers/request-completion';

type SavedTag = { id: string; name: string; projectId: string | null; isSOWLedgerDefault: boolean; status: 'active' | 'archived' };

let didClean = false;
const unique = () => Date.now().toString(36);
const professionalWorkspace = `professional-${unique()}`;

async function readServerActiveTagCount(page: Page) {
  // This header is rendered by the server page, outside the client table's local state.
  const count = page.getByText(/^\d+ active tags$/);
  await expect(count).toBeVisible();
  const value = Number((await count.innerText()).split(' ', 1)[0]);
  expect(Number.isSafeInteger(value)).toBe(true);
  return value;
}

test.describe('Professional Feature Suite (10 User Stories)', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page, context }) => {
    await context.addCookies([{ name: 'sowledger-cookie-consent', value: 'false', domain: 'localhost', path: '/' }, { name: 'sowledger-cookie-consent', value: 'false', domain: '127.0.0.1', path: '/' }]);
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
    const activeBeforeCreate = await readServerActiveTagCount(page);
    await page.getByPlaceholder('Enter new tag...').fill('Legacy E2E Tag');
    await page.getByRole('button', { name: 'Select color Blue', exact: true }).click();
    const tag = await completeActionRefresh(page, async () => {
      const created = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'POST', { name: 'Legacy E2E Tag' }));
      await page.getByRole('button', { name: 'Add Tag' }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      await finishResponse(response);
      const data = await response.json() as { ok: boolean; tag: SavedTag };
      expect(data).toMatchObject({ ok: true, tag: { name: 'legacy e2e tag', status: 'active' } });
      expect(data.tag.id).toEqual(expect.any(String));
      expect(data.tag.id).not.toBe('');
      return data.tag;
    }, async () => {
      await expect(page.getByText(`${activeBeforeCreate + 1} active tags`, { exact: true })).toBeVisible();
    });
    await expect(page.getByText('#legacy e2e tag')).toBeVisible();
    const row = page.getByRole('row').filter({ hasText: 'legacy e2e tag' });
    await completeActionRefresh(page, async () => {
      const archived = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'PATCH', { tagId: tag.id, status: 'archived' }));
      await row.getByRole('button', { name: 'Archive tag legacy e2e tag', exact: true }).click();
      const response = await archived;
      expect(response.status()).toBe(200);
      await finishResponse(response);
      expect(await response.json()).toMatchObject({ ok: true, tag: { id: tag.id, status: 'archived' } });
    }, async () => {
      await expect(page.getByText(`${activeBeforeCreate} active tags`, { exact: true })).toBeVisible();
    });
    await expect(row.getByText('archived', { exact: true })).toBeVisible();
    const readback = await page.request.get('/api/settings/tags');
    expect(readback.status()).toBe(200);
    const saved = await readback.json() as { ok: boolean; tags: SavedTag[] };
    expect(saved.ok).toBe(true);
    expect(saved.tags.find((item) => item.id === tag.id)).toMatchObject({ id: tag.id, status: 'archived' });
    expect((await page.reload())?.status()).toBe(200);
    await expect(row.getByText('archived', { exact: true })).toBeVisible();
    await expect(page.getByText(`${activeBeforeCreate} active tags`, { exact: true })).toBeVisible();
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
    const firstStarted = page.waitForResponse(mutationResponse(page.url(), '/api/timer/start', 'POST', { taskId: 'General work' }));
    await page.getByRole('button', { name: 'Start timer', exact: true }).click();
    const firstStart = await firstStarted;
    expect(firstStart.status()).toBe(200);
    await finishResponse(firstStart);
    const first = await firstStart.json();
    expect(first).toMatchObject({ ok: true, entry: { taskId: 'General work', stoppedAt: null } });
    expect(first.entry.id).toEqual(expect.any(String));
    expect(first.entry.id).not.toBe('');
    await page.waitForTimeout(1000);
    const secondStarted = page.waitForResponse(mutationResponse(page.url(), '/api/timer/start', 'POST', { taskId: 'General work' }));
    await page.getByRole('button', { name: 'Start another timer' }).click();
    const secondStart = await secondStarted;
    expect(secondStart.status()).toBe(200);
    await finishResponse(secondStart);
    const second = await secondStart.json();
    expect(second).toMatchObject({ ok: true, entry: { taskId: 'General work', stoppedAt: null } });
    expect(second.entry.id).toEqual(expect.any(String));
    expect(second.entry.id).not.toBe('');
    expect(second.entry.id).not.toBe(first.entry.id);
    await page.waitForTimeout(1000);
    await expect(page.getByText('2 active timers', { exact: true })).toBeVisible();
    // The focused timer is the most recently started timer.
    const secondStopped = page.waitForResponse(mutationResponse(page.url(), '/api/timer/stop', 'POST', { entryId: second.entry.id }));
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
    const secondStop = await secondStopped;
    expect(secondStop.status()).toBe(200);
    await finishResponse(secondStop);
    expect(await secondStop.json()).toMatchObject({ ok: true, entryId: second.entry.id });
    await expect(page.getByText('1 active timer', { exact: true })).toBeVisible();
    await page.waitForTimeout(1000);
    const firstStopped = page.waitForResponse(mutationResponse(page.url(), '/api/timer/stop', 'POST', { entryId: first.entry.id }));
    await page.getByRole('button', { name: 'Stop focused timer' }).click();
    const firstStop = await firstStopped;
    expect(firstStop.status()).toBe(200);
    await finishResponse(firstStop);
    expect(await firstStop.json()).toMatchObject({ ok: true, entryId: first.entry.id });
    const activeResponse = await page.request.get('/api/timer/active');
    expect(activeResponse.status()).toBe(200);
    const active = await activeResponse.json();
    expect(active.ok).toBe(true);
    expect(active.activeEntries).toEqual([]);
    const listResponse = await page.request.get('/api/timer/list?limit=100');
    expect(listResponse.status()).toBe(200);
    const logged = await listResponse.json() as { ok: boolean; entries: Array<{ id: string; stoppedAt: string | null; durationSeconds: number | null }> };
    expect(logged.ok).toBe(true);
    for (const id of [first.entry.id, second.entry.id]) {
      const entry = logged.entries.find((item) => item.id === id);
      expect(entry).toBeDefined();
      expect(entry!.stoppedAt).toEqual(expect.any(String));
      expect(Number.isFinite(Date.parse(entry!.stoppedAt!))).toBe(true);
      expect(Number.isFinite(entry!.durationSeconds)).toBe(true);
      expect(entry!.durationSeconds).toBeGreaterThanOrEqual(0);
    }
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

  test('Story 9: persist a reference-only tag project association', async ({ page }) => {
    await gotoApp(page, '/settings/tags');
    const activeBeforeCreate = await readServerActiveTagCount(page);
    await page.getByPlaceholder('Enter new tag...').fill('Scoped Tag E2E');
    const tag = await completeActionRefresh(page, async () => {
      const created = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'POST', { name: 'Scoped Tag E2E' }));
      await page.getByRole('button', { name: 'Add Tag' }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      await finishResponse(response);
      const data = await response.json() as { ok: boolean; tag: SavedTag };
      expect(data).toMatchObject({ ok: true, tag: { name: 'scoped tag e2e', projectId: null } });
      expect(data.tag.id).toEqual(expect.any(String));
      expect(data.tag.id).not.toBe('');
      return data.tag;
    }, async () => {
      await expect(page.getByText(`${activeBeforeCreate + 1} active tags`, { exact: true })).toBeVisible();
    });
    const row = page.getByRole('row').filter({ hasText: 'scoped tag e2e' });
    const scope = row.getByRole('combobox', { name: `Associated project for ${tag.name}`, exact: true });
    const option = scope.getByRole('option', { name: 'E2E Budget Project', exact: true });
    await expect(option).toHaveCount(1);
    const projectId = (await option.getAttribute('value'))!;
    expect(projectId).toBeTruthy();
    expect(projectId).not.toBe('');
    // This metadata has no changing server-only header. Verify the exact mutation,
    // API readback and a fresh document instead of claiming automatic refresh completion.
    const patched = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'PATCH', { tagId: tag.id, projectId }));
    await scope.selectOption(projectId);
    const response = await patched;
    expect(response.status()).toBe(200);
    await finishResponse(response);
    expect(await response.json()).toMatchObject({ ok: true, tag: { id: tag.id, projectId } });
    await expect(scope).toHaveValue(projectId);
    const readback = await page.request.get('/api/settings/tags');
    expect(readback.status()).toBe(200);
    const saved = await readback.json() as { ok: boolean; tags: SavedTag[] };
    expect(saved.ok).toBe(true);
    expect(saved.tags.find((item) => item.id === tag.id)).toMatchObject({ id: tag.id, projectId });
    expect((await page.reload())?.status()).toBe(200);
    await expect(scope).toHaveValue(projectId);
  });

  test('Story 10: persist the workspace tag reference-only billing label', async ({ page }) => {
    await gotoApp(page, '/settings/tags');
    const activeBeforeCreate = await readServerActiveTagCount(page);
    await page.getByPlaceholder('Enter new tag...').fill('Billable E2E Tag');
    const tag = await completeActionRefresh(page, async () => {
      const created = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'POST', { name: 'Billable E2E Tag' }));
      await page.getByRole('button', { name: 'Add Tag' }).click();
      const response = await created;
      expect(response.status()).toBe(200);
      await finishResponse(response);
      const data = await response.json() as { ok: boolean; tag: SavedTag };
      expect(data).toMatchObject({ ok: true, tag: { name: 'billable e2e tag', isSOWLedgerDefault: false } });
      expect(data.tag.id).toEqual(expect.any(String));
      expect(data.tag.id).not.toBe('');
      return data.tag;
    }, async () => {
      await expect(page.getByText(`${activeBeforeCreate + 1} active tags`, { exact: true })).toBeVisible();
    });
    
    // Find the created tag row
    const row = page.getByRole('row').filter({ hasText: 'billable e2e tag' });
    
    // Toggle reference metadata, not time-entry billability or invoice behavior.
    // As with project association, persistence is proved by readback and reload;
    // the client-updated button alone does not prove a server refresh committed.
    const patched = page.waitForResponse(mutationResponse(page.url(), '/api/settings/tags', 'PATCH', { tagId: tag.id, isSOWLedgerDefault: true }));
    await row.getByRole('button', { name: 'No billable label for billable e2e tag', exact: true }).click();
    const response = await patched;
    expect(response.status()).toBe(200);
    await finishResponse(response);
    expect(await response.json()).toMatchObject({ ok: true, tag: { id: tag.id, isSOWLedgerDefault: true } });
    
    await expect(row.getByRole('button', { name: 'Billable label for billable e2e tag', exact: true })).toBeVisible();
    await expect(page.getByText("This label doesn't change time entries, rates, or invoices.", { exact: true })).toBeVisible();
    
    // This checks persisted reference metadata, not automatic billing on a timer.
    const readback = await page.request.get('/api/settings/tags');
    expect(readback.status()).toBe(200);
    const saved = await readback.json() as { ok: boolean; tags: SavedTag[] };
    expect(saved.ok).toBe(true);
    expect(saved.tags.find((item) => item.id === tag.id)).toMatchObject({ id: tag.id, isSOWLedgerDefault: true });
    expect((await page.reload())?.status()).toBe(200);
    await expect(row.getByRole('button', { name: 'Billable label for billable e2e tag', exact: true })).toBeVisible();
  });
});
