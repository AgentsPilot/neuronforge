/**
 * The plan pass of `bos-billing-reconcile` (plan payments P-8b.2, workplan
 * docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P8B_WORKPLAN.md §4.2, §8; SA rulings
 * 2, 3, 4, 8, 10, 13, 14).
 *
 * In memory: a claim table with the repository's semantics (unique insert,
 * conditional reclaims), a fake Stripe, fake reads. No database, no network.
 */

import type Stripe from 'stripe';

import {
  createPlanReconcilePass,
  PLAN_RECONCILE_COUNT_KEYS,
  PLAN_RECONCILE_LIMITS,
  PLAN_WINDOW_BLOCKING_COUNTS,
  planReconcileWindow,
  runFinishedPlanWork,
  type PlanClaimStatus,
  type PlanReconcileBillingRow,
  type PlanReconcileDeps,
  type PlanReconcilePlanFacts,
  type PlanReconcileRun,
  type PlanReconcileSubscription,
} from '@/lib/business-os/billing/planReconcilePass';
import { runReconcilePasses, type ReconcilePassContext } from '@/lib/business-os/billing/reconcilePassRunner';
import { findBosCronJob } from '@/lib/cron/bosCronJobs';

const NOW = Date.parse('2026-10-28T05:41:00.000Z');
const HOUR = 60 * 60 * 1000;
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
/** As PLAN_HANDLER_VERIFIED_EVENT_SHAPES is built: the clover pin verifies all 7, endive a subset. */
const SHAPES: Record<string, readonly string[]> = {
  [API]: TYPES,
  '2026-09-30.endive': ['invoice.paid', 'customer.subscription.deleted'],
};

// ── Fakes ────────────────────────────────────────────────────────────────────

interface ClaimRow {
  status: PlanClaimStatus;
  processedAt: number;
}

