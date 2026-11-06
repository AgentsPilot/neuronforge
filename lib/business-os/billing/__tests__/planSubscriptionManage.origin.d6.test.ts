/**
 * D6 / DL-1b: the cancel engine's `origin` (workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §6, T-13; SA W-1, W-6,
 * W-8). Fakes at every edge, as planSubscriptionManage.test.ts.
 *
 *   E-1  `deletion_request` never takes the immediate path (BQ-11): our row
 *        `failing`, or a fresh `past_due` / `unpaid`, refuses; `cancelNow` is
 *        never called
 *   W-1  `deletion_request` judges "already set to end" with
 *        `isSetToEndThisPeriod`: a `cancel_at` LATER than the period end is
 *        refused (`custom_end_date`), never `unchanged / cancelling`; the
 *        write's answer must pass the same test
 *   E-2  `owner` + reactivate refuses while a deletion request is open
 *        (`deletion_pending`), fails closed when that cannot be read, and makes
 *        no Stripe call either way; `deletion_keep` is never refused for it
 *   E-3  `origin` in the audit facts for a deletion origin; absent = owner
 */

import {
  PLAN_MANAGE_REFUSALS,
  managePlanSubscription,
  type PlanManageDeps,
  type PlanManageInput,
} from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const PERIOD_END = Math.floor(Date.parse('2026-11-26T10:00:00.000Z') / 1000);
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

type Row = Record<string, unknown>;

const row = (o: Row = {}): Row => ({
  id: '22222222-2222-4222-8222-222222222222',
  accountId: USER,
  livemode: false,
  stripeCustomerId: 'cus_own',
  stripeSubscriptionId: 'sub_own',
  subscriptionStatus: 'active',
  boughtTier: 'tier_one',
  currentPeriodEnd: PERIOD_END_ISO,
  cancelAtPeriodEnd: false,
  endedAt: null,
  failedAttempts: 0,
  ...o,
});

const fresh = (o: Row = {}): Row => ({
  id: 'sub_own',
  status: 'active',
  customerId: 'cus_own',
  billingCycleAnchor: PERIOD_END - 86400 * 30,
  cancelAtPeriodEnd: false,
  cancelAt: null,
  endedAt: null,
  livemode: false,
  metadata: {},
  priceIds: ['price_one'],
  items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
  pendingUpdate: null,
  latestInvoiceId: 'in_last',
  ...o,
});

const answer = (cancelling: boolean, o: Row = {}): Row => ({
  id: 'sub_own',
  status: 'active',
  customerId: 'cus_own',
  livemode: false,
  cancelAtPeriodEnd: cancelling,
  cancelAt: cancelling ? PERIOD_END : null,
  endedAt: null,
  currentPeriodEnd: PERIOD_END,
  ...o,
});

