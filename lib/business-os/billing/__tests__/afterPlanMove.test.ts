/**
 * The after-plan move (account-deletion lifecycle D3.1 / SX-2b; workplan §6.2,
 * §10; SA S-5, S-7, DR-4 to DR-10; user U-1, U-2, U-5).
 *
 * Pure Jest with injected ports and the production entitlements config: no
 * database, no Stripe. The plan row is typed through the account seam, so this
 * suite names no repository (RC-15).
 */

import type { Logger } from '@/lib/logger';
import { fromPlanRow } from '@/lib/business-os/entitlements/account';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { COHORTS, type CohortConfig, type CohortId } from '@/lib/business-os/entitlements/config/cohorts';
import { LIFECYCLE_CONFIG } from '@/lib/business-os/entitlements/config/lifecycle';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { tierSettlementEndsAt } from '@/lib/business-os/entitlements/lifecycle';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  AFTER_PLAN_MOVE_AUDIT_ACTION,
  moveToFreeCohortAfterPlan,
  type AfterPlanMoveDeps,
  type AfterPlanMoveInput,
  type AfterPlanMoveRead,
  type AfterPlanMoveWrite,
  type AfterPlanMoveWriteResult,
} from '@/lib/business-os/billing/afterPlanMove';
import { AUDIT_EVENTS } from '@/lib/audit/events';

type PlanRow = Parameters<typeof fromPlanRow>[0];

const DAY = 24 * 60 * 60 * 1000;
const ACCOUNT = '11111111-2222-4333-8444-555555555555';
const ENDED = '2026-11-26T10:00:00.000Z';
const NOW = '2026-11-26T10:05:00.000Z';
const UPDATED_AT = '2026-10-26T10:00:00.123456+00:00';
const TOP = TIER_ORDER[TIER_ORDER.length - 1];
const ADMIN_DATED = (Object.entries(COHORTS) as Array<[string, CohortConfig]>).find(([, c]) => !c.durationHistory)![0];
const SETTLED = tierSettlementEndsAt(ENDED, LIFECYCLE_CONFIG.renewalSettlementMarginHistory);
const plusDays = (iso: string, days: number) => new Date(Date.parse(iso) + days * DAY).toISOString();

const INPUT: AfterPlanMoveInput = {
  accountId: ACCOUNT,
  subscriptionId: 'sub_NEW',
  livemode: false,
  stripeEventId: 'evt_1',
  endedAt: ENDED,
  cancellationReason: 'cancellation_requested',
};

function planRow(overrides: Partial<PlanRow> = {}): PlanRow {
  return {
    user_id: ACCOUNT, tier: TOP, plan_version: 0, tier_expires_at: ENDED, cohort: AFTER_PLAN.cohort, cohort_expires_at: null,
    onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: null, trial_started_at: null, trial_ends_at: null,
    grace_ends_at: null, period_anchor: '2026-10-26T10:00:00+00:00', origin: 'admin', updated_by_admin_id: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: UPDATED_AT, ...overrides,
  };
}

interface Entry {
  level: 'info' | 'warn' | 'error';
  fields: Record<string, unknown>;
  message: string;
}

function fakeLog() {
  const entries: Entry[] = [];
  const at = (level: Entry['level']) => (fields: Record<string, unknown>, message: string) => entries.push({ level, fields, message });
  const child: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: () => undefined };
  child.child = () => child;
  return { log: { ...child, child: () => child } as unknown as Logger, entries };
}

