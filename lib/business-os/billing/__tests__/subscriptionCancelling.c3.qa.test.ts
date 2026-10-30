/**
 * QA, plan payments follow-ups C-3 (workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_FOLLOWUPS_C3_WORKPLAN.md, "QA report").
 *
 * Adversarial checks of the ONE stored-flag rule `isSetToEndThisPeriod`:
 *   1. the predicate against an independent oracle, over the flag x cancel_at x
 *      items space (null / 0 / NaN / negative / Infinity / past / before / equal /
 *      one second after / long after; no items, empty, one, several in either
 *      order, a missing period end);
 *   2. property: given the SAME facts, the webhook mirror, the engine's step-7
 *      heal (`rowDisagrees`) and reconcile Step B (`cancel_flag_differs`) all
 *      agree with that oracle, for active / trialing / past_due, so a row
 *      cannot flip-flop between them;
 *   3. SA optional 1: the mirror with NO item list (`Array.isArray` fallback);
 *   4. Step B's three C-3 verdicts, with exact counts;
 *   5. regressions: in-app cancel / reactivate writes, an immediate `.deleted`.
 *
 * Hand-built fakes only. No database, no Stripe, no network.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  cancelSourceOf,
  hasCancelDate,
  isSetToEndThisPeriod,
  latestItemPeriodEnd,
} from '@/lib/business-os/billing/subscriptionCancelling';
import { mirrorPlanSubscription, type PlanSubscriptionMirrorDeps } from '@/lib/business-os/billing/planSubscriptionMirror';
import { managePlanSubscription, type PlanManageDeps } from '@/lib/business-os/billing/planSubscriptionManage';
import {
  createPlanReconcilePass,
  type PlanReconcileBillingRow,
  type PlanReconcileDeps,
  type PlanReconcileSubscription,
} from '@/lib/business-os/billing/planReconcilePass';
import type { ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import type { Logger } from '@/lib/logger';

// The billing row type, reached through the mirror's port so this file does not
// name the repository (its caller source guard lists every file that does).
type BusinessOsBillingAccount = NonNullable<Awaited<ReturnType<PlanSubscriptionMirrorDeps['billingAccounts']['findByStripeSubscription']>>['data']>;

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SUB = 'sub_P1';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const NOW_S = Math.floor(NOW.getTime() / 1000);
const DAY = 86400;
const PE = NOW_S + 31 * DAY; // the latest item period end
const PS = PE - 30 * DAY;
const EARLY_END = PE - 10 * DAY;
const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');

// ── The independent oracle (the workplan §2.1 table, written from the spec) ──

type Ends = Array<number | null> | undefined;

function oracle(flag: boolean, cancelAt: number | null | undefined, ends: Ends): boolean {
  if (flag) return true;
  if (typeof cancelAt !== 'number' || !Number.isFinite(cancelAt) || cancelAt <= 0) return false;
  const known = (ends ?? []).filter((e): e is number => typeof e === 'number' && Number.isFinite(e) && e > 0);
  if (known.length === 0) return true;
  return cancelAt <= Math.max(...known);
}

const CANCEL_ATS: Array<[string, number | null | undefined]> = [
  ['null', null],
  ['undefined', undefined],
  ['0', 0],
  ['NaN', Number.NaN],
  ['negative', -1],
  ['Infinity', Number.POSITIVE_INFINITY],
  ['in the past', NOW_S - DAY],
  ['before the period end', PE - 5 * DAY],
  ['equal to the period end', PE],
  ['one second after the period end', PE + 1],
  ['long after the period end', PE + 30 * DAY],
];

const ITEM_SETS: Array<[string, Ends]> = [
  ['no item list', undefined],
  ['an empty list', []],
  ['one item', [PE]],
  ['two items, latest last', [EARLY_END, PE]],
  ['two items, latest first', [PE, EARLY_END]],
  ['one EARLY item only', [EARLY_END]],
  ['one item with no period end', [null]],
  ['a null end beside a real one', [null, PE]],
];

const STATUSES = ['active', 'trialing', 'past_due'] as const;

const fullItems = (ends: Ends) =>
  (ends ?? []).map((end, i) => ({ id: `si_${i}`, priceId: 'price_one', currentPeriodStart: PS, currentPeriodEnd: end }));

// ── 1. The predicate ─────────────────────────────────────────────────────────

describe('QA C-3 · isSetToEndThisPeriod against an independent oracle', () => {
  it('every flag x cancel_at x items cell agrees with the oracle, and cancelSourceOf is consistent', () => {
    const wrong: string[] = [];
    for (const flag of [false, true]) {
      for (const [caLabel, cancelAt] of CANCEL_ATS) {
        for (const [itemsLabel, ends] of ITEM_SETS) {
          const periodEnd = ends === undefined ? null : latestItemPeriodEnd(fullItems(ends));
          const facts = { cancelAtPeriodEnd: flag, cancelAt, periodEnd };
          const got = isSetToEndThisPeriod(facts);
          const want = oracle(flag, cancelAt, ends);
          const source = cancelSourceOf(facts);
          const sourceOk = flag
            ? source === 'flag'
            : oracle(false, cancelAt, []) === false
              ? source === null
              : source === (want ? 'cancel_at' : 'cancel_at_after_period');
          if (got !== want || !sourceOk) wrong.push(`flag=${flag} cancel_at=${caLabel} items=${itemsLabel}: got ${got}/${source}, want ${want}`);
          // hasCancelDate (fresh, any date) is never narrower than the stored rule.
          if (got && !hasCancelDate(facts)) wrong.push(`stored true but hasCancelDate false: ${caLabel}/${itemsLabel}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it.each<[string, boolean, number | null, number | null, boolean]>([
    ['flag only', true, null, PE, true],
    ['flag + a LATER cancel_at (flag wins)', true, PE + 30 * DAY, PE, true],
    ['cancel_at equal to the period end', false, PE, PE, true],
    ['cancel_at one second after', false, PE + 1, PE, false],
    ['cancel_at one second before', false, PE - 1, PE, true],
    ['cancel_at in the past', false, NOW_S - DAY, PE, true],
    ['cancel_at, no period end', false, PE + 30 * DAY, null, true],
    ['neither', false, null, PE, false],
    ['neither, no period end', false, null, null, false],
    ['periodEnd 0 reads as unknown', false, PE + 30 * DAY, 0, true],
  ])('%s', (_label, flag, cancelAt, periodEnd, want) => {
    expect(isSetToEndThisPeriod({ cancelAtPeriodEnd: flag, cancelAt, periodEnd })).toBe(want);
  });

  it('latestItemPeriodEnd: order does not matter, nulls skipped, empty → null', () => {
    expect(latestItemPeriodEnd(fullItems([PE, EARLY_END]))).toBe(PE);
    expect(latestItemPeriodEnd(fullItems([EARLY_END, PE]))).toBe(PE);
    expect(latestItemPeriodEnd(fullItems([null, EARLY_END]))).toBe(EARLY_END);
    expect(latestItemPeriodEnd(fullItems([null]))).toBeNull();
    expect(latestItemPeriodEnd([])).toBeNull();
  });
});

// ── Fakes: the webhook mirror ────────────────────────────────────────────────

function billingRow(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: SUB,
    subscriptionStatus: 'active',
    boughtTier: 'tier_one',
    currentPeriodEnd: new Date(PE * 1000).toISOString(),
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    lastInvoiceId: 'in_1',
    lastPaidAt: '2026-10-01T00:00:00.000Z',
    lastPaymentFailedAt: null,
    failedAttempts: 0,
    actionRequiredInvoiceUrl: null,
    founderDiscountAppliedAt: null,
    endedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function stripeEvent(name: string): Stripe.Event {
  const e = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event;
  (e.data.object as Stripe.Subscription).id = SUB;
  return e;
}

function mirrorHarness(initial: BusinessOsBillingAccount, fresh: Record<string, unknown>) {
  const state = { row: initial };
  const writes: Array<Record<string, unknown>> = [];
  const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    lines.push({ level, ctx });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error') } as unknown as Logger;
  const afterPlanMove = jest.fn(async () => undefined);
  const deps = {
    now: () => NOW,
    billingEvents: { recordEvent: jest.fn(async () => ({ data: { outcome: 'recorded' as const, eventRowId: '44444444-4444-4444-8444-000000000001' }, error: null })) },
    recordPlanChange: jest.fn(async () => undefined),
    afterPlanMove,
    stripe: () => ({
      retrieveBusinessOsSubscription: async () => ({
        id: SUB,
        status: 'active',
        customerId: 'cus_own',
        billingCycleAnchor: 1,
        cancelAtPeriodEnd: false,
        endedAt: null,
        livemode: false,
        metadata: {},
        priceIds: [],
        ...fresh,
      }),
    }),
    billingAccounts: {
      findByStripeSubscription: async (id: string, livemode: boolean) => ({
        data: state.row.stripeSubscriptionId === id && state.row.livemode === livemode ? state.row : null,
        error: null,
      }),
      mirrorSubscriptionState: async (input: Record<string, unknown>) => {
        writes.push(input);
        state.row = { ...state.row, subscriptionStatus: input.status as BusinessOsBillingAccount['subscriptionStatus'], cancelAtPeriodEnd: input.cancelAtPeriodEnd as boolean, endedAt: input.endedAtIso as string | null };
        return { data: { mirrored: true }, error: null };
      },
    },
  } as unknown as PlanSubscriptionMirrorDeps;
  const named = (name: string) => lines.filter((l) => l.ctx.event === name);
  return { state, writes, log, deps, named, afterPlanMove };
}

// ── Fakes: the in-app engine ─────────────────────────────────────────────────

function engineHarness(rowFlag: boolean, status: string, fresh: Record<string, unknown>, write?: Record<string, unknown>) {
  const mirrors: Array<Record<string, unknown>> = [];
  const stripeCalls: string[] = [];
  const noop = () => undefined;
  const deps = {
    logger: { info: noop, warn: noop, error: noop },
    now: () => NOW,
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    repo: {
      findByUser: async () => ({ data: billingRow({ cancelAtPeriodEnd: rowFlag, subscriptionStatus: status as BusinessOsBillingAccount['subscriptionStatus'] }), error: null }),
      mirrorSubscriptionState: async (input: Record<string, unknown>) => {
        mirrors.push(input);
        return { data: { mirrored: true }, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async (id: string) => {
        stripeCalls.push(`retrieve:${id}`);
        return {
          id: SUB,
          status,
          customerId: 'cus_own',
          billingCycleAnchor: PS,
          cancelAtPeriodEnd: false,
          cancelAt: null,
          endedAt: null,
          livemode: false,
          metadata: {},
          priceIds: ['price_one'],
          items: fullItems([PE]),
          pendingUpdate: null,
          latestInvoiceId: 'in_last',
          ...fresh,
        };
      },
      setBusinessOsCancelAtPeriodEnd: async (id: string, value: boolean) => {
        stripeCalls.push(`update:${id}:${value}`);
        return (
          write ?? {
            id: SUB,
            status,
            customerId: 'cus_own',
            livemode: false,
            cancelAtPeriodEnd: value,
            cancelAt: value ? PE : null,
            endedAt: null,
            currentPeriodEnd: PE,
          }
        );
      },
    },
  } as unknown as PlanManageDeps;
  const run = (action: 'cancel' | 'reactivate') => managePlanSubscription({ action, userId: ACCOUNT, accountId: ACCOUNT }, deps);
  return { mirrors, stripeCalls, run };
}

// ── Fakes: reconcile Step B ──────────────────────────────────────────────────

function stepBHarness(sub: PlanReconcileSubscription, row: Partial<PlanReconcileBillingRow>) {
  const lines: Array<{ ctx: Record<string, unknown> }> = [];
  const at = () => (ctx: Record<string, unknown>) => {
    lines.push({ ctx });
  };
  const log = { info: at(), warn: at(), error: at() };
  const unused = async () => {
    throw new Error('Step B must not touch claims');
  };
  const deps: PlanReconcileDeps = {
    eventTypes: ['customer.subscription.updated'],
    verifiedShapes: { '2025-10-29.clover': ['customer.subscription.updated'] },
    staleClaimAgeMs: 15 * 60 * 1000,
    keyLivemode: () => false,
    stripe: () => ({
      listBusinessOsPlanEvents: async () => ({ items: [], complete: true }),
      listBusinessOsSubscriptionsByPrice: async (priceId: string) => ({ items: priceId === 'price_one' ? [sub] : [], complete: true }),
    }),
    claims: { findClaim: unused, insertClaim: unused, reclaimStale: unused, reclaimFailedIfStillFailed: unused, complete: unused, markFailed: unused } as unknown as PlanReconcileDeps['claims'],
    dispatch: async () => ({ kind: 'plan' }),
    handle: async () => undefined,
    recentRuns: async () => ({ data: [], error: null }),
    billingRows: async () => ({
      data: [
        {
          id: 'b1',
          user_id: ACCOUNT,
          stripe_subscription_id: sub.id,
          subscription_status: sub.status,
          bought_tier: 'tier_a',
          current_period_end: new Date(PE * 1000).toISOString(),
          cancel_at_period_end: false,
          ended_at: null,
          ...row,
        },
      ],
      error: null,
    }),
    planFacts: async () => ({ data: { [ACCOUNT]: { tier: 'tier_a', tierExpiresAt: new Date(PE * 1000).toISOString() } }, error: null }),
    recordedPayments: async () => ({ data: { eventIds: [], invoiceIds: [] }, error: null }),
    planPrices: async () => new Map([['price_one', 'tier_a']]),
    clock: () => NOW.getTime(),
  } as unknown as PlanReconcileDeps;
  const context: ReconcilePassContext = { deadlineAt: NOW.getTime() + 45_000, now: NOW, log, trigger: 'nightly' };
  const pass = createPlanReconcilePass(deps);
  const run = () => pass.run(context);
  const kinds = () => lines.filter((l) => l.ctx.event === 'bos_plan_reconcile_finding').map((l) => l.ctx.kind);
  return { run, kinds };
}

function reconcileSub(flag: boolean, cancelAt: number | null | undefined, ends: Ends, status: string): PlanReconcileSubscription {
  return {
    id: SUB,
    status,
    livemode: false,
    cancelAtPeriodEnd: flag,
    ...(cancelAt === undefined ? {} : { cancelAt }),
    endedAt: null,
    items: (ends ?? []).map((end) => ({ priceId: 'price_one', currentPeriodStart: PS, currentPeriodEnd: end })),
  };
}

// ── 2. Property: mirror, engine and Step B agree on the same facts ───────────

describe('QA C-3 · property: the mirror, the engine heal and Step B agree (no flip-flop)', () => {
  it('the webhook mirror stores exactly the oracle value, for every cell and status', async () => {
    const wrong: string[] = [];
    for (const status of STATUSES) {
      for (const flag of [false, true]) {
        for (const [caLabel, cancelAt] of CANCEL_ATS) {
          for (const [itemsLabel, ends] of ITEM_SETS) {
            const fresh: Record<string, unknown> = { status, cancelAtPeriodEnd: flag, cancelAt };
            if (ends !== undefined) fresh.items = fullItems(ends);
            const h = mirrorHarness(billingRow({ subscriptionStatus: status as BusinessOsBillingAccount['subscriptionStatus'], cancelAtPeriodEnd: !oracle(flag, cancelAt, ends) }), fresh);
            await mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), h.log, h.deps);
            const want = oracle(flag, cancelAt, ends);
            if (h.writes.length !== 1 || h.writes[0].cancelAtPeriodEnd !== want) {
              wrong.push(`${status} flag=${flag} cancel_at=${caLabel} items=${itemsLabel}: wrote ${JSON.stringify(h.writes.map((w) => w.cancelAtPeriodEnd))}, want ${want}`);
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('Step B: a row holding the oracle value is never cancel_flag_differs; the opposite is exactly one', async () => {
    const wrong: string[] = [];
    for (const status of STATUSES) {
      for (const flag of [false, true]) {
        for (const [caLabel, cancelAt] of CANCEL_ATS) {
          for (const [itemsLabel, ends] of ITEM_SETS) {
            if (ends === undefined) continue; // a listed subscription always has an item array
            const want = oracle(flag, cancelAt, ends);
            for (const stored of [want, !want]) {
              const h = stepBHarness(reconcileSub(flag, cancelAt, ends, status), { cancel_at_period_end: stored });
              await h.run();
              const n = h.kinds().filter((k) => k === 'cancel_flag_differs').length;
              const expected = stored === want ? 0 : 1;
              if (n !== expected) wrong.push(`${status} flag=${flag} cancel_at=${caLabel} items=${itemsLabel} stored=${stored}: ${n} findings, want ${expected}`);
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('engine step 7: a row holding the oracle value is never healed; the opposite heals TO the oracle value (active, trialing)', async () => {
    const wrong: string[] = [];
    for (const status of ['active', 'trialing']) {
      for (const flag of [false, true]) {
        for (const [caLabel, cancelAt] of CANCEL_ATS) {
          for (const [itemsLabel, ends] of ITEM_SETS) {
            const items = fullItems(ends ?? []); // the engine's retrieve always has a list
            const want = oracle(flag, cancelAt, ends);
            // The action that reaches step 7 ("already what was asked") for these facts.
            const action = hasCancelDate({ cancelAtPeriodEnd: flag, cancelAt }) ? 'cancel' : 'reactivate';
            for (const stored of [want, !want]) {
              const h = engineHarness(stored, status, { cancelAtPeriodEnd: flag, cancelAt, items });
              const result = await h.run(action);
              const label = `${status} flag=${flag} cancel_at=${caLabel} items=${itemsLabel} stored=${stored} ${action}`;
              if (!result.ok || (result as { outcome?: string }).outcome !== 'unchanged') {
                wrong.push(`${label}: not unchanged (${JSON.stringify(result)})`);
                continue;
              }
              if (h.stripeCalls.some((c) => c.startsWith('update'))) wrong.push(`${label}: a Stripe write`);
              if (stored === want && h.mirrors.length !== 0) wrong.push(`${label}: healed a correct row`);
              if (stored !== want && (h.mirrors.length !== 1 || h.mirrors[0].cancelAtPeriodEnd !== want)) {
                wrong.push(`${label}: heal wrote ${JSON.stringify(h.mirrors.map((m) => m.cancelAtPeriodEnd))}, want [${want}]`);
              }
            }
          }
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  it('a round trip never moves the row: mirror → press → Step B → mirror again, for the dashboard cancellation', async () => {
    const fresh = { cancelAtPeriodEnd: false, cancelAt: PE, items: fullItems([PE]) };
    const m1 = mirrorHarness(billingRow(), fresh);
    await mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), m1.log, m1.deps);
    expect(m1.state.row.cancelAtPeriodEnd).toBe(true);

    const press = engineHarness(m1.state.row.cancelAtPeriodEnd, 'active', fresh);
    expect(await press.run('cancel')).toMatchObject({ ok: true, outcome: 'unchanged', state: 'cancelling' });
    expect(press.mirrors).toEqual([]);

    const b = stepBHarness(reconcileSub(false, PE, [PE], 'active'), { cancel_at_period_end: m1.state.row.cancelAtPeriodEnd });
    await b.run();
    expect(b.kinds()).toEqual([]);

    const m2 = mirrorHarness(m1.state.row, fresh);
    await mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), m2.log, m2.deps);
    expect(m2.state.row.cancelAtPeriodEnd).toBe(true);
  });
});

// ── 3. SA optional 1: the mirror with no item list ───────────────────────────

describe('QA C-3 · the mirror\'s Array.isArray(fresh.items) fallback (SA suggestion 1)', () => {
  it.each<[string, Record<string, unknown>]>([
    ['items absent', {}],
    ['items null', { items: null }],
    ['items an object, not an array', { items: { data: [] } }],
  ])('%s, flag false, cancel_at set → stored true, source cancel_at, no throw', async (_label, extra) => {
    const h = mirrorHarness(billingRow(), { cancelAtPeriodEnd: false, cancelAt: PE + 30 * DAY, ...extra });
    await expect(mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), h.log, h.deps)).resolves.toBeUndefined();
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].cancelAtPeriodEnd).toBe(true);
    expect(h.named('bos_billing_subscription_mirrored')[0].ctx).toMatchObject({ cancelAtPeriodEnd: true, cancelSource: 'cancel_at' });
  });

  it('items absent and no cancel_at → stored false, source null', async () => {
    const h = mirrorHarness(billingRow({ cancelAtPeriodEnd: true }), { cancelAtPeriodEnd: false, cancelAt: null });
    await mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.writes[0].cancelAtPeriodEnd).toBe(false);
    expect(h.named('bos_billing_subscription_mirrored')[0].ctx).toMatchObject({ cancelSource: null });
  });

  it('the mirror log carries ids and the enum only (no cancel_at value, no dates)', async () => {
    const h = mirrorHarness(billingRow(), { cancelAtPeriodEnd: false, cancelAt: PE, items: fullItems([PE]) });
    await mirrorPlanSubscription(stripeEvent('customer-subscription-updated.json'), h.log, h.deps);
    const ctx = h.named('bos_billing_subscription_mirrored')[0].ctx;
    expect(Object.keys(ctx).sort()).toEqual(['accountId', 'cancelAtPeriodEnd', 'cancelSource', 'ended', 'event', 'eventType', 'livemode', 'status', 'stripeEventId', 'subscriptionId'].sort());
    expect(JSON.stringify(ctx)).not.toContain(String(PE));
  });
});

// ── 4. Step B's three C-3 verdicts, with counts ─────────────────────────────

describe('QA C-3 · reconcile Step B', () => {
  it('a dashboard-cancelled row already stored true → no cancel_flag_differs, mismatch 0', async () => {
    const h = stepBHarness(reconcileSub(false, PE, [PE], 'active'), { cancel_at_period_end: true });
    const counts = await h.run();
    expect(h.kinds()).toEqual([]);
    expect(counts.mismatch).toBe(0);
  });

  it('a stale pre-fix row stored false while Stripe holds cancel_at → exactly one finding (the backfill signal)', async () => {
    const h = stepBHarness(reconcileSub(false, PE, [PE], 'active'), { cancel_at_period_end: false });
    const counts = await h.run();
    expect(h.kinds()).toEqual(['cancel_flag_differs']);
    expect(counts.mismatch).toBe(1);
  });

  it('a LATER cancel_at stored false → no finding', async () => {
    const h = stepBHarness(reconcileSub(false, PE + 1, [PE], 'active'), { cancel_at_period_end: false });
    const counts = await h.run();
    expect(h.kinds()).toEqual([]);
    expect(counts.mismatch).toBe(0);
  });

  it('the in-app cancel (flag true + cancel_at = period end) stored true → no finding (unchanged)', async () => {
    const h = stepBHarness(reconcileSub(true, PE, [PE], 'active'), { cancel_at_period_end: true });
    await h.run();
    expect(h.kinds()).toEqual([]);
  });
});

// ── 5. Regressions ───────────────────────────────────────────────────────────

describe('QA C-3 · regressions: in-app cancel / reactivate, immediate end', () => {
  it('in-app cancel: one Stripe write of true, our row mirrored true from the answer', async () => {
    const h = engineHarness(false, 'active', {});
    expect(await h.run('cancel')).toMatchObject({ ok: true, outcome: 'cancelled' });
    expect(h.stripeCalls).toEqual([`retrieve:${SUB}`, `update:${SUB}:true`]);
    expect(h.mirrors).toHaveLength(1);
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: true, status: 'active' });
  });

  it('in-app reactivate: one Stripe write of false, our row mirrored false', async () => {
    const h = engineHarness(true, 'active', { cancelAtPeriodEnd: true, cancelAt: PE });
    expect(await h.run('reactivate')).toMatchObject({ ok: true, outcome: 'reactivated' });
    expect(h.stripeCalls).toEqual([`retrieve:${SUB}`, `update:${SUB}:false`]);
    expect(h.mirrors).toHaveLength(1);
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it('reactivate of a DASHBOARD cancellation (cancel_at only, row true) still reaches Stripe and clears it', async () => {
    const h = engineHarness(true, 'active', { cancelAtPeriodEnd: false, cancelAt: PE });
    expect(await h.run('reactivate')).toMatchObject({ ok: true, outcome: 'reactivated' });
    expect(h.stripeCalls).toEqual([`retrieve:${SUB}`, `update:${SUB}:false`]);
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it('a write answer with the flag set but no cancel_at still stores true', async () => {
    const h = engineHarness(false, 'active', {}, { id: SUB, status: 'active', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: true, cancelAt: null, endedAt: null, currentPeriodEnd: PE });
    expect(await h.run('cancel')).toMatchObject({ ok: true, outcome: 'cancelled' });
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it('an immediate end (`.deleted`, cancel_at null) stores false with ended_at, and the after-plan move still runs once', async () => {
    const endedAt = NOW_S - 60;
    const h = mirrorHarness(billingRow(), { status: 'canceled', endedAt, cancelAtPeriodEnd: false, cancelAt: null, items: fullItems([PE]) });
    await mirrorPlanSubscription(stripeEvent('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.writes).toHaveLength(1);
    expect(h.writes[0]).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: false, endedAtIso: new Date(endedAt * 1000).toISOString() });
    expect(h.afterPlanMove).toHaveBeenCalledTimes(1);
  });

  it('a scheduled dashboard end that has HAPPENED (`.deleted`, cancel_at in the past, flag false) stores true WITH ended_at (readers check ended first)', async () => {
    // Behaviour note, not a bug: before C-3 this stored false. Every reader
    // (subscriptionsView, planMrr, planManageOffer, the D4b claim's
    // `ended_at IS NULL`) checks the end before the flag.
    const endedAt = NOW_S - 60;
    const h = mirrorHarness(billingRow(), { status: 'canceled', endedAt, cancelAtPeriodEnd: false, cancelAt: endedAt, items: fullItems([endedAt]) });
    await mirrorPlanSubscription(stripeEvent('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.writes[0]).toMatchObject({ status: 'canceled', cancelAtPeriodEnd: true, endedAtIso: new Date(endedAt * 1000).toISOString() });
    expect(h.afterPlanMove).toHaveBeenCalledTimes(1);
  });
});
