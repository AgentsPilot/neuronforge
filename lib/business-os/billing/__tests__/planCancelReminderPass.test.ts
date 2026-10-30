/**
 * The plan-ends reminder run (account deletion lifecycle D4b / SX-3 part 2;
 * workplan §3.4, §8 row 6 and the D4b addendum; SA S-3, S-5, S-12, S-14, S-15,
 * DR-2, DR-5, R-A, R-B; durable-queue-drain Step 10).
 *
 * Pure: every port is a fake. The claim fake models the SQL: FOR UPDATE SKIP
 * LOCKED (a leased row is invisible to a second runner), the lease expiry,
 * the window, one mode, and "no reminder for this period end yet".
 */

import * as fs from 'fs';
import * as path from 'path';

import { BOS_CRON_JOBS, findBosCronJob } from '@/lib/cron/bosCronJobs';

import type { PlanCancelEmailInput, PlanCancelEmailOutcome } from '../planCancelEmail';
import {
  PLAN_CANCEL_REMINDER_COUNT_KEYS,
  PLAN_CANCEL_REMINDER_POLICY,
  PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS,
  decideReminderRow,
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

/** A billing row as the table holds it, for the claim model. */
interface TableRow extends PlanCancelReminderRow {
  cancelAtPeriodEnd: boolean;
  status: string;
  ended: boolean;
  claimedBy: string | null;
  claimedAt: number | null;
  closureOpen?: boolean;
}

function tableRow(n: number, overrides: Partial<TableRow> = {}): TableRow {
  const end = new Date(Math.floor((NOW + 2 * DAY) / 1000) * 1000).toISOString();
  return {
    id: `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`,
    userId: ACCOUNT_A,
    livemode: false,
    stripeSubscriptionId: `sub_row${n}`,
    stripeCustomerId: `cus_row${n}`,
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
  flushes: number;
}

/** The SQL claim, modelled: SKIP LOCKED, lease expiry, window, mode, not reminded, no open closure. */
function modelClaim(world: World) {
  return async (input: { runnerId: string; livemode: boolean; windowSeconds: number; leaseSeconds: number; batch: number }) => {
    const now = world.clock.now;
    const picked = world.table
      .filter(
        (r) =>
          r.livemode === input.livemode &&
          r.cancelAtPeriodEnd &&
          !r.ended &&
          ['active', 'trialing'].includes(r.status) &&
          Date.parse(r.currentPeriodEnd) > now &&
          Date.parse(r.currentPeriodEnd) <= now + input.windowSeconds * 1000 &&
          r.cancelReminderSentFor !== r.currentPeriodEnd &&
          (r.claimedAt === null || r.claimedAt < now - input.leaseSeconds * 1000) &&
          !r.closureOpen
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
  };
}

let runnerSeq = 0;

function world(rows: TableRow[], overrides: Partial<PlanCancelReminderDeps> = {}, stripeOverrides: Record<string, Partial<PlanCancelReminderSubscriptionFacts>> = {}) {
  const w: World = { table: rows, clock: { now: NOW }, sends: [], completes: [], releases: [], logs: [], stripeReads: [], flushes: 0 };
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
    claim: modelClaim(w),
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
      return { outcome: 'sent' };
    },
    flushAudit: async () => {
      w.flushes += 1;
    },
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now: () => w.clock.now,
    ...overrides,
  };
  return { w, deps };
}

const CONTEXT = { deadlineAt: NOW + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS, correlationId: 'corr-cron' };

describe('the switch and the preconditions (S-15, S-12, R-B)', () => {
  it('off → skipped: 1, nothing claimed, read, sent or flushed', async () => {
    const { w, deps } = world([tableRow(1)], { isEnabled: () => false });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toEqual({ ...zero(), skipped: 1 });
    expect(w.table[0].claimedBy).toBeNull();
    expect(w.stripeReads).toEqual([]);
    expect(w.sends).toEqual([]);
    expect(w.flushes).toBe(0);
  });

  it.each([
    ['the key mode cannot be told', { keyLivemode: () => null }],
    ['the key mode reader throws', { keyLivemode: () => { throw new Error('no key'); } }],
    ['Stripe is not configured', { stripe: () => null }],
    ['the claim fails (20261100 not applied yet)', { claim: async () => ({ data: null, error: new Error('Could not find the function') }) }],
    ['the claim throws', { claim: async () => { throw new Error('boom'); } }],
  ] as Array<[string, Partial<PlanCancelReminderDeps>]>)('%s → deferred: 1 with an alert, nothing sent, never thrown', async (_label, overrides) => {
    const { w, deps } = world([tableRow(1)], overrides);
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toEqual({ ...zero(), deferred: 1 });
    expect(w.sends).toEqual([]);
    expect(w.logs.some((l) => l.level === 'error' && l.context.alert === true)).toBe(true);
  });
});

describe('the claim (durable-queue-drain Step 10)', () => {
  it('two concurrent runs never send to the same row, and every row is sent exactly once', async () => {
    const rows = Array.from({ length: 40 }, (_, i) => tableRow(i + 1));
    const shared = world(rows);
    const [a, b] = await Promise.all([runPlanCancelReminderPass(shared.deps, CONTEXT), runPlanCancelReminderPass(shared.deps, CONTEXT)]);
    const sentTo = shared.w.sends.map((s) => s.subscriptionId);
    expect(new Set(sentTo).size).toBe(sentTo.length);
    expect(a.sent + b.sent).toBe(40);
    expect(Math.max(a.examined, b.examined)).toBeLessThanOrEqual(PLAN_CANCEL_REMINDER_POLICY.batch);
  });

  it('a sent row is completed with ITS period end and never claimed again (once per period end)', async () => {
    const { w, deps } = world([tableRow(1)]);
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).sent).toBe(1);
    expect(w.completes).toEqual([
      { id: w.table[0].id, userId: ACCOUNT_A, livemode: false, runnerId: expect.any(String), periodEnd: w.table[0].currentPeriodEnd },
    ]);
    expect(w.table[0].cancelReminderSentFor).toBe(w.table[0].currentPeriodEnd);
    w.clock.now += DAY;
    const second = await runPlanCancelReminderPass(deps, { ...CONTEXT, deadlineAt: w.clock.now + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS });
    expect(second.examined).toBe(0);
    expect(w.sends).toHaveLength(1);
  });

  it('a later period end gets its own reminder', async () => {
    const { w, deps } = world([tableRow(1)]);
    await runPlanCancelReminderPass(deps, CONTEXT);
    // The plan renewed and was cancelled again in its next period.
    w.table[0].currentPeriodEnd = new Date(Date.parse(w.table[0].currentPeriodEnd) + 30 * DAY).toISOString();
    w.clock.now += 30 * DAY;
    await runPlanCancelReminderPass(deps, { ...CONTEXT, deadlineAt: w.clock.now + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS });
    expect(w.sends).toHaveLength(2);
  });

  it('only the current key mode is claimed (S-12)', async () => {
    const { w, deps } = world([tableRow(1, { livemode: true }), tableRow(2)]);
    await runPlanCancelReminderPass(deps, CONTEXT);
    expect(w.sends.map((s) => s.subscriptionId)).toEqual(['sub_row2']);
  });

  it('DR-2: an account with an open closure is left out by the claim', async () => {
    const { w, deps } = world([tableRow(1, { closureOpen: true })]);
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).examined).toBe(0);
    expect(w.sends).toEqual([]);
  });

  it('the claim asks for the policy: 3-day window, 90 s lease, batch 25, the key mode', async () => {
    const asked: unknown[] = [];
    const { deps } = world([], {
      claim: async (input) => {
        asked.push(input);
        return { data: [], error: null };
      },
    });
    await runPlanCancelReminderPass(deps, CONTEXT);
    expect(asked).toEqual([{ runnerId: expect.any(String), livemode: false, windowSeconds: 259_200, leaseSeconds: 90, batch: 25 }]);
  });
});

