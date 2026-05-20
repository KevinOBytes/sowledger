import { expect, test } from '@playwright/test';
import 'dotenv/config';
import { NextRequest } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { POST as requestMagicLink } from '../app/api/auth/request-link/route';
import { db } from '../lib/db';
import { env } from '../lib/env';
import { ensureMembership, ensureUser, ensureWorkspace } from '../lib/store';
import { magicLinks, timeEntries, userActions } from '../lib/db/schema';
import { gotoApp, requestGetApp } from './helpers/navigation';

const unique = () => Date.now().toString(36);

test.describe('Launch readiness UX fixes', () => {
  test.beforeEach(async ({ page }) => {
    const workspace = `launch-ux-${unique()}`;
    const res = await requestGetApp(page, `/api/test/login?plan=smb&workspace=${workspace}&clean=true`);
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.success).toBe(true);
  });

  test('Activity allows corrections for submitted completed entries and keeps locked entries non-actionable', async ({ page }) => {
    const startedAt = new Date(Date.now() - 90 * 60 * 1000);
    const stoppedAt = new Date(Date.now() - 30 * 60 * 1000);
    const suffix = unique();
    const submittedOriginal = `Launch submitted edit ${suffix}`;
    const corrected = `Launch submitted corrected ${suffix}`;
    const approvedTitle = `Launch approved locked ${suffix}`;
    const invoicedTitle = `Launch invoiced locked ${suffix}`;
    const runningTitle = `Launch running locked ${suffix}`;

    const submittedCreate = await page.request.post('/api/timer/manual', {
      data: {
        taskId: 'Launch readiness correction',
        description: submittedOriginal,
        startedAt: startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
        tags: ['launch-readiness'],
      },
    });
    expect(submittedCreate.ok()).toBeTruthy();
    const submittedCreated = await submittedCreate.json();
    expect(submittedCreated.entry.id).toBeTruthy();

    await db.update(timeEntries)
      .set({ status: 'submitted' })
      .where(and(eq(timeEntries.id, submittedCreated.entry.id), eq(timeEntries.workspaceId, submittedCreated.entry.workspaceId)));

    for (const [description, status] of [[approvedTitle, 'approved'], [invoicedTitle, 'invoiced']] as const) {
      const createLocked = await page.request.post('/api/timer/manual', {
        data: {
          taskId: description,
          description,
          startedAt: new Date(startedAt.getTime() - 15 * 60 * 1000).toISOString(),
          stoppedAt: new Date(stoppedAt.getTime() - 15 * 60 * 1000).toISOString(),
        },
      });
      expect(createLocked.ok()).toBeTruthy();
      const locked = await createLocked.json();
      await db.update(timeEntries)
        .set({ status })
        .where(and(eq(timeEntries.id, locked.entry.id), eq(timeEntries.workspaceId, locked.entry.workspaceId)));
    }

    const running = await page.request.post('/api/timer/start', {
      data: { taskId: runningTitle, description: runningTitle },
    });
    expect(running.ok()).toBeTruthy();
    const runningData = await running.json();

    await gotoApp(page, '/activity');
    for (const lockedTitle of [approvedTitle, invoicedTitle, runningTitle]) {
      const row = page.locator('article').filter({ hasText: lockedTitle }).first();
      await expect(row).toBeVisible();
      await expect(row.getByText('Locked', { exact: true })).toBeVisible();
      await expect(row.getByRole('button', { name: /Correct time entry/i })).toHaveCount(0);
    }

    const runningEdit = await page.request.patch('/api/timer/edit', {
      data: {
        entryId: runningData.entry.id,
        taskId: runningTitle,
        startedAt: startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
      },
    });
    expect(runningEdit.status()).toBe(409);

    const submittedRow = page.locator('article').filter({ hasText: submittedOriginal }).first();
    await expect(submittedRow.getByRole('button', { name: /Correct time entry/i })).toBeVisible();
    await submittedRow.getByRole('button', { name: /Correct time entry/i }).click();
    await expect(page.getByRole('dialog', { name: /Correct logged time|Edit completed work/i })).toBeVisible();
    await page.getByLabel('Notes').fill(corrected);
    await page.getByLabel('Work type / rate').selectOption('');
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText(corrected)).toBeVisible();
  });

  test('Invite-only magic-link requests reject ineligible users before creating a link', async () => {
    const previousSelfRegistration = env.ALLOW_SELF_REGISTRATION;
    const previousBootstrapOwner = env.ALLOW_BOOTSTRAP_OWNER;
    const previousResendKey = env.RESEND_API_KEY;
    const suffix = unique();
    const blockedEmail = `blocked-${suffix}@example.com`;
    const blockedWorkspace = await ensureWorkspace(`blocked-${suffix}-workspace`);
    const owner = await ensureUser(`owner-${suffix}@example.com`);
    await ensureMembership(owner.id, blockedWorkspace.id, 'owner');

    env.ALLOW_SELF_REGISTRATION = false;
    env.ALLOW_BOOTSTRAP_OWNER = true;
    env.RESEND_API_KEY = undefined;

    try {
      const before = await db.select().from(magicLinks).where(eq(magicLinks.email, blockedEmail));
      const response = await requestMagicLink(new NextRequest('http://localhost/api/auth/request-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: blockedEmail }),
      }));
      const data = await response.json();
      const after = await db.select().from(magicLinks).where(eq(magicLinks.email, blockedEmail));

      expect(response.status).toBe(403);
      expect(data.error).toMatch(/invite-only/i);
      expect(after).toHaveLength(before.length);
    } finally {
      env.ALLOW_SELF_REGISTRATION = previousSelfRegistration;
      env.ALLOW_BOOTSTRAP_OWNER = previousBootstrapOwner;
      env.RESEND_API_KEY = previousResendKey;
    }
  });

  test('Activity correction preserves existing action rate by default and can clear it explicitly', async ({ page }) => {
    const suffix = unique();
    const actionName = `Preserve rate ${suffix}`;
    const originalNote = `Preserve action note ${suffix}`;
    const preservedNote = `Preserved rate after note edit ${suffix}`;
    const clearedNote = `Cleared rate after explicit no-rate ${suffix}`;
    const actionRes = await page.request.post('/api/user/actions', {
      data: { name: actionName, hourlyRate: 125 },
    });
    expect(actionRes.ok()).toBeTruthy();
    const { action } = await actionRes.json();
    const startedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const stoppedAt = new Date(Date.now() - 90 * 60 * 1000);

    const createdRes = await page.request.post('/api/timer/manual', {
      data: {
        taskId: `Preserve action work ${suffix}`,
        description: originalNote,
        actionId: action.id,
        startedAt: startedAt.toISOString(),
        stoppedAt: stoppedAt.toISOString(),
      },
    });
    expect(createdRes.ok()).toBeTruthy();
    const { entry } = await createdRes.json();
    expect(entry.action).toBe(actionName);
    expect(entry.hourlyRate).toBe(125);

    await db.update(userActions)
      .set({ hourlyRate: 375 })
      .where(eq(userActions.id, action.id));

    await gotoApp(page, '/activity');
    const originalRow = page.locator('article').filter({ hasText: originalNote }).first();
    await expect(originalRow.getByRole('button', { name: /Correct time entry/i })).toBeVisible();
    await originalRow.getByRole('button', { name: /Correct time entry/i }).click();
    await expect(page.getByLabel('Work type / rate')).toHaveValue('__preserve_current_action__');
    await page.getByLabel('Notes').fill(preservedNote);
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText(preservedNote)).toBeVisible();

    const [preserved] = await db.select({ action: timeEntries.action, hourlyRate: timeEntries.hourlyRate })
      .from(timeEntries)
      .where(eq(timeEntries.id, entry.id));
    expect(preserved.action).toBe(actionName);
    expect(preserved.hourlyRate).toBe(125);

    const preservedRow = page.locator('article').filter({ hasText: preservedNote }).first();
    await preservedRow.getByRole('button', { name: /Correct time entry/i }).click();
    await page.getByLabel('Work type / rate').selectOption('');
    await page.getByLabel('Notes').fill(clearedNote);
    await page.getByRole('button', { name: 'Save correction' }).click();
    await expect(page.getByText(clearedNote)).toBeVisible();

    const [cleared] = await db.select({ action: timeEntries.action, hourlyRate: timeEntries.hourlyRate })
      .from(timeEntries)
      .where(eq(timeEntries.id, entry.id));
    expect(cleared.action).toBeNull();
    expect(cleared.hourlyRate).toBeNull();
  });

  test('Dashboard and timer APIs block unavailable scheduled work from becoming time', async ({ page }) => {
    const title = `Unavailable launch block ${unique()}`;
    const startsAt = new Date(Date.now() + 20 * 60 * 1000);
    const endsAt = new Date(Date.now() + 80 * 60 * 1000);
    const scheduled = await page.request.post('/api/schedule', {
      data: {
        title,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        tags: ['external-calendar', 'unavailable'],
      },
    });
    expect(scheduled.ok()).toBeTruthy();
    const { block } = await scheduled.json();

    await gotoApp(page, '/dashboard');
    const card = page.locator('article').filter({ hasText: title }).first();
    await expect(card).toBeVisible();
    await expect(card.getByText(/cannot be started or logged as completed work/i)).toBeVisible();
    await expect(card.getByRole('button', { name: 'Start timer' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Log completed work' })).toHaveCount(0);

    const start = await page.request.post('/api/timer/start', {
      data: { taskId: title, scheduledBlockId: block.id },
    });
    expect(start.status()).toBe(409);

    const manual = await page.request.post('/api/timer/manual', {
      data: {
        taskId: title,
        scheduledBlockId: block.id,
        startedAt: startsAt.toISOString(),
        stoppedAt: endsAt.toISOString(),
      },
    });
    expect(manual.status()).toBe(409);
  });

  test('Calendar completed time keeps the selected scheduled action rate', async ({ page }) => {
    const actionName = `Launch rate ${unique()}`;
    const actionRes = await page.request.post('/api/user/actions', {
      data: { name: actionName, hourlyRate: 225 },
    });
    expect(actionRes.ok()).toBeTruthy();
    const { action } = await actionRes.json();

    const startsAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const endsAt = new Date(Date.now() - 60 * 60 * 1000);
    const scheduled = await page.request.post('/api/schedule', {
      data: {
        title: `Rated scheduled work ${unique()}`,
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        actionId: action.id,
      },
    });
    expect(scheduled.ok()).toBeTruthy();
    const { block } = await scheduled.json();

    const completed = await page.request.post('/api/timer/manual', {
      data: {
        taskId: block.title,
        scheduledBlockId: block.id,
        startedAt: startsAt.toISOString(),
        stoppedAt: endsAt.toISOString(),
        source: 'calendar',
      },
    });
    expect(completed.ok()).toBeTruthy();
    const { entry } = await completed.json();

    const [stored] = await db.select({ action: timeEntries.action, hourlyRate: timeEntries.hourlyRate, source: timeEntries.source })
      .from(timeEntries)
      .where(eq(timeEntries.id, entry.id));
    expect(stored.action).toBe(actionName);
    expect(stored.hourlyRate).toBe(225);
    expect(stored.source).toBe('calendar');
  });
});
