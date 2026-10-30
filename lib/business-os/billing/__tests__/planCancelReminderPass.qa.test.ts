/**
 * QA gap tests for the plan-ends reminder run (account deletion lifecycle D4b /
 * SX-3 part 2; workplan docs/workplans/BUSINESS_OS_D4_PLAN_CANCEL_EMAILS_WORKPLAN.md
 * §3.4, §8 row 6, §12 D4b addendum and SA code review; §13 QA report).
 *
 * Pure: every port is a fake. The claim fake models the SQL of 20261100:
 * FOR UPDATE SKIP LOCKED (a leased row is invisible to a second runner), the
 * lease expiry, the window, one mode, active / trialing only, and "no reminder
 * for this period end yet".
 *
 * What planCancelReminderPass.test.ts did not already pin:
 *   - truly interleaved runs (sends that yield) over more rows than two batches;
 *   - `unknown` is never re-claimed on any later day of the window (DR-5);
 *   - `not_sent` is retried by the next daily run and sent then;
 *   - every Stripe "no" (each status, flag off, ended, ±1 s, 0 / 2 items) is
 *     released, never sent, never completed;
 *   - every C-4 field on its own → mismatch + alert, released;
 *   - `past_due` is never reminded, at the claim and at the choke point (F-5);
 *   - each port throwing ON ITS OWN never throws the run (R-B);
 *   - the deadline with a clock that moves during sends;
 *   - the provider key's exact shape and length for real ids;
 *   - tenant isolation: each send goes to its own row's account; a Stripe
 *     answer naming another account sends to nobody.
 */

import * as fs from 'fs';
import * as path from 'path';

import { findBosCronJob } from '@/lib/cron/bosCronJobs';
import { IDEMPOTENCY_KEY_MAX_LENGTH } from '@/lib/notifications/emailTransport';

import type { PlanCancelEmailInput, PlanCancelEmailOutcome } from '../planCancelEmail';
import {
  PLAN_CANCEL_REMINDER_COUNT_KEYS,
  PLAN_CANCEL_REMINDER_POLICY,
  PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS,
  planCancelReminderIdempotencyKey,
  runPlanCancelReminderPass,
  type PlanCancelReminderDeps,
  type PlanCancelReminderRow,
  type PlanCancelReminderSubscriptionFacts,
} from '../planCancelReminderPass';