function claimTable(initial: Record<string, ClaimRow> = {}) {
  const rows = new Map<string, ClaimRow>(Object.entries(initial));
  const calls: string[] = [];
  const port: PlanReconcileDeps['claims'] = {
    findClaim: async (id) => {
      calls.push(`findClaim:${id}`);
      const row = rows.get(id);
      return { data: row ? { event_id: id, status: row.status } : null, error: null };
    },
    insertClaim: async (row) => {
      calls.push(`insertClaim:${row.event_id}`);
      if (rows.has(row.event_id)) return { error: { code: '23505', message: 'duplicate' } };
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
  return { rows, calls, port };
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

function logger() {
  const lines: Array<{ level: string; ctx: Record<string, unknown>; msg: string }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>, msg: string) => {
    lines.push({ level, ctx, msg });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error') };
  const named = (name: string) => lines.filter((line) => line.ctx.event === name);
  return { log, lines, named };
}

interface Setup {
  events?: Stripe.Event[];
  eventsComplete?: boolean;
  claims?: Record<string, ClaimRow>;
  dispatch?: PlanReconcileDeps['dispatch'];
  handle?: PlanReconcileDeps['handle'];
  runs?: PlanReconcileRun[] | 'error';
  rows?: PlanReconcileBillingRow[];
  plans?: Record<string, PlanReconcilePlanFacts>;
  subscriptions?: Record<string, PlanReconcileSubscription[]>;
  subscriptionsComplete?: boolean;
  prices?: Map<string, string>;
  recorded?: { eventIds: string[]; invoiceIds: string[] } | 'error';
  clock?: () => number;
  keyLivemode?: boolean | null;
}

function setup(options: Setup = {}) {
  const table = claimTable(options.claims);
  const handled: string[] = [];
  const listCalls: Array<{ createdGte: number; types: readonly string[] }> = [];
  const deps: PlanReconcileDeps = {
    eventTypes: TYPES,
    verifiedShapes: SHAPES,
    staleClaimAgeMs: 15 * 60 * 1000,
    keyLivemode: () => (options.keyLivemode === undefined ? false : options.keyLivemode),
    stripe: () => ({
      listBusinessOsPlanEvents: async (params) => {
        listCalls.push(params);
        return { items: options.events ?? [], complete: options.eventsComplete ?? true };
      },
      listBusinessOsSubscriptionsByPrice: async (priceId) => ({
        items: options.subscriptions?.[priceId] ?? [],
        complete: options.subscriptionsComplete ?? true,
      }),
    }),
    claims: table.port,
    dispatch: options.dispatch ?? (async () => ({ kind: 'plan' })),
    handle:
      options.handle ??
      (async (event) => {
        handled.push(event.id);
      }),
    recentRuns: async () => (options.runs === 'error' ? { data: null, error: new Error('down') } : { data: options.runs ?? [], error: null }),
    billingRows: async () => ({ data: options.rows ?? [], error: null }),
    planFacts: async () => ({ data: options.plans ?? {}, error: null }),
    recordedPayments: async () =>
      options.recorded === 'error' ? { data: null, error: new Error('down') } : { data: options.recorded ?? { eventIds: [], invoiceIds: [] }, error: null },
    planPrices: async () => options.prices ?? new Map(),
    clock: options.clock ?? (() => NOW),
  };
  const logs = logger();
  const context: ReconcilePassContext = { deadlineAt: NOW + 45_000, now: new Date(NOW), log: logs.log, trigger: 'nightly' };
  const pass = createPlanReconcilePass(deps);
  return { deps, table, handled, listCalls, logs, context, pass, run: () => pass.run(context) };
}

const sec = (ms: number) => Math.floor(ms / 1000);
const cleanCounts = (extra: Record<string, number> = {}) => ({
  planEventsSeen: 3,
  planIncomplete: 0,
  planDeadlineHit: 0,
  planReplayFailed: 0,
  passesFailed: 0,
  ...extra,
});

// ── The window (SA ruling 8) ─────────────────────────────────────────────────

describe('the replay window (SA ruling 8)', () => {
  it('anchors on the newest run whose plan pass finished all its work, minus one hour of overlap', () => {
    const runs: PlanReconcileRun[] = [
      { started_at: new Date(NOW - 1 * DAY).toISOString(), counts: cleanCounts({ planIncomplete: 1 }) },
      { started_at: new Date(NOW - 2 * DAY).toISOString(), counts: cleanCounts() },
    ];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({
      createdGte: sec(NOW - 2 * DAY - HOUR),
      clipped: false,
      basis: 'anchored',
    });
  });

  it.each(PLAN_WINDOW_BLOCKING_COUNTS)('a run with %s > 0 never anchors the window', (key) => {
    expect(runFinishedPlanWork(cleanCounts({ [key]: 1 }))).toBe(false);
  });

  it('a run from before the plan pass existed (no plan counts) never anchors it', () => {
    expect(runFinishedPlanWork({ boostExamined: 0, passesFailed: 0 })).toBe(false);
    expect(runFinishedPlanWork(null)).toBe(false);
  });

  it('runs of the plan pass exist but none finished: 7 days back, clipped (never past unprocessed events)', () => {
    const runs = [{ started_at: new Date(NOW - DAY).toISOString(), counts: cleanCounts({ planDeadlineHit: 1 }) }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({
      createdGte: sec(NOW - 7 * DAY),
      clipped: true,
      basis: 'no_clean_run',
    });
  });

  it('an anchor older than 7 days is cut at 7 days and the cut is counted', () => {
    const runs = [{ started_at: new Date(NOW - 7 * DAY + 30 * 60 * 1000).toISOString(), counts: cleanCounts() }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 7 * DAY), clipped: true, basis: 'anchored' });
  });

  it('SA fix 3: one clean plan run 10 days ago gives a 7-day window, clipped (never the 3-day first-night window)', () => {
    const runs = [{ started_at: new Date(NOW - 10 * DAY).toISOString(), counts: cleanCounts() }];
    expect(planReconcileWindow(NOW, { data: runs, error: null })).toEqual({ createdGte: sec(NOW - 7 * DAY), clipped: true, basis: 'anchored' });
  });

  it('SA fix 3: the pass reads 30 days of run history', async () => {
    const h = setup();
    const since: string[] = [];
    h.deps.recentRuns = async (sinceIso) => {
      since.push(sinceIso);
      return { data: [], error: null };
    };
    await h.run();
    expect(since).toEqual([new Date(NOW - 30 * DAY).toISOString()]);
  });

  it('no run of the plan pass at all (its first night): 3 days back', () => {
    expect(planReconcileWindow(NOW, { data: [], error: null })).toEqual({ createdGte: sec(NOW - 3 * DAY), clipped: false, basis: 'first_run' });
  });

  it('runs unreadable: the widest safe window, 7 days', () => {
    expect(planReconcileWindow(NOW, { data: null, error: new Error('x') })).toEqual({
      createdGte: sec(NOW - 7 * DAY),
      clipped: false,
      basis: 'runs_unreadable',
    });
  });

  it('the pass lists from the window start, with exactly the handler type set, and counts a clipped window', async () => {
    const h = setup({ runs: [{ started_at: new Date(NOW - DAY).toISOString(), counts: cleanCounts({ planReplayFailed: 2 }) }] });
    const counts = await h.run();
    expect(h.listCalls).toEqual([{ createdGte: sec(NOW - 7 * DAY), types: TYPES }]);
    expect(counts.windowClipped).toBe(1);
  });

  it('an unreadable run history is a check-incomplete, and the pass still replays', async () => {
    const h = setup({ runs: 'error', events: [ev('evt_a1', 'invoice.paid', 100)] });
    const counts = await h.run();
    expect(counts.checkIncomplete).toBe(1);
    expect(counts.replayed).toBe(1);
  });
});

// ── Step A: replay (SA rulings 2, 3, 13) ─────────────────────────────────────

describe('Step A: replay through the same claim table and handler', () => {
  it('no claim: inserts one, runs the handler, completes it; oldest first', async () => {
    const h = setup({ events: [ev('evt_b2', 'invoice.paid', 200), ev('evt_b1', 'customer.subscription.updated', 100)] });
    const counts = await h.run();
    expect(h.handled).toEqual(['evt_b1', 'evt_b2']);
    expect(h.table.calls).toEqual([
      'findClaim:evt_b1',
      'insertClaim:evt_b1',
      'complete:evt_b1',
      'findClaim:evt_b2',
      'insertClaim:evt_b2',
      'complete:evt_b2',
    ]);
    expect(counts).toMatchObject({ eventsSeen: 2, replayed: 2, replayFailed: 0, incomplete: 0 });
    expect(h.table.rows.get('evt_b1')?.status).toBe('completed');
  });

  it('a failed claim is taken back with the CONDITIONAL reclaim, never the unconditional one', async () => {
    const h = setup({ events: [ev('evt_c1', 'invoice.paid', 1)], claims: { evt_c1: { status: 'failed', processedAt: NOW - DAY } } });
    await h.run();
    expect(h.table.calls).toEqual(['findClaim:evt_c1', 'reclaimFailedIfStillFailed:evt_c1', 'complete:evt_c1']);
    expect(h.handled).toEqual(['evt_c1']);
  });

  it('a stale processing claim is reclaimed (counted) and replayed', async () => {
    const h = setup({ events: [ev('evt_d1', 'invoice.paid', 1)], claims: { evt_d1: { status: 'processing', processedAt: NOW - 20 * 60 * 1000 } } });
    const counts = await h.run();
    expect(h.table.calls).toEqual(['findClaim:evt_d1', 'reclaimStale:evt_d1', 'complete:evt_d1']);
    expect(counts).toMatchObject({ staleReclaimed: 1, replayed: 1 });
  });

  it('a fresh processing claim (1 minute old) is left alone: no handler, and the window may not move past it', async () => {
    const h = setup({ events: [ev('evt_e1', 'invoice.paid', 1)], claims: { evt_e1: { status: 'processing', processedAt: NOW - 60 * 1000 } } });
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts).toMatchObject({ replayed: 0, staleReclaimed: 0, incomplete: 1 });
    expect(h.table.rows.get('evt_e1')?.status).toBe('processing');
  });

  it('a lost insert race (23505) runs no handler', async () => {
    const h = setup({ events: [ev('evt_f1', 'invoice.paid', 1)] });
    // A live delivery claims it between the read and the insert.
    const insert = h.deps.claims.insertClaim;
    h.deps.claims.insertClaim = async (row) => {
      h.table.rows.set(row.event_id, { status: 'processing', processedAt: NOW });
      return insert(row);
    };
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts.replayed).toBe(0);
    // SA fix 1: the winner may still fail, so the window must not move past it.
    expect(counts.incomplete).toBe(1);
  });

  it('a lost conditional failed-reclaim (count 0: another actor took the failed row) runs no handler and is incomplete (SA fix 1)', async () => {
    const h = setup({ events: [ev('evt_f2', 'invoice.paid', 1)], claims: { evt_f2: { status: 'failed', processedAt: NOW - DAY } } });
    h.deps.claims.reclaimFailedIfStillFailed = async () => ({ data: { won: false }, error: null });
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts).toMatchObject({ replayed: 0, replayFailed: 0, incomplete: 1 });
  });

  it.each([
    ['complete() fails after the handler returned', 'complete' as const, undefined],
    [
      'markFailed() fails after the handler threw',
      'markFailed' as const,
      async () => {
        throw new Error('boom');
      },
    ],
  ])('%s: the claim stays processing, so the run is incomplete (SA fix 2)', async (_name, method, handle) => {
    const h = setup({ events: [ev('evt_f3', 'invoice.paid', 1)], ...(handle ? { handle } : {}) });
    h.deps.claims[method] = async () => ({ error: { message: 'db down' } });
    const counts = await h.run();
    expect(counts.incomplete).toBe(1);
    expect(h.logs.named('bos_plan_reconcile_claim_not_settled')).toHaveLength(1);
    expect(h.table.rows.get('evt_f3')?.status).toBe('processing');
  });

  it('a settled replay leaves the run complete (the fixes do not over-block)', async () => {
    const h = setup({ events: [ev('evt_f4', 'invoice.paid', 1)] });
    expect((await h.run()).incomplete).toBe(0);
  });

  it('a completed claim of a non-invoice event is not touched and not dispatched', async () => {
    const dispatch = jest.fn(async () => ({ kind: 'plan' as const }));
    const h = setup({
      events: [ev('evt_g1', 'customer.subscription.updated', 1)],
      claims: { evt_g1: { status: 'completed', processedAt: NOW - DAY } },
      dispatch,
    });
    await h.run();
    expect(dispatch).not.toHaveBeenCalled();
    expect(h.table.calls).toEqual(['findClaim:evt_g1']);
    expect(h.handled).toEqual([]);
  });

  it('the handler throwing marks the claim failed (never completed) and counts a failed replay', async () => {
    const h = setup({
      events: [ev('evt_h1', 'invoice.paid', 1)],
      handle: async () => {
        throw new Error('stripe down');
      },
    });
    const counts = await h.run();
    expect(h.table.calls).toEqual(['findClaim:evt_h1', 'insertClaim:evt_h1', 'markFailed:evt_h1']);
    expect(h.table.rows.get('evt_h1')?.status).toBe('failed');
    expect(counts).toMatchObject({ replayed: 0, replayFailed: 1 });
    expect(h.logs.named('bos_plan_reconcile_replay_failed')).toHaveLength(1);
  });

  it('a non-plan event (boost, deny, not ours) is skipped without a claim', async () => {
    const h = setup({ events: [ev('evt_i1', 'invoice.paid', 1)], dispatch: async () => ({ kind: 'other' }) });
    const counts = await h.run();
    expect(h.table.calls).toEqual(['findClaim:evt_i1']);
    expect(counts.skippedNotPlan).toBe(1);
  });

  it('a dispatcher throw is counted and skipped; the pass goes on (SA ruling 13)', async () => {
    let first = true;
    const h = setup({
      events: [ev('evt_j1', 'invoice.paid', 1), ev('evt_j2', 'invoice.paid', 2)],
      dispatch: async () => {
        if (first) {
          first = false;
          throw new Error('could not tell');
        }
        return { kind: 'plan' };
      },
    });
    const counts = await h.run();
    expect(h.handled).toEqual(['evt_j2']);
    expect(counts).toMatchObject({ replayFailed: 1, replayed: 1 });
  });

  it('an event from the other Stripe mode is never claimed (PF-15)', async () => {
    const h = setup({ events: [ev('evt_k1', 'invoice.paid', 1, { livemode: true })] });
    const counts = await h.run();
    expect(h.table.calls).toEqual([]);
    expect(counts.skippedNotPlan).toBe(1);
  });

  it('API-version ruling (b): a verified (version, type) pair at another version than the pin is replayed', async () => {
    const h = setup({ events: [ev('evt_l0', 'invoice.paid', 1, { api_version: '2026-09-30.endive' })] });
    const counts = await h.run();
    expect(h.handled).toEqual(['evt_l0']);
    expect(counts.apiVersionSkipped).toBe(0);
    expect(h.logs.named('bos_plan_reconcile_unverified_shapes')).toEqual([]);
  });

  it('an unverified API version is skipped and counted, never claimed', async () => {
    const h = setup({ events: [ev('evt_l1', 'invoice.paid', 1, { api_version: '2027-03-31.future' })] });
    const counts = await h.run();
    expect(h.table.calls).toEqual([]);
    expect(counts.apiVersionSkipped).toBe(1);
  });

  it('a verified version with an unverified type is skipped; one summary warn names the pairs and counts, no ids', async () => {
    const h = setup({
      events: [
        ev('evt_l2', 'checkout.session.expired', 1, { api_version: '2026-09-30.endive' }),
        ev('evt_l3', 'checkout.session.expired', 2, { api_version: '2026-09-30.endive' }),
        ev('evt_l4', 'invoice.paid', 3, { api_version: '2027-03-31.future' }),
        ev('evt_l5', 'invoice.paid', 4, { api_version: '2026-09-30.endive' }),
      ],
    });
    const counts = await h.run();
    expect(h.handled).toEqual(['evt_l5']);
    expect(counts.apiVersionSkipped).toBe(3);
    const lines = h.logs.named('bos_plan_reconcile_unverified_shapes');
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe('warn');
    expect(lines[0].ctx).toEqual({
      event: 'bos_plan_reconcile_unverified_shapes',
      pairs: [
        { apiVersion: '2026-09-30.endive', eventType: 'checkout.session.expired', count: 2 },
        { apiVersion: '2027-03-31.future', eventType: 'invoice.paid', count: 1 },
      ],
    });
    expect(JSON.stringify(lines[0].ctx)).not.toMatch(/evt_/);
  });

  it('an event type outside the handler set is never dispatched', async () => {
    const dispatch = jest.fn(async () => ({ kind: 'plan' as const }));
    const h = setup({ events: [ev('evt_m1', 'charge.refunded', 1)], dispatch });
    await h.run();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('the deadline stops new work 15 s before the shared deadline', async () => {
    let now = NOW;
    const h = setup({
      events: [ev('evt_n1', 'invoice.paid', 1), ev('evt_n2', 'invoice.paid', 2)],
      clock: () => now,
      handle: async () => {
        now = NOW + 45_000 - PLAN_RECONCILE_LIMITS.MARGIN_MS;
      },
    });
    const counts = await h.run();
    expect(h.table.calls.filter((c) => c.startsWith('insertClaim'))).toEqual(['insertClaim:evt_n1']);
    expect(counts).toMatchObject({ deadlineHit: 1, replayed: 1 });
  });

  it('at most 100 events reach the dispatcher; the rest are left (incomplete)', async () => {
    const events = Array.from({ length: 105 }, (_, i) => ev(`evt_o${String(i).padStart(3, '0')}`, 'invoice.paid', i));
    const h = setup({ events });
    const counts = await h.run();
    expect(counts).toMatchObject({ replayed: 100, incomplete: 1, eventsSeen: 105 });
  });

  it('a list stopped at its page cap is incomplete (the window will not move)', async () => {
    const h = setup({ events: [ev('evt_p1', 'invoice.paid', 1)], eventsComplete: false });
    const counts = await h.run();
    expect(counts).toMatchObject({ incomplete: 1, replayed: 1 });
  });

  it('no usable Stripe key: nothing is read or written, incomplete', async () => {
    const h = setup({ keyLivemode: null, events: [ev('evt_q1', 'invoice.paid', 1)] });
    const counts = await h.run();
    expect(h.table.calls).toEqual([]);
    expect(h.listCalls).toEqual([]);
    expect(counts.incomplete).toBe(1);
  });

  it('a claim read error never leads to a handler run', async () => {
    const h = setup({ events: [ev('evt_r1', 'invoice.paid', 1)] });
    h.deps.claims.findClaim = async () => ({ data: null, error: { message: 'down' } });
    const counts = await h.run();
    expect(h.handled).toEqual([]);
    expect(counts.replayFailed).toBe(1);
  });
});

// ── Convergence (SR-4; workplan §8 "Convergence") ────────────────────────────

describe('convergence with the webhook', () => {
  it('a second run changes nothing: a completed claim is never replayed', async () => {
    const h = setup({ events: [ev('evt_s1', 'customer.subscription.deleted', 1)] });
    await h.run();
    await h.run();
    expect(h.handled).toEqual(['evt_s1']);
  });

  it('an event the webhook completed in the meantime is skipped (one handler run in total)', async () => {
    const h = setup({ events: [ev('evt_t1', 'invoice.paid', 1)], claims: { evt_t1: { status: 'completed', processedAt: NOW } } });
    await h.run();
    expect(h.handled).toEqual([]);
  });

  it('a delivery that wins the failed row between the read and the reclaim: the pass does not run the handler', async () => {
    const h = setup({ events: [ev('evt_u1', 'invoice.paid', 1)], claims: { evt_u1: { status: 'failed', processedAt: NOW - DAY } } });
    const reclaim = h.deps.claims.reclaimFailedIfStillFailed;
    h.deps.claims.reclaimFailedIfStillFailed = async (id) => {
      h.table.rows.set(id, { status: 'processing', processedAt: NOW });
      return reclaim(id);
    };
    await h.run();
    expect(h.handled).toEqual([]);
  });
});

// ── Step C: a paid plan invoice with no assignment ──────────────────────────

describe('Step C: paid invoices with no plan assignment', () => {
  const completedPaid = (id: string) => ({ [id]: { status: 'completed' as const, processedAt: NOW - DAY } });

  it('a completed plan invoice.paid with no money history row is one finding; it is not replayed', async () => {
    const h = setup({ events: [ev('evt_v1', 'invoice.paid', 1)], claims: completedPaid('evt_v1') });
    const counts = await h.run();
    expect(counts.unassigned).toBe(1);
    expect(h.handled).toEqual([]);
    const [line] = h.logs.named('bos_plan_reconcile_finding');
    expect(line.ctx).toEqual({ event: 'bos_plan_reconcile_finding', kind: 'paid_invoice_unassigned', stripeEventId: 'evt_v1', stripeInvoiceId: 'in_v1', alert: true });
  });

  it.each([
    ['the event wrote a row (a payment or a recorded refusal)', { eventIds: ['evt_w1'], invoiceIds: [] }],
    ['the invoice holds an invoice_paid row', { eventIds: [], invoiceIds: ['in_w1'] }],
  ])('no finding when %s', async (_name, recorded) => {
    const h = setup({ events: [ev('evt_w1', 'invoice.paid', 1)], claims: completedPaid('evt_w1'), recorded });
    expect((await h.run()).unassigned).toBe(0);
  });

  it('only plan events are checked (SA ruling 13)', async () => {
    const h = setup({ events: [ev('evt_x1', 'invoice.paid', 1)], claims: completedPaid('evt_x1'), dispatch: async () => ({ kind: 'other' }) });
    expect((await h.run()).unassigned).toBe(0);
  });

  it('an unreadable money history is a check-incomplete, never a finding', async () => {
    const h = setup({ events: [ev('evt_y1', 'invoice.paid', 1)], claims: completedPaid('evt_y1'), recorded: 'error' });
    const counts = await h.run();
    expect(counts).toMatchObject({ unassigned: 0, checkIncomplete: 1 });
  });
});

// ── Step B: Stripe vs our records (flag only) ────────────────────────────────

describe('Step B: Stripe vs our billing records (flag only, SA ruling 4)', () => {
  const ACCOUNT = '11111111-1111-4111-8111-111111111111';
  const PRICES = new Map([
    ['price_one', 'tier_a'],
    ['price_two', 'tier_b'],
  ]);
  const periodStart = sec(NOW - 10 * DAY);
  const periodEnd = sec(NOW + 20 * DAY);

  function sub(overrides: Partial<PlanReconcileSubscription> = {}): PlanReconcileSubscription {
    return {
      id: 'sub_1',
      status: 'active',
      livemode: false,
      cancelAtPeriodEnd: false,
      endedAt: null,
      items: [{ priceId: 'price_one', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }],
      ...overrides,
    };
  }
  function row(overrides: Partial<PlanReconcileBillingRow> = {}): PlanReconcileBillingRow {
    return {
      id: 'b1',
      user_id: ACCOUNT,
      stripe_subscription_id: 'sub_1',
      subscription_status: 'active',
      bought_tier: 'tier_a',
      current_period_end: new Date(periodEnd * 1000).toISOString(),
      cancel_at_period_end: false,
      ended_at: null,
      ...overrides,
    };
  }
  const plan = (overrides: Partial<PlanReconcilePlanFacts> = {}) => ({
    [ACCOUNT]: { tier: 'tier_a', tierExpiresAt: new Date(periodEnd * 1000).toISOString(), ...overrides },
  });

  function stepB(options: Partial<Setup> & { subs?: PlanReconcileSubscription[] } = {}) {
    return setup({ prices: PRICES, subscriptions: { price_one: options.subs ?? [sub()] }, rows: [row()], plans: plan(), ...options });
  }
  const kinds = (h: ReturnType<typeof setup>) => h.logs.named('bos_plan_reconcile_finding').map((line) => line.ctx.kind);

  it('all in agreement: no finding, no write of any kind', async () => {
    const h = stepB();
    const counts = await h.run();
    expect(counts).toMatchObject({ mismatch: 0, orphan: 0 });
    expect(h.table.calls).toEqual([]);
    expect(h.handled).toEqual([]);
  });

  it.each<[string, Partial<Setup> & { subs?: PlanReconcileSubscription[] }, string]>([
    ['status', { subs: [sub({ status: 'past_due' })] }, 'status_differs'],
    ['cancel flag', { subs: [sub({ cancelAtPeriodEnd: true })] }, 'cancel_flag_differs'],
    ['a price swapped in the Stripe dashboard', { subs: [sub({ items: [{ priceId: 'price_two', currentPeriodStart: periodStart, currentPeriodEnd: periodEnd }] })] }, 'tier_differs'],
    ['the period end', { rows: [row({ current_period_end: new Date((periodEnd - DAY / 1000) * 1000).toISOString() })] }, 'period_differs'],
    ['the plan row tier changed by an admin', { plans: plan({ tier: 'tier_b' }) }, 'plan_tier_differs'],
    ['the paid-through date', { plans: plan({ tierExpiresAt: new Date(NOW).toISOString() }) }, 'plan_paid_through_differs'],
  ])('%s → one finding and planMismatch = 1', async (_name, options, kind) => {
    const h = stepB(options);
    const counts = await h.run();
    expect(kinds(h)).toEqual([kind]);
    expect(counts.mismatch).toBe(1);
    expect(h.table.calls).toEqual([]);
  });

  it('our open row whose subscription Stripe no longer lists (complete lists) → subscription_not_listed', async () => {
    const h = stepB({ subs: [] });
    await h.run();
    expect(kinds(h)).toEqual(['subscription_not_listed']);
  });

  it('a renewal younger than a day is not a period finding (its paid invoice may be on the way)', async () => {
    const fresh = sec(NOW - HOUR);
    const h = stepB({ subs: [sub({ items: [{ priceId: 'price_one', currentPeriodStart: fresh, currentPeriodEnd: sec(NOW + 30 * DAY) }] })] });
    await h.run();
    expect(kinds(h)).toEqual([]);
  });

  // FU-P8b-6 (SA P3-SA-2 item 6, P3-SA-10). In each case the mirror's period end
  // and the plan row's paid-through equal Stripe's, and the status and cancel
  // flag match, so the tier is the only possible difference.
  describe('FU-P8b-6: a paying row with no tier on the mirror', () => {
    const at = (startSec: number | null) => [
      sub({ items: [{ priceId: 'price_one', currentPeriodStart: startSec, currentPeriodEnd: periodEnd }] }),
    ];

    it('period started over a day ago, Stripe tier resolves → exactly one tier_differs, no plan_tier_differs', async () => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR)), rows: [row({ bought_tier: null })] });
      const counts = await h.run();
      expect(kinds(h)).toEqual(['tier_differs']);
      expect(counts.mismatch).toBe(1);
      expect(h.table.calls).toEqual([]);
    });

    it('period started under a day ago → no finding (a checkout still settling)', async () => {
      const h = stepB({ subs: at(sec(NOW - 23 * HOUR)), rows: [row({ bought_tier: null })] });
      const counts = await h.run();
      expect(kinds(h)).toEqual([]);
      expect(counts.mismatch).toBe(0);
    });

    it('period start unknown → no finding from the null tier (never treated as settled)', async () => {
      const h = stepB({ subs: at(null), rows: [row({ bought_tier: null })] });
      const counts = await h.run();
      expect(kinds(h)).toEqual([]);
      expect(counts.mismatch).toBe(0);
    });
  });

  // QA P-8b.3a: edges of FU-P8b-6 beyond the three ruled cases.
  describe('QA P-8b.3a: FU-P8b-6 edges', () => {
    const START = sec(NOW - 30 * HOUR);
    const START_MS = START * 1000;
    const SETTLE = PLAN_RECONCILE_LIMITS.RENEWAL_SETTLE_MS;
    const at = (startSec: number | null, priceIds: string[] = ['price_one'], status = 'active') => [
      sub({ status, items: priceIds.map((priceId) => ({ priceId, currentPeriodStart: startSec, currentPeriodEnd: periodEnd })) }),
    ];

    it.each<[string, number, string[]]>([
      ['1 ms short of 24 h → nothing', START_MS + SETTLE - 1, []],
      ['exactly 24 h → tier_differs (>= boundary)', START_MS + SETTLE, ['tier_differs']],
      ['1 ms past 24 h → tier_differs', START_MS + SETTLE + 1, ['tier_differs']],
    ])('the 24 h boundary: %s', async (_name, clockMs, expected) => {
      const h = stepB({ subs: at(START), rows: [row({ bought_tier: null })], clock: () => clockMs });
      const counts = await h.run();
      expect(kinds(h)).toEqual(expected);
      expect(counts.mismatch).toBe(expected.length);
    });

    it('not paying on both sides (past_due / past_due) → no finding from the null tier', async () => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR), ['price_one'], 'past_due'), rows: [row({ bought_tier: null, subscription_status: 'past_due' })] });
      await h.run();
      expect(kinds(h)).toEqual([]);
    });

    it('our record not paying (canceled, still open) while Stripe is active → only status_differs, never tier_differs', async () => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR)), rows: [row({ bought_tier: null, subscription_status: 'canceled' })] });
      await h.run();
      expect(kinds(h)).toEqual(['status_differs']);
    });

    it.each<[string, string[]]>([
      ['an unknown price', ['price_unknown']],
      ['two prices on two tiers (ambiguous)', ['price_one', 'price_two']],
    ])('the Stripe tier does not resolve (%s) → nothing from the null tier', async (_name, priceIds) => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR), priceIds), rows: [row({ bought_tier: null })] });
      const counts = await h.run();
      expect(kinds(h)).toEqual([]);
      expect(counts.mismatch).toBe(0);
    });

    it.each<[string, Record<string, PlanReconcilePlanFacts>]>([
      ['the plan row on another tier', plan({ tier: 'tier_b' })],
      ['the plan row with no tier', plan({ tier: null })],
      ['no plan row at all', {}],
    ])('one root, one finding: null mirror tier settled + %s → only tier_differs', async (_name, plans) => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR)), rows: [row({ bought_tier: null })], plans });
      const counts = await h.run();
      expect(kinds(h)).toEqual(['tier_differs']);
      expect(counts.mismatch).toBe(1);
    });

    it('inside 24 h the plan-row check still runs as before: plan row on another tier → only plan_tier_differs', async () => {
      const h = stepB({ subs: at(sec(NOW - 23 * HOUR)), rows: [row({ bought_tier: null })], plans: plan({ tier: 'tier_b' }) });
      await h.run();
      expect(kinds(h)).toEqual(['plan_tier_differs']);
    });

    it('a set mirror tier that differs is still flagged inside 24 h (the old rule is unchanged)', async () => {
      const h = stepB({ subs: at(sec(NOW - HOUR), ['price_two']), rows: [row({ bought_tier: 'tier_a' })], plans: plan({ tier: 'tier_b' }) });
      await h.run();
      expect(kinds(h)).toEqual(['tier_differs']);
    });

    it('the finding log line carries ids and the kind only, never a tier', async () => {
      const h = stepB({ subs: at(sec(NOW - 25 * HOUR)), rows: [row({ bought_tier: null })] });
      await h.run();
      const text = JSON.stringify(h.logs.named('bos_plan_reconcile_finding'));
      expect(text).not.toContain('tier_a');
      expect(h.table.calls).toEqual([]);
    });
  });

  it('a plan-price subscription no billing row holds is an orphan; an incomplete one is not', async () => {
    const h = stepB({ subs: [sub(), sub({ id: 'sub_2' }), sub({ id: 'sub_3', status: 'incomplete' })] });
    const counts = await h.run();
    expect(counts.orphan).toBe(1);
    const orphan = h.logs.named('bos_plan_reconcile_finding').find((line) => line.ctx.kind === 'orphan');
    expect(orphan?.ctx.stripeSubscriptionId).toBe('sub_2');
  });

  it('a list stopped at its page cap: no orphan and no not-listed finding (SA ruling 14), counted', async () => {
    const h = stepB({ subs: [sub({ id: 'sub_2' })], subscriptionsComplete: false });
    const counts = await h.run();
    expect(counts).toMatchObject({ orphan: 0, mismatch: 0, checkIncomplete: 1 });
  });

  it('an ended row is not compared', async () => {
    const h = stepB({ subs: [], rows: [row({ ended_at: new Date(NOW - DAY).toISOString(), subscription_status: 'canceled' })] });
    expect((await h.run()).mismatch).toBe(0);
  });

  it('plan prices switched off: Step B does nothing', async () => {
    const h = stepB({ prices: new Map() });
    const counts = await h.run();
    expect(counts).toMatchObject({ mismatch: 0, orphan: 0, checkIncomplete: 0 });
  });

  it('findings carry ids and the kind only: no money, no email, no name', async () => {
    const h = stepB({ subs: [sub({ status: 'past_due' }), sub({ id: 'sub_9' })] });
    await h.run();
    for (const line of h.logs.named('bos_plan_reconcile_finding')) {
      expect(Object.keys(line.ctx).sort()).toEqual(['alert', 'billingAccountId', 'event', 'kind', 'stripeSubscriptionId']);
      expect(line.level).toBe('error');
    }
  });
});

