/**
 * QA (plan payments P-8b.2): edge cases of the plan reconcile pass that the Dev
 * suite does not pin. Claim races and claim errors, unsettled claims, window
 * anchoring, unverified shapes, deadline and batch caps, incomplete lists, and
 * the log lines' keys. In memory only: no database, no network.
 */

import type Stripe from 'stripe';

import {
  createPlanReconcilePass,
  PLAN_RECONCILE_LIMITS,
  planReconcileWindow,
  runFinishedPlanWork,
  type PlanClaimStatus,
  type PlanReconcileBillingRow,
  type PlanReconcileDeps,
  type PlanReconcileRun,
  type PlanReconcileSubscription,
} from '@/lib/business-os/billing/planReconcilePass';
import { runReconcilePasses, type ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';

const NOW = Date.parse('2026-10-28T05:41:00.000Z');
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const API = '2025-10-29.clover';
const TYPES = [
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  'checkout.session.completed',
  'checkout.session.expired',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
const sec = (ms: number) => Math.floor(ms / 1000);

interface ClaimRow {
  status: PlanClaimStatus;
  processedAt: number;
}

function ev(id: string, type: string, created: number, overrides: Record<string, unknown> = {}): Stripe.Event {
  return {
    id,
    object: 'event',
    type,
    created,
    livemode: false,
    api_version: API,
    data: { object: { id: type.startsWith('invoice.') ? `in_${id.slice(4)}` : `obj_${id.slice(4)}` } },
    ...overrides,
  } as unknown as Stripe.Event;
}

interface Options {
  events?: Stripe.Event[];
  claims?: Record<string, ClaimRow>;
  runs?: PlanReconcileRun[];
  rows?: PlanReconcileBillingRow[];
  subscriptions?: Record<string, PlanReconcileSubscription[] | 'throw'>;
  prices?: Map<string, string>;
  clock?: () => number;
}

function setup(options: Options = {}) {
  const rows = new Map<string, ClaimRow>(Object.entries(options.claims ?? {}));
  const calls: string[] = [];
  const handled: string[] = [];
  const listedPrices: string[] = [];
  const claims: PlanReconcileDeps['claims'] = {
    findClaim: async (id) => {
      calls.push(`findClaim:${id}`);
      const row = rows.get(id);
      return { data: row ? { event_id: id, status: row.status } : null, error: null };
    },
    insertClaim: async (row) => {
      calls.push(`insertClaim:${row.event_id}`);
      if (rows.has(row.event_id)) return { error: { code: '23505' } };
      rows.set(row.event_id, { status: 'processing', processedAt: Date.parse(row.processed_at) });
      return { error: null };
    },
    reclaimStale: async (id, cutoffIso) => {
      calls.push(`reclaimStale:${id}`);
      const row = rows.get(id);
      if (!row || row.status !== 'processing' || !(row.processedAt < Date.parse(cutoffIso))) return { data: { won: false }, error: null };
      rows.set(id, { status: 'processing', processedAt: NOW });
      return { data: { won: true }, error: null };
    },
    reclaimFailedIfStillFailed: async (id) => {
      calls.push(`reclaimFailedIfStillFailed:${id}`);
      const row = rows.get(id);
      if (!row || row.status !== 'failed') return { data: { won: false }, error: null };
      rows.set(id, { status: 'processing', processedAt: NOW });
      return { data: { won: true }, error: null };
    },
    complete: async (id) => {
      calls.push(`complete:${id}`);
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: 'completed' });
      return { error: null };
    },
    markFailed: async (id) => {
      calls.push(`markFailed:${id}`);
      const row = rows.get(id);
      if (row) rows.set(id, { ...row, status: 'failed' });
      return { error: null };
    },
  };
  const deps: PlanReconcileDeps = {
    eventTypes: TYPES,
    verifiedShapes: { [API]: TYPES, '2026-09-30.endive': ['invoice.paid'] },
    staleClaimAgeMs: 15 * MIN,
    keyLivemode: () => false,
    stripe: () => ({
      listBusinessOsPlanEvents: async () => ({ items: options.events ?? [], complete: true }),
      listBusinessOsSubscriptionsByPrice: async (priceId) => {
        listedPrices.push(priceId);
        const listed = options.subscriptions?.[priceId];
        if (listed === 'throw') throw new Error('stripe down');
        return { items: listed ?? [], complete: true };
      },
    }),
    claims,
    dispatch: async () => ({ kind: 'plan' }),
    handle: async (event) => {
      handled.push(event.id);
    },
    recentRuns: async () => ({ data: options.runs ?? [], error: null }),
    billingRows: async () => ({ data: options.rows ?? [], error: null }),
    planFacts: async () => ({ data: {}, error: null }),
    recordedPayments: async () => ({ data: { eventIds: [], invoiceIds: [] }, error: null }),
    planPrices: async () => options.prices ?? new Map(),
    clock: options.clock ?? (() => NOW),
  };
  const lines: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>, msg: string) => {
    lines.push({ level, ctx, msg });
  };
  const context: ReconcilePassContext = {
    deadlineAt: NOW + 45_000,
    now: new Date(NOW),
    log: { info: at('info'), warn: at('warn'), error: at('error') },
    trigger: 'nightly',
  };
  const named = (name: string) => lines.filter((line) => line.ctx.event === name);
  const pass = createPlanReconcilePass(deps);
  return { deps, rows, calls, handled, listedPrices, lines, named, context, pass, run: () => pass.run(context) };
}