function harness(options: {
  read?: AfterPlanMoveRead | null | Error;
  write?: AfterPlanMoveWriteResult | Error | Array<AfterPlanMoveWriteResult>;
  record?: (input: RecordPlanChangeInput) => Promise<void>;
  now?: string;
  deps?: Partial<AfterPlanMoveDeps>;
} = {}) {
  const reads: string[] = [];
  const writes: AfterPlanMoveWrite[] = [];
  const audits: RecordPlanChangeInput[] = [];
  const writeAnswers = Array.isArray(options.write) ? [...options.write] : null;
  const deps: AfterPlanMoveDeps = {
    readMoveInputs: async (accountId) => {
      reads.push(accountId);
      const read = options.read === undefined ? { plan: planRow(), moves: 0, lastSubscriptionId: null } : options.read;
      if (read instanceof Error) return { data: null, error: read };
      return { data: read, error: null };
    },
    writeMove: async (input) => {
      writes.push(input);
      const answer = writeAnswers ? writeAnswers.shift()! : options.write ?? { outcome: 'applied', moves: input.expected.moves + 1 };
      if (answer instanceof Error) return { data: null, error: answer };
      return { data: answer as AfterPlanMoveWriteResult, error: null };
    },
    config: () => getEntitlementConfig(),
    recordPlanChange: options.record ?? (async (input) => void audits.push(input)),
    now: () => new Date(options.now ?? NOW),
    ...options.deps,
  };
  const { log, entries } = fakeLog();
  return { deps, log, entries, reads, writes, audits };
}

const skips = (entries: Entry[]) => entries.filter((e) => e.fields.event === 'bos_plan_after_plan_skipped').map((e) => [e.level, e.fields.skip]);

describe('reason: only an owner-started end gives the free period (BQ-20, U-2, U-5)', () => {
  it.each(['payment_failed', 'payment_disputed', null, 'something_new'])('%s → no read, no write, no audit', async (reason) => {
    const h = harness();
    await moveToFreeCohortAfterPlan({ ...INPUT, cancellationReason: reason }, h.log, h.deps);
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(skips(h.entries)).toEqual([['info', 'not_owner_end']]);
  });

  it('cancellation_requested → the move, using ONLY the account id passed in', async () => {
    const h = harness();
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.reads).toEqual([ACCOUNT]);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].accountId).toBe(ACCOUNT);
  });
});

