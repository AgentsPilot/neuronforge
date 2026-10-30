/**
 * The plan-cancel composer, D4b additions (account deletion lifecycle SX-3
 * part 2; workplan §3.4 and the D4b addendum; SA S-10 follow-up, DR-5, DR-9,
 * R-D; user U-3).
 *
 *   - the reminder goes through the same composer: the view is read, the
 *     provider key is passed to `sendEmail`, the audit says `actor: 'system'`
 *     and `email: 'reminder'`, and no address reaches a log or audit row;
 *   - D4a's un-keyed send and `actor: 'owner'` are unchanged;
 *   - R-D: a `cancelled` email that went (or whose outcome is unknown) for an
 *     end inside the 3-day window marks the reminder covered; outside the
 *     window, or not sent, or another email, it does not; a failed mark never
 *     throws.
 */

import { formatAccountDay } from '@/components/business-os/settings/planUpgradeCopy';
import type { PlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';

import {
  PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS,
  PLAN_CANCEL_REMINDER_WINDOW_SECONDS,
  coverReminderAfterCancelEmail,
  isInsideReminderWindow,
  sendPlanCancelEmail,
  type PlanCancelEmailAuditEntry,
  type PlanCancelEmailDeps,
  type PlanCancelEmailInput,
  type PlanCancelEmailOutcome,
  type PlanCancelReminderCoverDeps,
} from '../planCancelEmail';

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = 'owner@example.com';
const SENDER = 'notifications@agentspilot.ai';
const ENDS = '2026-11-01T07:05:22.000Z';
// ENDS is 1 day 23 hours ahead: inside the 3-day window.
const NOW = new Date('2026-10-30T08:00:00.000Z');
const KEY = 'plan-cancel-reminder:22222222-2222-4222-8222-222222222222:2026-11-01T07:05:22.000Z';

const VIEW: PlanEndingView = {
  kind: 'free_plan',
  endsAt: ENDS,
  planName: 'Test Flight',
  until: '2026-11-15T07:05:22.000Z',
  credits: 1000,
  loses: [],
  thenReadOnlyDays: 7,
  thenPausedFrom: '2026-11-22T07:05:22.000Z',
};

function harness(overrides: Partial<PlanCancelEmailDeps> = {}) {
  const sent: SendEmailParams[] = [];
  const audits: PlanCancelEmailAuditEntry[] = [];
  const logs: Array<{ level: string; context: Record<string, unknown> }> = [];
  const views: string[] = [];
  const log = (level: string) => (context: Record<string, unknown>) => {
    logs.push({ level, context });
  };
  const deps: PlanCancelEmailDeps = {
    isEnabled: () => true,
    findUserIdentity: async () => ({ data: { email: OWNER }, error: null }),
    findProfileLanguage: async () => ({ data: null, error: null }),
    findPreferredLanguage: async () => ({ data: null, error: null }),
    findTimezone: async () => ({ data: 'UTC', error: null }),
    readEndingView: async (userId, endsAt) => {
      views.push(`${userId}:${endsAt}`);
      return VIEW;
    },
    senderAddress: () => SENDER,
    sendEmail: async (params): Promise<SendEmailResult> => {
      sent.push(params);
      return { sent: true, provider: 'resend' };
    },
    platformUrl: (path) => `https://app.example.test${path}`,
    audit: async (entry) => {
      audits.push(entry);
    },
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    ...overrides,
  };
  return { deps, sent, audits, logs, views };
}

function reminderInput(overrides: Partial<PlanCancelEmailInput> = {}): PlanCancelEmailInput {
  return {
    event: 'reminder',
    userId: USER,
    date: ENDS,
    subscriptionId: 'sub_reminder1',
    livemode: false,
    correlationId: 'corr-cron',
    actor: 'system',
    idempotencyKey: KEY,
    ...overrides,
  };
}

describe('the reminder through the composer', () => {
  it('reads the view, sends ONE keyed transactional email, audits SENT with actor system and email reminder', async () => {
    const h = harness();
    expect(await sendPlanCancelEmail(reminderInput(), h.deps)).toEqual({ outcome: 'sent' });
    expect(h.views).toEqual([`${USER}:${ENDS}`]);
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0]).toMatchObject({
      kind: 'transactional',
      to: [OWNER],
      // The drawer's own day format (S-8), on the account's clock (UTC here).
      subject: `Your plan ends on ${formatAccountDay(ENDS, 'en', 'UTC')}`,
      redactRecipientInLogs: true,
      idempotencyKey: KEY,
    });
    expect(h.sent[0].text).toContain('Test Flight');
    expect(h.audits).toEqual([
      {
        action: 'BOS_PLAN_CANCEL_EMAIL_SENT',
        details: expect.objectContaining({ email: 'reminder', outcome: 'sent', actor: 'system', periodEnd: ENDS, subscriptionId: 'sub_reminder1', livemode: false }),
      },
    ]);
  });

  it('a refused keyed send → not_sent / transport_failed, audited NOT_SENT', async () => {
    const h = harness({ sendEmail: async () => ({ sent: false, provider: 'resend', error: 'boom', providerErrorCode: 'concurrent_idempotent_requests' }) });
    expect(await sendPlanCancelEmail(reminderInput(), h.deps)).toEqual({ outcome: 'not_sent', reason: 'transport_failed' });
    expect(h.audits[0].action).toBe('BOS_PLAN_CANCEL_EMAIL_NOT_SENT');
    expect(h.audits[0].details.actor).toBe('system');
  });

  it('no address, name or plan name in any log line or audit row', async () => {
    for (const sendEmail of [
      async (): Promise<SendEmailResult> => ({ sent: true, provider: 'resend' }),
      async (): Promise<SendEmailResult> => ({ sent: false, provider: 'resend' }),
    ]) {
      const h = harness({ sendEmail });
      await sendPlanCancelEmail(reminderInput(), h.deps);
      const dump = JSON.stringify([h.logs, h.audits]);
      expect(dump).not.toContain(OWNER);
      expect(dump).not.toContain('Test Flight');
    }
  });

  it('D4a unchanged: no key unless asked for, and the actor defaults to owner', async () => {
    const h = harness();
    await sendPlanCancelEmail(reminderInput({ event: 'cancelled', actor: undefined, idempotencyKey: undefined }), h.deps);
    expect(h.sent[0]).not.toHaveProperty('idempotencyKey');
    expect(h.audits[0].details.actor).toBe('owner');
  });
});