/** The run record the pass would leave, as the runner flattens it. */
async function flattened(h: ReturnType<typeof setup>): Promise<Record<string, number>> {
  const result = await runReconcilePasses([h.pass], h.context);
  return { ...result.counts, passesFailed: result.passesFailed };
}

// ── Claim races and claim errors ─────────────────────────────────────────────

describe('QA: claim races set incomplete and never run the handler', () => {
  it('a lost STALE reclaim (another actor renewed the lease between our read and our update)', async () => {
    const h = setup({ events: [ev('evt_a1', 'invoice.paid', 1)], claims: { evt_a1: { status: 'processing', processedAt: NOW - 20 * MIN } } });
    h.deps.claims.reclaimStale = async (id) => {
      h.calls.push(`reclaimStale:${id}`);
      h.rows.set(id, { status: 'processing', processedAt: NOW });
      return { data: { won: false }, error: null };
    };
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts).toMatchObject({ incomplete: 1, staleReclaimed: 0, replayed: 0, replayFailed: 0 });
    expect(h.calls).toEqual(['findClaim:evt_a1', 'reclaimStale:evt_a1']);
  });

  it.each([
    ['insert 23505', { claims: {} }, 'insertClaim'],
    ['a lost conditional failed-reclaim', { claims: { evt_b1: { status: 'failed' as const, processedAt: NOW - DAY } } }, 'reclaimFailedIfStillFailed'],
  ])('%s: the flattened run record cannot anchor the next window', async (_name, extra, method) => {
    const h = setup({ events: [ev('evt_b1', 'invoice.paid', 1)], ...extra });
    if (method === 'insertClaim') {
      const insert = h.deps.claims.insertClaim;
      h.deps.claims.insertClaim = async (row) => {
        h.rows.set(row.event_id, { status: 'processing', processedAt: NOW });
        return insert(row);
      };
    } else {
      h.deps.claims.reclaimFailedIfStillFailed = async () => ({ data: { won: false }, error: null });
    }
    const record = await flattened(h);
    expect(h.handled).toEqual([]);
    expect(record.planIncomplete).toBe(1);
    expect(runFinishedPlanWork(record)).toBe(false);
  });

  it.each([
    ['an insert error other than 23505', {}, 'insertClaim', 'insert'],
    ['a stale-reclaim error', { evt_c1: { status: 'processing' as const, processedAt: NOW - HOUR } }, 'reclaimStale', 'reclaim_stale'],
    ['a failed-reclaim error', { evt_c1: { status: 'failed' as const, processedAt: NOW - DAY } }, 'reclaimFailedIfStillFailed', 'reclaim_failed'],
  ])('%s: no handler, counted as a failed replay (blocks the anchor), one claim_failed line', async (_name, claims, method, step) => {
    const h = setup({ events: [ev('evt_c1', 'invoice.paid', 1)], claims });
    const failing = async () => ({ data: null, error: { code: '08006', message: 'connection lost' } });
    (h.deps.claims as unknown as Record<string, unknown>)[method] = failing;
    const record = await flattened(h);
    expect(h.handled).toEqual([]);
    expect(record.planReplayFailed).toBe(1);
    expect(runFinishedPlanWork(record)).toBe(false);
    const lines = h.named('bos_plan_reconcile_claim_failed');
    expect(lines).toHaveLength(1);
    expect(lines[0].ctx).toEqual({ event: 'bos_plan_reconcile_claim_failed', step, stripeEventId: 'evt_c1', eventType: 'invoice.paid' });
  });

  it('a replay whose complete() fails is still counted replayed, AND incomplete, so the record cannot anchor', async () => {
    const h = setup({ events: [ev('evt_d1', 'invoice.paid', 1)] });
    h.deps.claims.complete = async () => ({ error: { message: 'down' } });
    const record = await flattened(h);
    expect(record).toMatchObject({ planReplayed: 1, planIncomplete: 1 });
    expect(runFinishedPlanWork(record)).toBe(false);
    expect(h.rows.get('evt_d1')?.status).toBe('processing');
  });

  it('an unsettled claim is taken back as stale by a run 16 minutes later and settled then', async () => {
    const h = setup({ events: [ev('evt_d2', 'invoice.paid', 1)] });
    const complete = h.deps.claims.complete;
    h.deps.claims.complete = async () => ({ error: { message: 'down' } });
    await h.run();
    expect(h.rows.get('evt_d2')?.status).toBe('processing');
    // The next run: the row's lease (written at NOW) is 16 minutes old.
    h.deps.claims.complete = complete;
    h.rows.set('evt_d2', { status: 'processing', processedAt: NOW - 16 * MIN });
    const counts = await h.run();
    expect(counts).toMatchObject({ staleReclaimed: 1, replayed: 1, incomplete: 0 });
    expect(h.rows.get('evt_d2')?.status).toBe('completed');
    expect(h.handled).toEqual(['evt_d2', 'evt_d2']);
  });
});