describe('the write (S-2, S-5, DR-5)', () => {
  it('a first period-end cancel: the cohort, 14 days from the settlement end, the anchor at the end, count + 1', async () => {
    const h = harness();
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes[0]).toEqual({
      accountId: ACCOUNT,
      expected: { updatedAt: UPDATED_AT, moves: 0 },
      cohort: AFTER_PLAN.cohort,
      trialStartedAt: SETTLED,
      trialEndsAt: plusDays(SETTLED, 14),
      clearGraceEndsAt: false,
      periodAnchor: ENDED,
      subscriptionId: 'sub_NEW',
    });
    expect(h.entries.find((e) => e.fields.event === 'bos_plan_after_plan_moved')).toMatchObject({ level: 'info', fields: { days: 14, priorMoves: 0 } });
  });

  it.each([
    [0, 14],
    [1, 7],
    [4, 1],
  ])('halving: %i earlier move(s) → %i days written, expected count passed through', async (moves, days) => {
    const h = harness({ read: { plan: planRow(), moves, lastSubscriptionId: moves === 0 ? null : 'sub_OLD' } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes[0].trialEndsAt).toBe(plusDays(SETTLED, days));
    expect(h.writes[0].expected.moves).toBe(moves);
  });

  it('S-5: a test clock whose ended_at is ahead of real time anchors at now, never in the future', async () => {
    const h = harness({ now: '2026-10-28T00:00:00.000Z' });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes[0].periodAnchor).toBe('2026-10-28T00:00:00.000Z');
  });

  it('S-4: a stale grace pin is cleared through the named flag', async () => {
    const h = harness({ read: { plan: planRow({ grace_ends_at: '2026-06-01T00:00:00.000Z' }), moves: 0, lastSubscriptionId: null } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes[0].clearGraceEndsAt).toBe(true);
  });

  it('U-5: a cancel of a lapsed (past_due) tier starts the free period at the end itself', async () => {
    const h = harness({ read: { plan: planRow({ tier_expires_at: '2026-10-26T10:00:00.000Z' }), moves: 0, lastSubscriptionId: null } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes[0].trialStartedAt).toBe(ENDED);
  });
});

describe('idempotency (R-2, AC-D31.4)', () => {
  it('the last move came from this subscription → no write, no audit', async () => {
    const h = harness({ read: { plan: planRow({ cohort: AFTER_PLAN.cohort }), moves: 1, lastSubscriptionId: 'sub_NEW' } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes).toEqual([]);
    expect(h.audits).toEqual([]);
    expect(skips(h.entries)).toEqual([['info', 'already_applied']]);
  });

  it('a stale write throws (claim released), warn not error; the retry with the updated row reads already_applied', async () => {
    const first = harness({ write: { outcome: 'stale' } });
    await expect(moveToFreeCohortAfterPlan(INPUT, first.log, first.deps)).rejects.toThrow(/changed since it was read/);
    expect(first.audits).toEqual([]);
    expect(first.entries.find((e) => e.fields.event === 'bos_plan_after_plan_stale')?.level).toBe('warn');

    const retry = harness({ read: { plan: planRow({ updated_at: '2026-11-26T10:00:01Z' }), moves: 1, lastSubscriptionId: 'sub_NEW' } });
    await moveToFreeCohortAfterPlan(INPUT, retry.log, retry.deps);
    expect(retry.writes).toEqual([]);
    expect(skips(retry.entries)).toEqual([['info', 'already_applied']]);
  });

  it('two parallel deliveries: the compare-and-set lets one write; the other is stale and throws', async () => {
    const h = harness({ write: [{ outcome: 'applied', moves: 1 }, { outcome: 'stale' }] });
    const results = await Promise.allSettled([
      moveToFreeCohortAfterPlan(INPUT, h.log, h.deps),
      moveToFreeCohortAfterPlan(INPUT, h.log, h.deps),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(h.audits).toHaveLength(1);
  });

  it('replay (P-8b reconcile): the same subscription run twice against the stored row: the second run is a no-op (no move, no anchor change, no audit)', async () => {
    // A stateful store: the write lands on the row the next read returns, as the plan table does.
    const store: AfterPlanMoveRead = { plan: planRow(), moves: 0, lastSubscriptionId: null };
    const writes: AfterPlanMoveWrite[] = [];
    const audits: RecordPlanChangeInput[] = [];
    const deps: AfterPlanMoveDeps = {
      readMoveInputs: async () => ({ data: { plan: { ...store.plan }, moves: store.moves, lastSubscriptionId: store.lastSubscriptionId }, error: null }),
      writeMove: async (input) => {
        writes.push(input);
        if (input.expected.updatedAt !== store.plan.updated_at || input.expected.moves !== store.moves) return { data: { outcome: 'stale' }, error: null };
        store.plan = {
          ...store.plan,
          cohort: input.cohort,
          trial_started_at: input.trialStartedAt,
          trial_ends_at: input.trialEndsAt,
          grace_ends_at: input.clearGraceEndsAt ? null : store.plan.grace_ends_at,
          period_anchor: input.periodAnchor,
          updated_at: '2026-11-26T10:05:00.000001+00:00',
        };
        store.moves += 1;
        store.lastSubscriptionId = input.subscriptionId;
        return { data: { outcome: 'applied', moves: store.moves }, error: null };
      },
      config: () => getEntitlementConfig(),
      recordPlanChange: async (input) => void audits.push(input),
      now: () => new Date(NOW),
    };

    const first = fakeLog();
    await moveToFreeCohortAfterPlan(INPUT, first.log, deps);
    expect(writes).toHaveLength(1);
    expect(store.moves).toBe(1);
    expect(store.lastSubscriptionId).toBe(INPUT.subscriptionId);
    expect(audits.map((a) => a.action)).toEqual([AFTER_PLAN_MOVE_AUDIT_ACTION]);
    const afterFirst = JSON.parse(JSON.stringify(store)) as AfterPlanMoveRead;

    const replay = fakeLog();
    await expect(moveToFreeCohortAfterPlan(INPUT, replay.log, deps)).resolves.toBeUndefined();
    expect(writes).toHaveLength(1); // no second write
    expect(store).toEqual(afterFirst); // after_plan_moves still 1, period_anchor unchanged
    expect(store.plan.period_anchor).toBe(afterFirst.plan.period_anchor);
    expect(audits).toHaveLength(1); // no second BOS_PLAN_FREE_PERIOD_AFTER_CANCEL
    expect(skips(replay.entries)).toEqual([['info', 'already_applied']]);
  });
});

describe('nothing moves, and the count does not change', () => {
  it('a Founding Partner whose free access outlives the plan (BQ-5): info, no write', async () => {
    for (const cohortExpiresAt of [null, '2027-03-01T00:00:00.000Z']) {
      const h = harness({ read: { plan: planRow({ cohort: ADMIN_DATED, cohort_expires_at: cohortExpiresAt }), moves: 2, lastSubscriptionId: 'sub_OLD' } });
      await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
      expect(h.writes).toEqual([]);
      expect(h.audits).toEqual([]);
      expect(skips(h.entries)).toEqual([['info', 'own_cohort_survives']]);
    }
  });

  it('S-11 replacement: paid through after the end → error + alert, no write, no throw', async () => {
    const h = harness({ read: { plan: planRow({ tier_expires_at: plusDays(ENDED, 30) }), moves: 0, lastSubscriptionId: null } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes).toEqual([]);
    const entry = h.entries.find((e) => e.fields.skip === 'paid_through_after_end')!;
    expect(entry.level).toBe('error');
    expect(entry.fields.alert).toBe(true);
  });

  it('no end date → warn, no read', async () => {
    const h = harness();
    await moveToFreeCohortAfterPlan({ ...INPUT, endedAt: null }, h.log, h.deps);
    expect(h.reads).toEqual([]);
    expect(skips(h.entries)).toEqual([['warn', 'no_end_date']]);
  });

  it('no plan row → warn, no write', async () => {
    const h = harness({ read: null });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.writes).toEqual([]);
    expect(skips(h.entries)).toEqual([['warn', 'no_plan_row']]);
  });

  it('a misconfigured AFTER_PLAN → error + alert, no read, no write, no throw', async () => {
    const h = harness({ deps: { afterPlan: { cohort: 'no_such_cohort' as CohortId, repeat: AFTER_PLAN.repeat } } });
    await expect(moveToFreeCohortAfterPlan(INPUT, h.log, h.deps)).resolves.toBeUndefined();
    expect(h.reads).toEqual([]);
    expect(h.writes).toEqual([]);
    const entry = h.entries.find((e) => e.fields.skip === 'after_plan_misconfigured')!;
    expect(entry).toMatchObject({ level: 'error', fields: { alert: true } });
  });
});

describe('failures throw, so Stripe retries (S-7, DR-10)', () => {
  it('a read error throws, logged error + alert', async () => {
    const h = harness({ read: new Error('column does not exist') });
    await expect(moveToFreeCohortAfterPlan(INPUT, h.log, h.deps)).rejects.toThrow('column does not exist');
    expect(h.entries.find((e) => e.fields.event === 'bos_plan_after_plan_read_failed')).toMatchObject({ level: 'error', fields: { alert: true } });
  });

  it('a write error throws, logged error + alert', async () => {
    const h = harness({ write: new Error('check violation') });
    await expect(moveToFreeCohortAfterPlan(INPUT, h.log, h.deps)).rejects.toThrow('check violation');
    expect(h.entries.find((e) => e.fields.event === 'bos_plan_after_plan_write_failed')).toMatchObject({ level: 'error', fields: { alert: true } });
    expect(h.audits).toEqual([]);
  });

  it('a plan row read for another account is refused (unreachable through the repository filter)', async () => {
    const h = harness({ read: { plan: planRow({ user_id: '99999999-2222-4333-8444-555555555555' }), moves: 0, lastSubscriptionId: null } });
    await expect(moveToFreeCohortAfterPlan(INPUT, h.log, h.deps)).rejects.toThrow(/another account/);
    expect(h.writes).toEqual([]);
  });
});

describe('the audit (S-8, DR-6)', () => {
  it('one entry: the registered key, the system actor, automatic, ids and codes only', async () => {
    const h = harness({ read: { plan: planRow(), moves: 1, lastSubscriptionId: 'sub_OLD' } });
    await moveToFreeCohortAfterPlan(INPUT, h.log, h.deps);
    expect(h.audits).toHaveLength(1);
    const entry = h.audits[0];
    expect(AUDIT_EVENTS[entry.action as keyof typeof AUDIT_EVENTS]).toBe(AFTER_PLAN_MOVE_AUDIT_ACTION);
    expect(entry).toMatchObject({
      accountId: ACCOUNT,
      actor: { kind: 'system', source: 'stripe_webhook' },
      entityType: 'business_os_account_plan',
      entityId: ACCOUNT,
      severity: 'info',
      invalidatesEntitlements: true,
    });
    expect(entry.details).toEqual({
      automatic: true,
      trigger: 'owner_end',
      cancellationReason: 'cancellation_requested',
      subscriptionId: 'sub_NEW',
      endedAt: ENDED,
      days: 7,
      priorMoves: 1,
      cohort: AFTER_PLAN.cohort,
      livemode: false,
      stripeEventId: 'evt_1',
    });
    const changes = entry.changes as { before: Record<string, unknown>; after: Record<string, unknown> };
    expect(Object.keys(changes.before).sort()).toEqual(
      ['after_plan_moves', 'cohort', 'grace_ends_at', 'period_anchor', 'tier_expires_at', 'trial_ends_at', 'trial_started_at'].sort()
    );
    expect(changes.after).toMatchObject({ after_plan_moves: 2, tier_expires_at: ENDED, trial_ends_at: plusDays(SETTLED, 7) });
  });

  it.each([
    ['rejects', async () => Promise.reject(new Error('flush failed'))],
    ['throws', () => { throw new Error('sync throw'); }],
  ])('an audit port that %s after the write: the move resolves, logs, never throws (no retry)', async (_label, record) => {
    const h = harness({ record: record as (input: RecordPlanChangeInput) => Promise<void> });
    await expect(moveToFreeCohortAfterPlan(INPUT, h.log, h.deps)).resolves.toBeUndefined();
    expect(h.writes).toHaveLength(1);
    expect(h.entries.find((e) => e.fields.event === 'bos_plan_after_plan_audit_failed')?.level).toBe('error');
    expect(h.entries.some((e) => e.fields.event === 'bos_plan_after_plan_moved')).toBe(true);
  });
});

describe('logs carry ids and codes only (DR-10)', () => {
  const ALLOWED_FIELDS = new Set([
    'event', 'skip', 'accountId', 'subscriptionId', 'livemode', 'stripeEventId', 'priorMoves', 'days', 'cancellationReason', 'alert', 'err',
  ]);

  it('every field logged on every path is from the closed set', async () => {
    const paths: Array<Parameters<typeof harness>[0] & { input?: Partial<AfterPlanMoveInput> }> = [
      {},
      { input: { cancellationReason: 'payment_failed' } },
      { input: { endedAt: null } },
      { read: null },
      { read: new Error('x') },
      { write: { outcome: 'stale' } },
      { read: { plan: planRow({ tier_expires_at: plusDays(ENDED, 30) }), moves: 0, lastSubscriptionId: null } },
      { record: async () => Promise.reject(new Error('y')) },
    ];
    for (const path of paths) {
      const h = harness(path);
      await moveToFreeCohortAfterPlan({ ...INPUT, ...path.input }, h.log, h.deps).catch(() => undefined);
      for (const entry of h.entries) {
        for (const key of Object.keys(entry.fields)) expect(ALLOWED_FIELDS).toContain(key);
      }
    }
  });
});