describe('isInsideReminderWindow (BQ-36: about 3 days)', () => {
  it('in the future and at most 3 days away → true; past, now, or further → false', () => {
    const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
    expect(PLAN_CANCEL_REMINDER_WINDOW_SECONDS).toBe(259_200);
    expect(isInsideReminderWindow(at(1_000), NOW)).toBe(true);
    expect(isInsideReminderWindow(at(PLAN_CANCEL_REMINDER_WINDOW_SECONDS * 1000), NOW)).toBe(true);
    expect(isInsideReminderWindow(at(PLAN_CANCEL_REMINDER_WINDOW_SECONDS * 1000 + 1), NOW)).toBe(false);
    expect(isInsideReminderWindow(at(0), NOW)).toBe(false);
    expect(isInsideReminderWindow(at(-1_000), NOW)).toBe(false);
    expect(isInsideReminderWindow('soon', NOW)).toBe(false);
  });
});

describe('R-D: a cancel inside the window covers the reminder', () => {
  function cover(overrides: Partial<PlanCancelReminderCoverDeps> = {}) {
    const calls: Array<Record<string, unknown>> = [];
    const logs: Array<{ level: string; context: Record<string, unknown> }> = [];
    const log = (level: string) => (context: Record<string, unknown>) => {
      logs.push({ level, context });
    };
    const deps: PlanCancelReminderCoverDeps = {
      markCovered: async (input) => {
        calls.push(input);
        return { data: { marked: true }, error: null };
      },
      logger: { info: log('info'), warn: log('warn'), error: log('error') },
      now: () => NOW,
      ...overrides,
    };
    return { deps, calls, logs };
  }
  const cancelled = (overrides: Partial<PlanCancelEmailInput> = {}): PlanCancelEmailInput => ({
    event: 'cancelled',
    userId: USER,
    date: ENDS,
    subscriptionId: 'sub_own',
    livemode: true,
    correlationId: 'corr-route',
    ...overrides,
  });
  const SENT: PlanCancelEmailOutcome = { outcome: 'sent' };

  it('inside the window, sent → marked, on the session user, mode, subscription and the canonical period end', async () => {
    const c = cover();
    expect(await coverReminderAfterCancelEmail(cancelled(), SENT, c.deps)).toBe('marked');
    expect(c.calls).toEqual([{ userId: USER, livemode: true, stripeSubscriptionId: 'sub_own', periodEnd: ENDS }]);
  });

  it('inside the window, unknown (S-3 b: it may have gone) → marked', async () => {
    const c = cover();
    expect(await coverReminderAfterCancelEmail(cancelled(), { outcome: 'unknown', reason: 'deadline_exceeded' }, c.deps)).toBe('marked');
    expect(c.calls).toHaveLength(1);
  });

  it('a non-canonical end is written in the canonical ISO form', async () => {
    const c = cover();
    await coverReminderAfterCancelEmail(cancelled({ date: '2026-11-01T07:05:22Z' }), SENT, c.deps);
    expect(c.calls[0].periodEnd).toBe(ENDS);
  });

  it('outside the window → not marked', async () => {
    const c = cover();
    expect(await coverReminderAfterCancelEmail(cancelled({ date: '2026-11-30T07:05:22.000Z' }), SENT, c.deps)).toBe('not_needed');
    expect(c.calls).toEqual([]);
  });

  it('not_sent (or skipped) → not marked: the reminder still goes', async () => {
    for (const outcome of [{ outcome: 'not_sent', reason: 'transport_failed' }, { outcome: 'skipped' }] as PlanCancelEmailOutcome[]) {
      const c = cover();
      expect(await coverReminderAfterCancelEmail(cancelled(), outcome, c.deps)).toBe('not_needed');
      expect(c.calls).toEqual([]);
    }
  });

  it('ended_now and kept never mark; no date, subscription or mode never marks', async () => {
    for (const input of [
      cancelled({ event: 'ended_now' }),
      cancelled({ event: 'kept' }),
      cancelled({ date: null }),
      cancelled({ subscriptionId: null }),
      cancelled({ livemode: null }),
    ]) {
      const c = cover();
      expect(await coverReminderAfterCancelEmail(input, SENT, c.deps)).toBe('not_needed');
      expect(c.calls).toEqual([]);
    }
  });

  it('the row moved on (count 0) → not_marked', async () => {
    const c = cover({ markCovered: async () => ({ data: { marked: false }, error: null }) });
    expect(await coverReminderAfterCancelEmail(cancelled(), SENT, c.deps)).toBe('not_marked');
  });

  it('F-3: a mark that never answers is cut at the timer → failed, logged, never thrown; the default bound is 2 s', async () => {
    expect(PLAN_CANCEL_REMINDER_COVER_TIMEOUT_MS).toBe(2_000);
    const hung = cover({ markCovered: () => new Promise(() => undefined), timeoutMs: 20 });
    const started = Date.now();
    await expect(coverReminderAfterCancelEmail(cancelled(), SENT, hung.deps)).resolves.toBe('failed');
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(hung.logs).toEqual([{ level: 'warn', context: expect.objectContaining({ reason: 'mark_timed_out' }) }]);
  });

  it('a failed or throwing mark is logged and never throws', async () => {
    const failed = cover({ markCovered: async () => ({ data: null, error: new Error('down') }) });
    expect(await coverReminderAfterCancelEmail(cancelled(), SENT, failed.deps)).toBe('failed');
    expect(failed.logs.map((l) => l.level)).toEqual(['warn']);

    const threw = cover({
      markCovered: async () => {
        throw new Error('boom');
      },
    });
    await expect(coverReminderAfterCancelEmail(cancelled(), SENT, threw.deps)).resolves.toBe('failed');

    const noisy = cover({
      markCovered: async () => {
        throw new Error('boom');
      },
      logger: {
        info: () => undefined,
        warn: () => {
          throw new Error('logger down');
        },
        error: () => undefined,
      },
    });
    await expect(coverReminderAfterCancelEmail(cancelled(), SENT, noisy.deps)).resolves.toBe('failed');
  });
});