describe('the choke point: Stripe fresh (S-14, C-4, S-5)', () => {
  it.each([
    ['the flag is off and there is no cancel_at', { cancelAtPeriodEnd: false, cancelAt: null }, 'notCancelling'],
    ['the subscription has ended', { endedAt: 1_800_000_000, status: 'canceled' }, 'notCancelling'],
    ['the status is past_due', { status: 'past_due' }, 'notCancelling'],
    ['Stripe ends it on another date', { cancelAt: 1_900_000_000 }, 'periodMismatch'],
    // C-3 (PR #571, isSetToEndThisPeriod): a dashboard `cancel_at` AFTER the period end renews once more.
    ['cancel_at alone, after the period end (renews once more)', { cancelAtPeriodEnd: false, cancelAt: 1_900_000_000 }, 'notCancelling'],
    ['cancel_at alone, before the period end (an early dashboard date)', { cancelAtPeriodEnd: false, cancelAt: 1_000_000_000 }, 'periodMismatch'],
    ['two items', { items: [{ currentPeriodEnd: 1 }, { currentPeriodEnd: 2 }] }, 'periodMismatch'],
  ] as Array<[string, Partial<PlanCancelReminderSubscriptionFacts>, string]>)('%s → released, not sent, not recorded, counted %s', async (_label, fresh, counter) => {
    const { w, deps } = world([tableRow(1)], {}, { sub_row1: fresh });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts[counter as keyof typeof counts]).toBe(1);
    expect(w.sends).toEqual([]);
    expect(w.completes).toEqual([]);
    expect(w.releases).toHaveLength(1);
    expect(w.table[0].cancelReminderSentFor).toBeNull();
    expect(w.table[0].claimedBy).toBeNull();
  });

  it('cancel_at alone (set from the dashboard) still counts as set to end; its date is Stripe\'s', async () => {
    const { w, deps } = world([tableRow(1)], {}, { sub_row1: { cancelAtPeriodEnd: false } });
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).sent).toBe(1);
    expect(w.sends).toHaveLength(1);
  });

  it('no cancel_at: the ONE item\'s period end is the date', async () => {
    const { w, deps } = world([tableRow(1)], {}, { sub_row1: { cancelAt: null } });
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).sent).toBe(1);
    expect(w.sends).toHaveLength(1);
  });

  it.each([
    ['another subscription id', { id: 'sub_other' }],
    ['another customer', { customerId: 'cus_other' }],
    ['another mode', { livemode: true }],
    ['another account in bos_user_id', { metadata: { bos_user_id: ACCOUNT_B } }],
  ] as Array<[string, Partial<PlanCancelReminderSubscriptionFacts>]>)('C-4: %s → released, mismatch counted, alert, nothing sent', async (_label, fresh) => {
    const { w, deps } = world([tableRow(1)], {}, { sub_row1: fresh });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts.mismatch).toBe(1);
    expect(w.sends).toEqual([]);
    expect(w.releases).toHaveLength(1);
    expect(w.logs.some((l) => l.level === 'error' && l.context.alert === true && l.context.reason === 'subscription_record_differs')).toBe(true);
  });

  it('no bos_user_id on the subscription is not a mismatch (C-4 as the engine reads it)', () => {
    const row = tableRow(1);
    expect(decideReminderRow(row, freshFor(row, { metadata: {} }), false)).toEqual({ kind: 'send' });
  });

  it('a Stripe read that fails → released and deferred, nothing sent', async () => {
    const { w, deps } = world([tableRow(1)], {
      stripe: () => ({
        retrieveSubscription: async () => {
          throw new Error('stripe down');
        },
      }),
    });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toMatchObject({ examined: 1, deferred: 1, sent: 0 });
    expect(w.releases).toHaveLength(1);
  });

  it('S-5: the run never writes anything but the claim columns (no heal)', async () => {
    const { w, deps } = world([tableRow(1)], {}, { sub_row1: { cancelAtPeriodEnd: false, cancelAt: null } });
    await runPlanCancelReminderPass(deps, CONTEXT);
    // Our row still says it is set to end: the webhook converges it, not this run.
    expect(w.table[0].cancelAtPeriodEnd).toBe(true);
    // The ports offer no other write, and the run names no billing or Stripe write.
    const source = fs.readFileSync(path.join(ROOT, 'lib', 'business-os', 'billing', 'planCancelReminderPass.ts'), 'utf8');
    expect(source).not.toMatch(/mirrorSubscriptionState|setBusinessOsCancelAtPeriodEnd|cancelBusinessOsSubscriptionNow/);
  });
});