function harness(options: { row?: Row; fresh?: Row; write?: Row; deletion?: 'none' | 'open' | 'unreadable' | 'throws' } = {}) {
  const calls: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const log = (level: string) => (context: Record<string, unknown>) => {
    logs.push([level, context]);
  };
  const deletionPending = jest.fn(async () => {
    calls.push('closure:read');
    if (options.deletion === 'throws') throw new Error('down');
    return options.deletion ?? 'none';
  });
  const deps = {
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now: () => NOW,
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    newAttemptId: () => 'attempt-1',
    deletionPending,
    repo: {
      findByUser: async () => {
        calls.push('db:findByUser');
        return { data: options.row ?? row(), error: null };
      },
      mirrorSubscriptionState: async () => {
        calls.push('db:mirror');
        return { data: { mirrored: true }, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async (id: string) => {
        calls.push(`stripe:retrieve:${id}`);
        return options.fresh ?? fresh();
      },
      setBusinessOsCancelAtPeriodEnd: async (id: string, value: boolean) => {
        calls.push(`stripe:update:${id}:${value}`);
        return options.write ?? answer(value);
      },
      cancelBusinessOsSubscriptionNow: async (id: string) => {
        calls.push(`stripe:cancel_now:${id}`);
        return answer(false, { status: 'canceled', endedAt: Math.floor(NOW.getTime() / 1000) });
      },
      listBusinessOsOpenSubscriptionInvoices: async () => ({ invoices: [], hasMore: false }),
      voidBusinessOsInvoice: async () => ({ id: 'in', status: 'void' }),
    },
  } as unknown as PlanManageDeps;
  return { calls, logs, deps, deletionPending };
}

const run = (h: ReturnType<typeof harness>, input: Partial<PlanManageInput> = {}) =>
  managePlanSubscription({ action: 'cancel', userId: USER, accountId: USER, ...input }, h.deps);

describe('E-1: a deletion request never ends a plan now (BQ-11)', () => {
  it('our row failing → payment_failed_contact_us, no Stripe call at all', async () => {
    const h = harness({ row: row({ subscriptionStatus: 'past_due' }) });
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toEqual({ ok: false, code: 'payment_failed_contact_us' });
    expect(h.calls).toEqual(['db:findByUser']);
  });

  it.each(['past_due', 'unpaid'])('a fresh %s at Stripe → payment_failed_contact_us, cancelNow never called', async (status) => {
    const h = harness({ fresh: fresh({ status }) });
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toEqual({ ok: false, code: 'payment_failed_contact_us' });
    expect(h.calls).toEqual(['db:findByUser', 'stripe:retrieve:sub_own']);
    expect(h.calls.some((c) => c.startsWith('stripe:cancel_now'))).toBe(false);
  });

  it('the plain owner cancel keeps P-7a.4 unchanged: a fresh past_due ends the plan now', async () => {
    const h = harness({ fresh: fresh({ status: 'past_due' }) });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled', mode: 'immediate' });
    expect(h.calls).toContain('stripe:cancel_now:sub_own');
  });
});

describe('W-1: "set to end" means THIS period for a deletion request', () => {
  it('a `cancel_at` LATER than the period end → custom_end_date, no write (never unchanged / cancelling)', async () => {
    const h = harness({ fresh: fresh({ cancelAt: PERIOD_END + 86400 * 40 }) });
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toEqual({ ok: false, code: 'custom_end_date' });
    expect(h.calls).toEqual(['db:findByUser', 'stripe:retrieve:sub_own']);
    expect(PLAN_MANAGE_REFUSALS.custom_end_date.status).toBe(409);
  });

  it('the owner origin keeps hasCancelDate: the same later date answers unchanged / cancelling (SA Q-6 of C-3)', async () => {
    const h = harness({ fresh: fresh({ cancelAt: PERIOD_END + 86400 * 40 }) });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'unchanged', state: 'cancelling' });
  });

  it.each([
    ['the flag', { cancelAtPeriodEnd: true, cancelAt: PERIOD_END }],
    ['`cancel_at` at the period end', { cancelAt: PERIOD_END }],
    ['`cancel_at` before the period end', { cancelAt: PERIOD_END - 86400 * 3 }],
  ])('already set to end this period by %s → unchanged / cancelling, no write', async (_label, f) => {
    const h = harness({ fresh: fresh(f) });
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toMatchObject({ ok: true, outcome: 'unchanged', state: 'cancelling' });
    expect(h.calls.some((c) => c.startsWith('stripe:update'))).toBe(false);
  });

  it("the write's answer with a `cancel_at` past the period end and no flag → outcomeUnknown (answer_differs)", async () => {
    const h = harness({ write: answer(true, { cancelAtPeriodEnd: false, cancelAt: PERIOD_END + 86400 * 40 }) });
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toMatchObject({
      ok: false,
      code: 'stripe_error',
      outcomeUnknown: true,
      audit: { outcome: 'unknown', origin: 'deletion_request' },
    });
  });

  it('a renewing plan → one write, cancelled at the period end', async () => {
    const h = harness();
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'business_closing' })).toMatchObject({ ok: true, outcome: 'cancelled', endsOn: PERIOD_END_ISO });
    expect(h.calls).toContain('stripe:update:sub_own:true');
  });
});