// ── Counts and the run record (SA ruling 10; SC-11) ──────────────────────────

describe('counts and the run record', () => {
  it('every count is a whole number, and every key survives the runner', async () => {
    const h = setup({ events: [ev('evt_z1', 'invoice.paid', 1)] });
    const result = await runReconcilePasses([h.pass], h.context);
    expect(result.passesFailed).toBe(0);
    expect(Object.keys(result.counts).sort()).toEqual(PLAN_RECONCILE_COUNT_KEYS.map((k) => `plan${k[0].toUpperCase()}${k.slice(1)}`).sort());
    for (const value of Object.values(result.counts)) expect(Number.isSafeInteger(value)).toBe(true);
  });

  it('the cron registry records exactly the pass counts (both ways), and colours the run per SA ruling 10', () => {
    const job = findBosCronJob('bos-billing-reconcile')!;
    const planKeys = job.counts.map((c) => c.key).filter((k) => k.startsWith('plan'));
    expect(planKeys.sort()).toEqual(PLAN_RECONCILE_COUNT_KEYS.map((k) => `plan${k[0].toUpperCase()}${k.slice(1)}`).sort());
    for (const count of job.counts.filter((c) => c.key.startsWith('plan'))) expect(count.path).toEqual(['data', count.key]);
    const amber = job.partlyDoneWhen.map((c) => c.key);
    for (const key of ['planIncomplete', 'planDeadlineHit', 'planReplayFailed', 'planWindowClipped']) expect(amber).toContain(key);
    // SA P-8b.2 fix 4: skipped API versions colour the run too.
    expect(job.partlyDoneWhen).toContainEqual({ kind: 'atLeast', key: 'planApiVersionSkipped', value: 1 });
    // The window's blocking counts are all recorded.
    for (const key of PLAN_WINDOW_BLOCKING_COUNTS) expect(job.counts.map((c) => c.key)).toContain(key);
  });

  it("the whole counts object fits the run record's 1,024-byte CHECK, even with every count at 5 digits", () => {
    const job = findBosCronJob('bos-billing-reconcile')!;
    // jsonb::text renders `{"key": value, ...}`.
    const text = `{${job.counts.map((c) => `"${c.key}": 99999`).join(', ')}}`;
    expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(1024);
  });
});