describe('send, then complete or release (DR-5)', () => {
  it('the email goes to the claimed row\'s own account, actor system, the reminder event, the row\'s period end and the provider key', async () => {
    const { w, deps } = world([tableRow(1)]);
    await runPlanCancelReminderPass(deps, CONTEXT);
    const row = w.table[0];
    expect(w.sends).toEqual([
      {
        event: 'reminder',
        userId: ACCOUNT_A,
        date: row.currentPeriodEnd,
        subscriptionId: 'sub_row1',
        livemode: false,
        correlationId: 'corr-cron',
        actor: 'system',
        idempotencyKey: `plan-cancel-reminder:${row.id}:${row.currentPeriodEnd}`,
      },
    ]);
    expect(planCancelReminderIdempotencyKey(row.id, row.currentPeriodEnd).length).toBeLessThanOrEqual(256);
  });

  it('unknown → COMPLETED (at most once), counted notSent', async () => {
    const { w, deps } = world([tableRow(1)], { sendReminder: async () => ({ outcome: 'unknown', reason: 'deadline_exceeded' }) });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toMatchObject({ sent: 0, notSent: 1 });
    expect(w.completes).toHaveLength(1);
    expect(w.releases).toEqual([]);
    expect(w.table[0].cancelReminderSentFor).toBe(w.table[0].currentPeriodEnd);
  });

  it('not_sent → RELEASED (retried by a later run while still inside the window), counted notSent', async () => {
    const { w, deps } = world([tableRow(1)], { sendReminder: async () => ({ outcome: 'not_sent', reason: 'sender_not_configured' }) });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toMatchObject({ sent: 0, notSent: 1 });
    expect(w.completes).toEqual([]);
    expect(w.releases).toHaveLength(1);
    expect(w.table[0].cancelReminderSentFor).toBeNull();
    // The next day's run tries again.
    w.clock.now += DAY;
    deps.sendReminder = async (input) => {
      w.sends.push(input);
      return { outcome: 'sent' };
    };
    expect((await runPlanCancelReminderPass(deps, { ...CONTEXT, deadlineAt: w.clock.now + PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS })).sent).toBe(1);
  });

  it('a send that throws is a not_sent: released', async () => {
    const { w, deps } = world([tableRow(1)], {
      sendReminder: async () => {
        throw new Error('boom');
      },
    });
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).notSent).toBe(1);
    expect(w.releases).toHaveLength(1);
  });

  it('the switch going off mid-run (skipped) → released and deferred', async () => {
    const { w, deps } = world([tableRow(1)], { sendReminder: async () => ({ outcome: 'skipped' }) });
    expect((await runPlanCancelReminderPass(deps, CONTEXT)).deferred).toBe(1);
    expect(w.releases).toHaveLength(1);
  });

  it('a complete that fails after a send → alert, the run goes on', async () => {
    const { w, deps } = world([tableRow(1), tableRow(2)], { complete: async () => ({ data: null, error: new Error('down') }) });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts.sent).toBe(2);
    expect(w.logs.filter((l) => l.level === 'error' && l.context.reason === 'complete_failed' && l.context.alert === true)).toHaveLength(2);
  });

  it('a row whose record already covers its period end (the cancel email, R-D) is released and counted covered, never sent', async () => {
    const row = tableRow(1);
    const { w, deps } = world([], {
      claim: async () => ({ data: [{ ...row, cancelReminderSentFor: row.currentPeriodEnd }], error: null }),
    });
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toMatchObject({ examined: 1, covered: 1, sent: 0 });
    expect(w.sends).toEqual([]);
    expect(w.releases).toHaveLength(1);
  });

  it('the audit queue is flushed once at the end', async () => {
    const { w, deps } = world([tableRow(1), tableRow(2)]);
    await runPlanCancelReminderPass(deps, CONTEXT);
    expect(w.flushes).toBe(1);
  });
});