describe('E-2: the plain Keep my plan is refused while a deletion request is open (XC-2)', () => {
  const cancelling = { row: row({ cancelAtPeriodEnd: true }), fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) };

  it('owner reactivate + open → deletion_pending, no Stripe call', async () => {
    const h = harness({ ...cancelling, deletion: 'open' });
    expect(await run(h, { action: 'reactivate' })).toEqual({ ok: false, code: 'deletion_pending' });
    expect(h.calls).toEqual(['db:findByUser', 'closure:read']);
    expect(h.deletionPending).toHaveBeenCalledWith(USER);
    expect(PLAN_MANAGE_REFUSALS.deletion_pending).toEqual({ status: 409, message: 'Your account is set to be deleted. Keep your account first.' });
  });

  it.each(['unreadable', 'throws'] as const)('owner reactivate + %s → billing_row_unreadable (fail closed), no Stripe call', async (deletion) => {
    const h = harness({ ...cancelling, deletion });
    expect(await run(h, { action: 'reactivate' })).toEqual({ ok: false, code: 'billing_row_unreadable' });
    expect(h.calls.some((c) => c.startsWith('stripe:'))).toBe(false);
  });

  it('owner reactivate + none → the write goes on as before', async () => {
    const h = harness({ ...cancelling });
    expect(await run(h, { action: 'reactivate' })).toMatchObject({ ok: true, outcome: 'reactivated' });
  });

  it('deletion_keep reactivate never reads the closure and is not refused', async () => {
    const h = harness({ ...cancelling, deletion: 'open' });
    expect(await run(h, { action: 'reactivate', origin: 'deletion_keep' })).toMatchObject({ ok: true, outcome: 'reactivated', audit: { origin: 'deletion_keep' } });
    expect(h.deletionPending).not.toHaveBeenCalled();
  });

  it('a cancel never reads the closure', async () => {
    const h = harness({ deletion: 'open' });
    await run(h, { origin: 'deletion_request', reasonCode: 'other' });
    await run(h);
    expect(h.deletionPending).not.toHaveBeenCalled();
  });
});

describe('E-3: origin in the audit facts', () => {
  it('a deletion origin is in the facts', async () => {
    const h = harness();
    expect(await run(h, { origin: 'deletion_request', reasonCode: 'other' })).toMatchObject({ audit: { origin: 'deletion_request', reasonCode: 'other' } });
  });

  it('absent (the plain routes) → no origin key: the plain audit rows are byte-identical (absent means owner)', async () => {
    const h = harness();
    const result = await run(h);
    expect(result.ok && result.outcome === 'cancelled' && 'origin' in result.audit).toBe(false);
    const explicit = await run(harness(), { origin: 'owner' });
    expect(explicit.ok && explicit.outcome === 'cancelled' && 'origin' in explicit.audit).toBe(false);
  });
});

describe('CR-4 (PLAN PAYMENTS ruling): a deletion origin goes with one action', () => {
  const refusedFirst = (h: ReturnType<typeof harness>) => {
    // Before any read, switch or Stripe call.
    expect(h.calls).toEqual([]);
    expect(h.deletionPending).not.toHaveBeenCalled();
    const line = h.logs.find(([, ctx]) => ctx.reason === 'origin_action_mismatch');
    expect(line).toBeDefined();
    expect(line![0]).toBe('error');
    expect(line![1]).toMatchObject({ code: 'manage_unavailable', alert: true });
  };

  it('deletion_request with reactivate → manage_unavailable, error + alert, nothing read', async () => {
    const h = harness();
    expect(await run(h, { action: 'reactivate', origin: 'deletion_request' })).toEqual({ ok: false, code: 'manage_unavailable' });
    refusedFirst(h);
  });

  it('deletion_keep with cancel → manage_unavailable, error + alert, nothing read', async () => {
    const h = harness();
    expect(await run(h, { action: 'cancel', origin: 'deletion_keep', reasonCode: 'other' })).toEqual({ ok: false, code: 'manage_unavailable' });
    refusedFirst(h);
  });

  it('the owner origin is not gated: both actions still run', async () => {
    expect(await run(harness(), { action: 'cancel', origin: 'owner' })).toMatchObject({ ok: true, outcome: 'cancelled' });
    const cancelling = { row: row({ cancelAtPeriodEnd: true }), fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) };
    expect(await run(harness(cancelling), { action: 'reactivate', origin: 'owner' })).toMatchObject({ ok: true, outcome: 'reactivated' });
  });
});