// ── Window anchoring (SA ruling 8, D-3, fix 3) ───────────────────────────────

describe('QA: window anchoring', () => {
  const clean = (extra: Record<string, number> = {}) => ({
    planEventsSeen: 4,
    planIncomplete: 0,
    planDeadlineHit: 0,
    planReplayFailed: 0,
    passesFailed: 0,
    ...extra,
  });

  it('a clean PARTIAL run anchors (boost deferral, clipped window, unverified shapes, unreadable checks do not block)', () => {
    const counts = clean({ boostDeferred: 3, planWindowClipped: 1, planApiVersionSkipped: 2, planCheckIncomplete: 1 });
    const runs = [{ started_at: new Date(NOW - DAY).toISOString(), counts }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - DAY - HOUR), clipped: false, basis: 'anchored' });
  });

  it('a newer replayFailed run is passed over; the older clean run anchors', () => {
    const runs = [
      { started_at: new Date(NOW - 1 * DAY).toISOString(), counts: clean({ planReplayFailed: 1 }) },
      { started_at: new Date(NOW - 2 * DAY).toISOString(), counts: clean({ planIncomplete: 1 }) },
      { started_at: new Date(NOW - 3 * DAY).toISOString(), counts: clean() },
    ];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 3 * DAY - HOUR), clipped: false, basis: 'anchored' });
  });

  it('a count stored as a string never anchors (only the number 0 is clean)', () => {
    expect(runFinishedPlanWork({ ...clean(), planIncomplete: '0' })).toBe(false);
  });

  it('30-day history: only blocked plan runs, 20 days old → 7 days, clipped (never the 3-day first night)', () => {
    const runs = [{ started_at: new Date(NOW - 20 * DAY).toISOString(), counts: clean({ planDeadlineHit: 1 }) }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 7 * DAY), clipped: true, basis: 'no_clean_run' });
  });

  it('only boost-era runs (no plan counts) in 30 days → the 3-day first night, unclipped', () => {
    const runs = [{ started_at: new Date(NOW - DAY).toISOString(), counts: { boostExamined: 3, passesFailed: 0 } }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 3 * DAY), clipped: false, basis: 'first_run' });
  });

  it('the 7-day cap: an anchor at 7 days minus 59 minutes is clipped (its 1-hour overlap crosses the cap)', () => {
    const runs = [{ started_at: new Date(NOW - 7 * DAY + 59 * MIN).toISOString(), counts: clean() }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toMatchObject({ createdGte: sec(NOW - 7 * DAY), clipped: true });
  });

  it('the 7-day cap: an anchor at 7 days minus 61 minutes is not clipped', () => {
    const runs = [{ started_at: new Date(NOW - 7 * DAY + 61 * MIN).toISOString(), counts: clean() }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 7 * DAY + MIN), clipped: false, basis: 'anchored' });
  });

  it('a clean run with an unparseable started_at never anchors; the window falls to 7 days, clipped', () => {
    const runs = [{ started_at: 'not a date', counts: clean() }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 7 * DAY), clipped: true, basis: 'no_clean_run' });
  });

  it('a clipped window is counted in the run, which the next run can still anchor on when clean', async () => {
    const h = setup({ runs: [{ started_at: new Date(NOW - 10 * DAY).toISOString(), counts: clean() }] });
    const record = await flattened(h);
    expect(record.planWindowClipped).toBe(1);
    expect(runFinishedPlanWork(record)).toBe(true);
  });
});