describe('the deadline and R-B', () => {
  it('no row is started with less than the margin left: the rest are released, deferred, deadlineHit 1', async () => {
    const rows = [tableRow(1), tableRow(2), tableRow(3)];
    const { w, deps } = world(rows);
    const send = deps.sendReminder;
    deps.sendReminder = async (input) => {
      // The first send takes 40 s of the 45 s budget: 5 s left is under the 8 s margin.
      w.clock.now += 40_000;
      return send(input);
    };
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(counts).toMatchObject({ examined: 1, sent: 1, deferred: 2, deadlineHit: 1 });
    expect(w.releases.map((r) => r.id)).toEqual([rows[1].id, rows[2].id]);
    expect(w.logs.some((l) => l.level === 'warn' && l.message.includes('left rows'))).toBe(true);
  });

  it('never throws: every port throwing at once still returns counts', async () => {
    const boom = () => {
      throw new Error('boom');
    };
    const { deps } = world([tableRow(1)], {
      complete: async () => boom(),
      release: async () => boom(),
      flushAudit: async () => boom(),
      logger: { info: boom, warn: boom, error: boom },
      stripe: () => ({ retrieveSubscription: async () => boom() }),
    });
    await expect(runPlanCancelReminderPass(deps, CONTEXT)).resolves.toMatchObject({ examined: 1, deferred: 1 });
  });

  it('S-3 a: the lease outlives the route, so a lease older than it is provably dead', () => {
    const route = fs.readFileSync(path.join(ROOT, 'app', 'api', 'cron', 'bos-plan-cancel-reminders', 'route.ts'), 'utf8');
    const maxDuration = Number(route.match(/export const maxDuration = (\d+);/)?.[1]);
    expect(maxDuration).toBe(60);
    expect(PLAN_CANCEL_REMINDER_POLICY.leaseSeconds).toBeGreaterThan(maxDuration);
    expect(PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS).toBeLessThan(maxDuration * 1000);
    expect(PLAN_CANCEL_REMINDER_RUN_DEADLINE_MS).toBe(45_000);
    expect(PLAN_CANCEL_REMINDER_POLICY.batch).toBe(25);
  });
});