const ROOT = process.cwd();
const NOW = Date.parse('2026-10-29T05:53:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_B = '55555555-5555-4555-8555-555555555555';

interface TableRow extends PlanCancelReminderRow {
  cancelAtPeriodEnd: boolean;
  status: string;
  ended: boolean;
  claimedBy: string | null;
  claimedAt: number | null;
}

function tableRow(n: number, overrides: Partial<TableRow> = {}): TableRow {
  const end = new Date(Math.floor((NOW + 2 * DAY) / 1000) * 1000).toISOString();
  return {
    id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
    userId: ACCOUNT_A,
    livemode: false,
    stripeSubscriptionId: `sub_qa${n}`,
    stripeCustomerId: `cus_qa${n}`,
    currentPeriodEnd: end,
    cancelReminderSentFor: null,
    cancelAtPeriodEnd: true,
    status: 'active',
    ended: false,
    claimedBy: null,
    claimedAt: null,
    ...overrides,
  };
}

function freshFor(row: PlanCancelReminderRow, overrides: Partial<PlanCancelReminderSubscriptionFacts> = {}): PlanCancelReminderSubscriptionFacts {
  const endUnix = Date.parse(row.currentPeriodEnd) / 1000;
  return {
    id: row.stripeSubscriptionId,
    status: 'active',
    customerId: row.stripeCustomerId,
    cancelAtPeriodEnd: true,
    cancelAt: endUnix,
    endedAt: null,
    livemode: row.livemode,
    metadata: { bos_user_id: row.userId },
    items: [{ currentPeriodEnd: endUnix }],
    ...overrides,
  };
}

interface World {
  table: TableRow[];
  clock: { now: number };
  sends: PlanCancelEmailInput[];
  completes: Array<Record<string, unknown>>;
  releases: Array<Record<string, unknown>>;
  logs: Array<{ level: string; context: Record<string, unknown>; message: string }>;
  stripeReads: string[];
  outcomes: PlanCancelEmailOutcome[];
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

let runnerSeq = 0;

function world(
  rows: TableRow[],
  overrides: Partial<PlanCancelReminderDeps> = {},
  stripeOverrides: Record<string, Partial<PlanCancelReminderSubscriptionFacts>> = {},
  options: { yieldOnSend?: boolean; outcome?: (input: PlanCancelEmailInput) => PlanCancelEmailOutcome } = {}
) {
  const w: World = { table: rows, clock: { now: NOW }, sends: [], completes: [], releases: [], logs: [], stripeReads: [], outcomes: [] };
  const log = (level: string) => (context: Record<string, unknown>, message: string) => {
    w.logs.push({ level, context, message });
  };
  const deps: PlanCancelReminderDeps = {
    isEnabled: () => true,
    keyLivemode: () => false,
    newRunnerId: () => {
      runnerSeq += 1;
      return `33333333-3333-4333-8333-${String(runnerSeq).padStart(12, '0')}`;
    },
    claim: async (input) => {
      await tick();
      const now = w.clock.now;
      const picked = w.table
        .filter(
          (r) =>
            r.livemode === input.livemode &&
            r.cancelAtPeriodEnd &&
            !r.ended &&
            ['active', 'trialing'].includes(r.status) &&
            Date.parse(r.currentPeriodEnd) > now &&
            Date.parse(r.currentPeriodEnd) <= now + input.windowSeconds * 1000 &&
            r.cancelReminderSentFor !== r.currentPeriodEnd &&
            (r.claimedAt === null || r.claimedAt < now - input.leaseSeconds * 1000)
        )
        .sort((a, b) => Date.parse(a.currentPeriodEnd) - Date.parse(b.currentPeriodEnd) || a.id.localeCompare(b.id))
        .slice(0, input.batch);
      for (const r of picked) {
        r.claimedBy = input.runnerId;
        r.claimedAt = now;
      }
      return {
        data: picked.map((r) => ({
          id: r.id,
          userId: r.userId,
          livemode: r.livemode,
          stripeSubscriptionId: r.stripeSubscriptionId,
          stripeCustomerId: r.stripeCustomerId,
          currentPeriodEnd: r.currentPeriodEnd,
          cancelReminderSentFor: r.cancelReminderSentFor,
        })),
        error: null,
      };
    },
    complete: async (input) => {
      w.completes.push(input);
      const r = w.table.find((t) => t.id === input.id && t.userId === input.userId && t.livemode === input.livemode && t.claimedBy === input.runnerId);
      if (!r) return { data: { completed: false }, error: null };
      r.cancelReminderSentFor = input.periodEnd;
      r.claimedBy = null;
      r.claimedAt = null;
      return { data: { completed: true }, error: null };
    },
    release: async (input) => {
      w.releases.push(input);
      const r = w.table.find((t) => t.id === input.id && t.userId === input.userId && t.livemode === input.livemode && t.claimedBy === input.runnerId);
      if (!r) return { data: { released: false }, error: null };
      r.claimedBy = null;
      r.claimedAt = null;
      return { data: { released: true }, error: null };
    },
    stripe: () => ({
      retrieveSubscription: async (subscriptionId: string) => {
        w.stripeReads.push(subscriptionId);
        const row = w.table.find((t) => t.stripeSubscriptionId === subscriptionId);
        if (!row) throw new Error('no such subscription');
        return freshFor(row, stripeOverrides[subscriptionId] ?? {});
      },
    }),
    sendReminder: async (input): Promise<PlanCancelEmailOutcome> => {
      w.sends.push(input);
      if (options.yieldOnSend) await tick();
      const outcome = options.outcome ? options.outcome(input) : { outcome: 'sent' as const };
      w.outcomes.push(outcome);
      return outcome;
    },
    flushAudit: async () => undefined,
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now: () => w.clock.now,
    ...overrides,
  };
  return { w, deps };
}

const ctx = (w: World) => ({ deadlineAt: w.clock.now + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS, correlationId: 'corr-qa' });

describe('QA: concurrency (SKIP LOCKED model, interleaved)', () => {
  it('three runs interleaved over 70 rows (sends yield) never send twice; each row exactly once across runs', async () => {
    const rows = Array.from({ length: 70 }, (_, i) => tableRow(i + 1));
    const { w, deps } = world(rows, {}, {}, { yieldOnSend: true });
    const results = await Promise.all([0, 1, 2].map(() => runPlanCancelReminderPass(deps, ctx(w))));
    const sentTo = w.sends.map((s) => s.subscriptionId);
    expect(new Set(sentTo).size).toBe(sentTo.length);
    expect(results.reduce((sum, r) => sum + r.sent, 0)).toBe(70);
    for (const r of results) expect(r.examined).toBeLessThanOrEqual(PLAN_CANCEL_REMINDER_POLICY.batch);
    // Every row recorded, no lease left behind.
    for (const r of w.table) {
      expect(r.cancelReminderSentFor).toBe(r.currentPeriodEnd);
      expect(r.claimedBy).toBeNull();
    }
    // A fourth run the next day finds nothing.
    w.clock.now += DAY;
    expect((await runPlanCancelReminderPass(deps, ctx(w))).examined).toBe(0);
  });

  it('a run that starts while another holds a live lease skips those rows (no double send, no steal)', async () => {
    const rows = [tableRow(1), tableRow(2)];
    rows[0].claimedBy = '99999999-9999-4999-8999-999999999999';
    rows[0].claimedAt = NOW - 30_000; // 30 s old: alive (lease 90 s).
    const { w, deps } = world(rows);
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    expect(counts.sent).toBe(1);
    expect(w.sends.map((s) => s.subscriptionId)).toEqual(['sub_qa2']);
    expect(rows[0].claimedBy).toBe('99999999-9999-4999-8999-999999999999');
  });

  it('a dead lease (older than 90 s) is reclaimed and sent once', async () => {
    const rows = [tableRow(1)];
    rows[0].claimedBy = '99999999-9999-4999-8999-999999999999';
    rows[0].claimedAt = NOW - 91_000;
    const { w, deps } = world(rows);
    expect((await runPlanCancelReminderPass(deps, ctx(w))).sent).toBe(1);
  });

  it('a stale runner (lease lost) completes nothing: 0 rows written', async () => {
    const { w, deps } = world([tableRow(1)], {
      // Another runner took the row between our claim and our complete.
      sendReminder: async (input) => {
        w.sends.push(input);
        w.table[0].claimedBy = '88888888-8888-4888-8888-888888888888';
        return { outcome: 'sent' };
      },
    });
    await runPlanCancelReminderPass(deps, ctx(w));
    expect(w.table[0].cancelReminderSentFor).toBeNull();
    expect(w.table[0].claimedBy).toBe('88888888-8888-4888-8888-888888888888');
    expect(w.logs.some((l) => l.context.reason === 'complete_failed' && l.context.alert === true)).toBe(true);
  });
});

describe('QA: DR-5 across the whole window', () => {
  it('unknown → completed with the row period end, and never claimed again on any later day of the window', async () => {
    const row = tableRow(1, { currentPeriodEnd: new Date(Math.floor((NOW + 2.9 * DAY) / 1000) * 1000).toISOString() });
    const { w, deps } = world([row], {}, {}, { outcome: () => ({ outcome: 'unknown', reason: 'deadline_exceeded' }) });
    const first = await runPlanCancelReminderPass(deps, ctx(w));
    expect(first).toMatchObject({ examined: 1, sent: 0, notSent: 1 });
    expect(w.completes).toEqual([expect.objectContaining({ id: row.id, periodEnd: row.currentPeriodEnd })]);
    expect(w.releases).toEqual([]);
    for (let day = 1; day <= 3; day += 1) {
      w.clock.now = NOW + day * DAY;
      expect((await runPlanCancelReminderPass(deps, ctx(w))).examined).toBe(0);
    }
    expect(w.sends).toHaveLength(1);
  });

  it('not_sent → released (no record), retried and sent by the next daily run', async () => {
    let attempt = 0;
    const row = tableRow(1, { currentPeriodEnd: new Date(Math.floor((NOW + 2.9 * DAY) / 1000) * 1000).toISOString() });
    const { w, deps } = world([row], {}, {}, {
      outcome: () => {
        attempt += 1;
        return attempt === 1 ? { outcome: 'not_sent', reason: 'transport_failed' } : { outcome: 'sent' };
      },
    });
    const first = await runPlanCancelReminderPass(deps, ctx(w));
    expect(first).toMatchObject({ examined: 1, notSent: 1, sent: 0 });
    expect(w.completes).toEqual([]);
    expect(row.cancelReminderSentFor).toBeNull();
    expect(row.claimedBy).toBeNull();
    w.clock.now = NOW + DAY;
    const second = await runPlanCancelReminderPass(deps, ctx(w));
    expect(second).toMatchObject({ examined: 1, sent: 1 });
    expect(row.cancelReminderSentFor).toBe(row.currentPeriodEnd);
  });

  it('a not_sent row is never retried once its end has passed (bounded retries)', async () => {
    const row = tableRow(1, { currentPeriodEnd: new Date(Math.floor((NOW + 0.5 * DAY) / 1000) * 1000).toISOString() });
    const { w, deps } = world([row], {}, {}, { outcome: () => ({ outcome: 'not_sent', reason: 'transport_failed' }) });
    await runPlanCancelReminderPass(deps, ctx(w));
    w.clock.now = NOW + DAY;
    expect((await runPlanCancelReminderPass(deps, ctx(w))).examined).toBe(0);
    expect(w.sends).toHaveLength(1);
  });
});

describe('QA: S-14 / C-4 / F-5 at the choke point — released, never sent, never completed', () => {
  const end = (row: TableRow) => Date.parse(row.currentPeriodEnd) / 1000;
  const cases: Array<[string, (row: TableRow) => Partial<PlanCancelReminderSubscriptionFacts>, string]> = [
    ['Stripe says not cancelling (flag false, no cancel_at)', () => ({ cancelAtPeriodEnd: false, cancelAt: null }), 'notCancelling'],
    ['Stripe says not cancelling (flag false, cancel_at 0)', () => ({ cancelAtPeriodEnd: false, cancelAt: 0 }), 'notCancelling'],
    ['ended (ended_at set)', (row) => ({ endedAt: end(row) - 60 }), 'notCancelling'],
    ['status canceled', () => ({ status: 'canceled' }), 'notCancelling'],
    ['status past_due (F-5)', () => ({ status: 'past_due' }), 'notCancelling'],
    ['status unpaid', () => ({ status: 'unpaid' }), 'notCancelling'],
    ['status incomplete', () => ({ status: 'incomplete' }), 'notCancelling'],
    ['status paused', () => ({ status: 'paused' }), 'notCancelling'],
    ['a different period end (+1 s)', (row) => ({ cancelAt: end(row) + 1, items: [{ currentPeriodEnd: end(row) + 1 }] }), 'periodMismatch'],
    ['a different period end (−1 day)', (row) => ({ cancelAt: end(row) - 86_400 }), 'periodMismatch'],
    ['no cancel_at, item period end differs', (row) => ({ cancelAt: null, items: [{ currentPeriodEnd: end(row) + 3600 }] }), 'periodMismatch'],
    ['no item', () => ({ items: [] }), 'periodMismatch'],
    ['two items', (row) => ({ items: [{ currentPeriodEnd: end(row) }, { currentPeriodEnd: end(row) }] }), 'periodMismatch'],
    ['no cancel_at and the item has no period end', () => ({ cancelAt: null, items: [{ currentPeriodEnd: null }] }), 'periodMismatch'],
    ['C-4: another subscription id', () => ({ id: 'sub_somebodyelse' }), 'mismatch'],
    ['C-4: another customer', () => ({ customerId: 'cus_somebodyelse' }), 'mismatch'],
    ['C-4: customer null', () => ({ customerId: null }), 'mismatch'],
    ['C-4: the other mode', () => ({ livemode: true }), 'mismatch'],
    ['C-4: bos_user_id names another account', () => ({ metadata: { bos_user_id: ACCOUNT_B } }), 'mismatch'],
  ];

  it.each(cases)('%s → %s, released, nothing sent or recorded', async (_label, override, counter) => {
    const row = tableRow(1);
    const { w, deps } = world([row], {}, { sub_qa1: override(row) });
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    expect(counts.examined).toBe(1);
    expect(counts[counter as keyof typeof counts]).toBe(1);
    expect(counts.sent).toBe(0);
    expect(w.sends).toEqual([]);
    expect(w.completes).toEqual([]);
    expect(w.releases).toEqual([expect.objectContaining({ id: row.id, userId: ACCOUNT_A, livemode: false })]);
    expect(row.claimedBy).toBeNull();
    expect(row.cancelReminderSentFor).toBeNull();
    if (counter === 'mismatch') {
      expect(w.logs.some((l) => l.level === 'error' && l.context.alert === true && l.context.reason === 'subscription_record_differs')).toBe(true);
    }
  });

  it('cancel_at set (dashboard) with the flag false still counts as set to end, and is sent', async () => {
    const row = tableRow(1);
    const { w, deps } = world([row], {}, { sub_qa1: { cancelAtPeriodEnd: false } });
    expect((await runPlanCancelReminderPass(deps, ctx(w))).sent).toBe(1);
  });

  it('trialing is reminded', async () => {
    const row = tableRow(1, { status: 'trialing' });
    const { w, deps } = world([row], {}, { sub_qa1: { status: 'trialing' } });
    expect((await runPlanCancelReminderPass(deps, ctx(w))).sent).toBe(1);
  });

  it('F-5: a past_due row is never claimed, and the migration claim names only active and trialing', async () => {
    const row = tableRow(1, { status: 'past_due' });
    const { w, deps } = world([row]);
    expect((await runPlanCancelReminderPass(deps, ctx(w))).examined).toBe(0);
    expect(w.stripeReads).toEqual([]);
    const sql = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261100_business_os_plan_cancel_reminders.sql'), 'utf8');
    expect(sql).toMatch(/c\.subscription_status IN \('active', 'trialing'\)/);
    expect(sql).not.toMatch(/'past_due'/);
  });

  it('C-4: a row the claim returned in the other mode is released with an alert and Stripe is not read', async () => {
    const row = tableRow(1, { livemode: true });
    const { w, deps } = world([row], {
      claim: async (input) => {
        row.claimedBy = input.runnerId;
        row.claimedAt = NOW;
        return { data: [{ ...row }], error: null };
      },
    });
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    expect(counts).toMatchObject({ examined: 1, mismatch: 1, sent: 0 });
    expect(w.stripeReads).toEqual([]);
    expect(w.logs.some((l) => l.context.reason === 'claimed_other_mode' && l.context.alert === true)).toBe(true);
  });
});

describe('QA: tenant isolation', () => {
  it('each send goes to the claimed row\'s own account, with its own subscription, mode, end and key', async () => {
    const rows = [tableRow(1, { userId: ACCOUNT_A }), tableRow(2, { userId: ACCOUNT_B })];
    const { w, deps } = world(rows);
    await runPlanCancelReminderPass(deps, ctx(w));
    expect(w.sends).toHaveLength(2);
    for (const send of w.sends) {
      const row = rows.find((r) => r.stripeSubscriptionId === send.subscriptionId)!;
      expect(send).toEqual({
        event: 'reminder',
        userId: row.userId,
        date: row.currentPeriodEnd,
        subscriptionId: row.stripeSubscriptionId,
        livemode: row.livemode,
        correlationId: 'corr-qa',
        actor: 'system',
        idempotencyKey: `plan-cancel-reminder:${row.id}:${row.currentPeriodEnd}`,
      });
    }
    // Writes are CAS'd on each row's own account.
    for (const c of w.completes) {
      const row = rows.find((r) => r.id === c.id)!;
      expect(c.userId).toBe(row.userId);
    }
  });

  it('Stripe naming account B on account A\'s row sends to NOBODY (neither A nor B)', async () => {
    const rows = [tableRow(1, { userId: ACCOUNT_A })];
    const { w, deps } = world(rows, {}, { sub_qa1: { metadata: { bos_user_id: ACCOUNT_B } } });
    await runPlanCancelReminderPass(deps, ctx(w));
    expect(w.sends).toEqual([]);
  });

  it('the run takes no id from its context: only deadlineAt and correlationId are read', async () => {
    const rows = [tableRow(1)];
    const { w, deps } = world(rows);
    const hostile = { ...ctx(w), userId: ACCOUNT_B, accountId: ACCOUNT_B } as unknown as ReturnType<typeof ctx>;
    await runPlanCancelReminderPass(deps, hostile);
    expect(w.sends.map((s) => s.userId)).toEqual([ACCOUNT_A]);
  });
});

describe('QA: R-B — each port throwing on its own never throws the run', () => {
  const boom = () => {
    throw new Error('boom');
  };
  const ports: Array<[string, Partial<PlanCancelReminderDeps>]> = [
    ['isEnabled', { isEnabled: boom }],
    ['keyLivemode', { keyLivemode: boom }],
    ['stripe factory', { stripe: boom }],
    ['claim (sync throw)', { claim: boom }],
    ['claim (reject)', { claim: async () => boom() }],
    ['retrieveSubscription', { stripe: () => ({ retrieveSubscription: async () => boom() }) }],
    ['retrieveSubscription (sync throw)', { stripe: () => ({ retrieveSubscription: boom }) }],
    ['sendReminder (reject)', { sendReminder: async () => boom() }],
    ['sendReminder (sync throw)', { sendReminder: boom }],
    ['complete (reject)', { complete: async () => boom() }],
    ['complete (sync throw)', { complete: boom }],
    ['complete (error result)', { complete: async () => ({ data: null, error: new Error('db') }) }],
    ['release (reject)', { release: async () => boom() }],
    ['release (sync throw)', { release: boom }],
    ['flushAudit (reject)', { flushAudit: async () => boom() }],
    ['flushAudit (sync throw)', { flushAudit: boom }],
    ['logger.info', { logger: { info: boom, warn: () => undefined, error: () => undefined } }],
    ['logger.warn', { logger: { info: () => undefined, warn: boom, error: () => undefined } }],
    ['logger.error', { logger: { info: () => undefined, warn: () => undefined, error: boom } }],
  ];

  it.each(ports)('%s throws → the run resolves with every count key', async (_label, overrides) => {
    // Two rows: one Stripe says is not cancelling (release path), one sent (complete path).
    const rows = [tableRow(1), tableRow(2)];
    const { w, deps } = world(rows, overrides, { sub_qa2: { cancelAtPeriodEnd: false, cancelAt: null } });
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    expect(Object.keys(counts)).toEqual([...PLAN_CANCEL_REMINDER_COUNT_KEYS]);
  });

  it('a send that throws is not_sent: released, never completed', async () => {
    const { w, deps } = world([tableRow(1)], { sendReminder: async () => boom() });
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    expect(counts).toMatchObject({ examined: 1, notSent: 1, sent: 0 });
    expect(w.completes).toEqual([]);
    expect(w.releases).toHaveLength(1);
  });
});

describe('QA: the deadline', () => {
  it('a clock that moves during sends stops starting rows at the margin; the rest are released, not sent', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => tableRow(i + 1));
    let w0: World | null = null;
    const { w, deps } = world(rows, {
      sendReminder: async (input) => {
        w0!.sends.push(input);
        w0!.clock.now += 10_000; // each send costs 10 s
        return { outcome: 'sent' };
      },
    });
    w0 = w;
    const counts = await runPlanCancelReminderPass(deps, ctx(w));
    // 45 s budget, 8 s margin → rows started at t=0,10,20,30 (37 s is the last start time).
    expect(counts.sent).toBe(4);
    expect(counts.deadlineHit).toBe(1);
    expect(counts.deferred).toBe(6);
    expect(counts.examined).toBe(4);
    expect(w.sends).toHaveLength(4);
    expect(w.releases).toHaveLength(6);
    for (const r of rows.slice(4)) {
      expect(r.claimedBy).toBeNull();
      expect(r.cancelReminderSentFor).toBeNull();
    }
  });

  it('a deadline already past → nothing examined, nothing read or sent, every claimed row released', async () => {
    const rows = [tableRow(1), tableRow(2)];
    const { w, deps } = world(rows);
    const counts = await runPlanCancelReminderPass(deps, { deadlineAt: NOW - 1, correlationId: 'c' });
    expect(counts).toMatchObject({ examined: 0, sent: 0, deferred: 2, deadlineHit: 1 });
    expect(w.stripeReads).toEqual([]);
    expect(w.sends).toEqual([]);
  });

  it('a Stripe read that never answers is cut at the deadline: released and deferred', async () => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    try {
      const { w, deps } = world([tableRow(1)], { stripe: () => ({ retrieveSubscription: () => new Promise(() => undefined) }) });
      const pending = runPlanCancelReminderPass(deps, { deadlineAt: NOW + 20_000, correlationId: 'c' });
      await tick();
      await tick();
      await jest.advanceTimersByTimeAsync(20_001);
      const counts = await pending;
      expect(counts).toMatchObject({ examined: 1, deferred: 1, sent: 0 });
      expect(w.sends).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('QA: the run record and the route', () => {
  it('worst-case counts JSON (each value 5 digits, and the max safe integer) is under 1,024 bytes', () => {
    const job = findBosCronJob('bos-plan-cancel-reminders')!;
    const fiveDigits = Object.fromEntries(job.counts.map((c) => [c.key, 99_999]));
    const maxSafe = Object.fromEntries(job.counts.map((c) => [c.key, Number.MAX_SAFE_INTEGER]));
    expect(Buffer.byteLength(JSON.stringify(fiveDigits), 'utf8')).toBeLessThan(1024);
    expect(Buffer.byteLength(JSON.stringify(maxSafe), 'utf8')).toBeLessThan(1024);
    // The actual record holds what the registry paths pick out of the route body.
    expect(job.counts.every((c) => c.path.length === 2 && c.path[0] === 'data')).toBe(true);
  });

  it('the lease (90 s) is longer than the route maxDuration, read from the route source', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'api', 'cron', 'bos-plan-cancel-reminders', 'route.ts'), 'utf8');
    const maxDuration = Number(/export const maxDuration = (\d+);/.exec(src)?.[1]);
    expect(PLAN_CANCEL_REMINDER_POLICY.leaseSeconds * 1000).toBeGreaterThan(maxDuration * 1000);
    expect(PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS + PLAN_CANCEL_REMINDER_POLICY.rowMarginMs).toBeLessThanOrEqual(maxDuration * 1000);
  });
});

describe('QA: the provider idempotency key', () => {
  it('is exactly plan-cancel-reminder:{billingRowId}:{periodEnd}, ids and a date only, 82 chars, inside 1..256', () => {
    const id = '22222222-2222-4222-8222-000000000001';
    const end = '2026-11-01T07:05:22.000Z';
    const key = planCancelReminderIdempotencyKey(id, end);
    expect(key).toBe(`plan-cancel-reminder:${id}:${end}`);
    expect(key).toMatch(/^plan-cancel-reminder:[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(key.length).toBe(82);
    expect(key.length).toBeLessThanOrEqual(IDEMPOTENCY_KEY_MAX_LENGTH);
    expect(IDEMPOTENCY_KEY_MAX_LENGTH).toBe(256);
    expect(key).not.toMatch(/@/);
  });

  it('the key changes with the period end (a later period gets its own key), not with the run', async () => {
    const row = tableRow(1);
    const { w, deps } = world([row], {}, {}, { outcome: () => ({ outcome: 'not_sent', reason: 'transport_failed' }) });
    await runPlanCancelReminderPass(deps, ctx(w));
    w.clock.now += 60 * 60 * 1000;
    await runPlanCancelReminderPass(deps, ctx(w));
    expect(w.sends).toHaveLength(2);
    expect(w.sends[0].idempotencyKey).toBe(w.sends[1].idempotencyKey);
    expect(planCancelReminderIdempotencyKey(row.id, '2026-12-01T00:00:00.000Z')).not.toBe(w.sends[0].idempotencyKey);
  });
});

describe('QA: no personal data in the run logs', () => {
  it('every log context carries ids, numbers and reason codes only', async () => {
    const rows = [tableRow(1), tableRow(2), tableRow(3)];
    const { w, deps } = world(
      rows,
      {},
      { sub_qa2: { customerId: 'cus_other' }, sub_qa3: { cancelAtPeriodEnd: false, cancelAt: null } },
      { outcome: (input) => (input.subscriptionId === 'sub_qa1' ? { outcome: 'not_sent', reason: 'transport_failed' } : { outcome: 'sent' }) }
    );
    await runPlanCancelReminderPass(deps, ctx(w));
    const allowed = new Set(['event', 'correlationId', 'billingAccountId', 'userId', 'subscriptionId', 'livemode', 'alert', 'reason', 'outcome', 'err', 'counts']);
    for (const entry of w.logs) {
      for (const key of Object.keys(entry.context)) expect(allowed.has(key)).toBe(true);
    }
    const dump = JSON.stringify(w.logs);
    expect(dump).not.toMatch(/@/);
    expect(dump).not.toMatch(/Test Flight|plan name/i);
  });
});