// ── Unverified shapes (SA API-version ruling (b)) ────────────────────────────

describe('QA: unverified (version, type) pairs', () => {
  it.each([
    ['a missing api_version', { api_version: null }],
    ['a prototype key as the version', { api_version: 'constructor' }],
    ['__proto__ as the version', { api_version: '__proto__' }],
    ['a verified version with a type it does not verify', { api_version: '2026-09-30.endive', type: 'invoice.payment_failed' }],
  ])('%s: skipped, counted, never claimed or dispatched', async (_name, overrides) => {
    const dispatch = jest.fn(async () => ({ kind: 'plan' as const }));
    const h = setup({ events: [ev('evt_e1', 'invoice.paid', 1, overrides)] });
    h.deps.dispatch = dispatch;
    const counts = await h.run();
    expect(h.calls).toEqual([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(counts.apiVersionSkipped).toBe(1);
    expect(h.named('bos_plan_reconcile_unverified_shapes')).toHaveLength(1);
  });

  it('the summary line is still written when the loop stops at the deadline, and carries no ids', async () => {
    let now = NOW;
    const h = setup({
      events: [ev('evt_f1', 'invoice.paid', 1, { api_version: '2027-01-01.future' }), ev('evt_f2', 'invoice.paid', 2), ev('evt_f3', 'invoice.paid', 3)],
      clock: () => now,
    });
    h.deps.handle = async () => {
      now = NOW + 45_000;
    };
    const counts = await h.run();
    expect(counts).toMatchObject({ deadlineHit: 1, apiVersionSkipped: 1, replayed: 1 });
    const lines = h.named('bos_plan_reconcile_unverified_shapes');
    expect(lines).toHaveLength(1);
    expect(lines[0].ctx).toEqual({ event: 'bos_plan_reconcile_unverified_shapes', pairs: [{ apiVersion: '2027-01-01.future', eventType: 'invoice.paid', count: 1 }] });
    expect(JSON.stringify(lines[0])).not.toMatch(/evt_|in_|sub_|cus_/);
  });

  it('the summary line is still written when the loop stops at the batch cap', async () => {
    const events = [
      ev('evt_g000', 'invoice.paid', 0, { api_version: '2027-01-01.future' }),
      ...Array.from({ length: 101 }, (_, i) => ev(`evt_g${String(i + 1).padStart(3, '0')}`, 'invoice.paid', i + 1)),
    ];
    const h = setup({ events });
    const counts = await h.run();
    expect(counts).toMatchObject({ replayed: 100, incomplete: 1, apiVersionSkipped: 1 });
    expect(h.named('bos_plan_reconcile_unverified_shapes')).toHaveLength(1);
  });
});

// ── Deadline and batch caps ──────────────────────────────────────────────────

describe('QA: deadline and batch caps', () => {
  const PRICES = new Map([
    ['price_one', 'tier_a'],
    ['price_two', 'tier_b'],
  ]);
  const sub = (id: string): PlanReconcileSubscription => ({
    id,
    status: 'active',
    livemode: false,
    cancelAtPeriodEnd: false,
    endedAt: null,
    items: [{ priceId: 'price_one', currentPeriodStart: sec(NOW - 10 * DAY), currentPeriodEnd: sec(NOW + 20 * DAY) }],
  });
  const openRow = (subscriptionId: string): PlanReconcileBillingRow => ({
    id: `b_${subscriptionId}`,
    user_id: null,
    stripe_subscription_id: subscriptionId,
    subscription_status: 'active',
    bought_tier: 'tier_a',
    current_period_end: new Date(sec(NOW + 20 * DAY) * 1000).toISOString(),
    cancel_at_period_end: false,
    ended_at: null,
  });

  it('the deadline reached during Step A: Step B is not started (no Stripe list), checkIncomplete', async () => {
    let now = NOW;
    const h = setup({ events: [ev('evt_h1', 'invoice.paid', 1)], prices: PRICES, clock: () => now });
    h.deps.handle = async () => {
      now = NOW + 45_000 - PLAN_RECONCILE_LIMITS.MARGIN_MS;
    };
    const counts = await h.run();
    expect(h.listedPrices).toEqual([]);
    expect(counts).toMatchObject({ checkIncomplete: 1, orphan: 0, mismatch: 0 });
  });

  it('the deadline reached inside the price loop: no orphan and no not-listed finding from the half-read lists', async () => {
    let now = NOW;
    const h = setup({
      prices: PRICES,
      // price_one lists an orphan; our row's subscription is on price_two, never listed.
      subscriptions: { price_one: [sub('sub_orphan')], price_two: [sub('sub_ours')] },
      rows: [openRow('sub_ours')],
      clock: () => now,
    });
    const list = h.deps.stripe()!.listBusinessOsSubscriptionsByPrice;
    h.deps.stripe = () => ({
      listBusinessOsPlanEvents: async () => ({ items: [], complete: true }),
      listBusinessOsSubscriptionsByPrice: async (priceId) => {
        const listed = await list(priceId);
        now = NOW + 45_000;
        return listed;
      },
    });
    const counts = await h.run();
    expect(h.listedPrices).toEqual(['price_one']);
    expect(h.named('bos_plan_reconcile_finding')).toEqual([]);
    expect(counts).toMatchObject({ orphan: 0, mismatch: 0, checkIncomplete: 1 });
  });

  it('a Stripe list that throws: no orphan and no not-listed finding, checkIncomplete', async () => {
    const h = setup({
      prices: PRICES,
      subscriptions: { price_one: [sub('sub_orphan')], price_two: 'throw' },
      rows: [openRow('sub_ours')],
    });
    const counts = await h.run();
    expect(h.named('bos_plan_reconcile_finding')).toEqual([]);
    expect(counts).toMatchObject({ orphan: 0, mismatch: 0, checkIncomplete: 1 });
  });

  it('completed non-invoice events do not count against the 100 cap', async () => {
    const claims: Record<string, ClaimRow> = {};
    const events = Array.from({ length: 150 }, (_, i) => {
      const id = `evt_i${String(i).padStart(3, '0')}`;
      claims[id] = { status: 'completed', processedAt: NOW - DAY };
      return ev(id, 'customer.subscription.updated', i);
    });
    events.push(ev('evt_i999', 'invoice.paid', 999));
    const h = setup({ events, claims });
    const counts = await h.run();
    expect(h.handled).toEqual(['evt_i999']);
    expect(counts.incomplete).toBe(0);
  });

  it('ruling 13 as built: completed invoice.paid Step C checks DO count against the cap, so a failed event after 100 of them is left (incomplete)', async () => {
    const claims: Record<string, ClaimRow> = {};
    const events = Array.from({ length: 100 }, (_, i) => {
      const id = `evt_j${String(i).padStart(3, '0')}`;
      claims[id] = { status: 'completed', processedAt: NOW - DAY };
      return ev(id, 'invoice.paid', i);
    });
    events.push(ev('evt_j999', 'invoice.paid', 999));
    claims.evt_j999 = { status: 'failed', processedAt: NOW - DAY };
    const h = setup({ events, claims });
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts.incomplete).toBe(1);
  });
});

// ── Logs: no PII, ids only ───────────────────────────────────────────────────

describe('QA: log lines carry ids and kinds only', () => {
  it('across replay, failure, unsettled, unverified, Step B and Step C paths, every key is from a fixed set and no value looks like PII', async () => {
    const PRICES = new Map([['price_one', 'tier_a']]);
    const h = setup({
      events: [
        ev('evt_k1', 'invoice.paid', 1),
        ev('evt_k2', 'invoice.paid', 2),
        ev('evt_k3', 'invoice.paid', 3, { api_version: '2027-01-01.future' }),
        ev('evt_k4', 'invoice.paid', 4),
      ],
      claims: { evt_k4: { status: 'completed', processedAt: NOW - DAY } },
      prices: PRICES,
      subscriptions: {
        price_one: [
          {
            id: 'sub_k_orphan',
            status: 'active',
            livemode: false,
            cancelAtPeriodEnd: false,
            endedAt: null,
            items: [{ priceId: 'price_one', currentPeriodStart: sec(NOW - 10 * DAY), currentPeriodEnd: sec(NOW + 20 * DAY) }],
          },
        ],
      },
      rows: [
        {
          id: 'b_k',
          user_id: '33333333-3333-4333-8333-333333333333',
          stripe_subscription_id: 'sub_k_gone',
          subscription_status: 'active',
          bought_tier: 'tier_a',
          current_period_end: null,
          cancel_at_period_end: false,
          ended_at: null,
        },
      ],
    });
    let n = 0;
    h.deps.handle = async () => {
      n += 1;
      if (n === 2) throw new Error('customer jane@example.com card declined');
    };
    h.deps.claims.markFailed = async () => ({ error: { message: 'down' } });
    await h.run();

    const ALLOWED = new Set([
      'event',
      'kind',
      'step',
      'ok',
      'alert',
      'stripeEventId',
      'eventType',
      'stripeInvoiceId',
      'billingAccountId',
      'stripeSubscriptionId',
      'errorName',
      'claim',
      'pairs',
      'trigger',
      'windowBasis',
      // the done line spreads the counts
      'eventsSeen',
      'replayed',
      'replayFailed',
      'skippedNotPlan',
      'apiVersionSkipped',
      'staleReclaimed',
      'mismatch',
      'orphan',
      'unassigned',
      'incomplete',
      'deadlineHit',
      'windowClipped',
      'checkIncomplete',
    ]);
    const kinds = new Set(h.lines.map((line) => line.ctx.event));
    for (const expected of [
      'bos_plan_reconcile_replayed',
      'bos_plan_reconcile_replay_failed',
      'bos_plan_reconcile_claim_not_settled',
      'bos_plan_reconcile_unverified_shapes',
      'bos_plan_reconcile_finding',
      'bos_plan_reconcile_done',
    ]) {
      expect(kinds).toContain(expected);
    }
    for (const line of h.lines) {
      for (const key of Object.keys(line.ctx)) expect({ event: line.ctx.event, key, allowed: ALLOWED.has(key) }).toMatchObject({ allowed: true });
      const text = JSON.stringify(line);
      expect(text).not.toMatch(/@/);
      expect(text).not.toMatch(/declined/);
      expect(text).not.toMatch(/cus_/);
    }
    // The handler's error text is never logged; only its class name is.
    expect(h.named('bos_plan_reconcile_replay_failed')[0].ctx.errorName).toBe('Error');
  });
});