describe('logs and counts carry no personal data', () => {
  it('no address, name or plan name in any log line (the pass never sees one)', async () => {
    const { w, deps } = world([tableRow(1), tableRow(2, { stripeSubscriptionId: 'sub_row2' })], {}, { sub_row2: { customerId: 'cus_other' } });
    await runPlanCancelReminderPass(deps, CONTEXT);
    const dump = JSON.stringify(w.logs);
    expect(dump).not.toMatch(/@/);
    expect(dump).not.toContain('Test Flight');
  });
});

describe('R-A: the run record', () => {
  const job = findBosCronJob('bos-plan-cancel-reminders');

  it('the registry lists exactly the pass\'s count keys, in order, both ways, unprefixed, and drains no queue', () => {
    expect(job).toBeDefined();
    expect(job!.counts.map((c) => c.key)).toEqual([...PLAN_CANCEL_REMINDER_COUNT_KEYS]);
    for (const count of job!.counts) expect(count.path).toEqual(['data', count.key]);
    expect(job!.drainsQueue).toBeNull();
    expect(job!.schedule).toBe('53 5 * * *');
    expect(BOS_CRON_JOBS.filter((j) => j.schedule === '53 5 * * *')).toHaveLength(1);
  });

  it('the worst-case counts JSON fits the run record\'s 1,024-byte CHECK', () => {
    const worst = Object.fromEntries(job!.counts.map((c) => [c.key, Number.MAX_SAFE_INTEGER]));
    expect(Buffer.byteLength(JSON.stringify(worst), 'utf8')).toBeLessThan(1024);
  });

  it('the pass returns exactly the registry keys', async () => {
    const { deps } = world([tableRow(1)]);
    const counts = await runPlanCancelReminderPass(deps, CONTEXT);
    expect(Object.keys(counts)).toEqual([...PLAN_CANCEL_REMINDER_COUNT_KEYS]);
    for (const value of Object.values(counts)) expect(Number.isInteger(value)).toBe(true);
  });
});

function zero(): Record<(typeof PLAN_CANCEL_REMINDER_COUNT_KEYS)[number], number> {
  return Object.fromEntries(PLAN_CANCEL_REMINDER_COUNT_KEYS.map((key) => [key, 0])) as Record<(typeof PLAN_CANCEL_REMINDER_COUNT_KEYS)[number], number>;
}
