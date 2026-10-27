/**
 * `managePlanSubscription` (plan payments P-7a.1; workplan §4.2; SA C-1 to C-5,
 * TQ-2 to TQ-5), with fakes at every edge.
 *
 * What matters:
 *   - THE ORDER (C-4): every our-data refusal (switch, key mode, billing read,
 *     planManageOffer) makes ZERO Stripe calls, pinned by one ordered call log;
 *   - the C-4 cross-checks: a different subscription, customer, mode or
 *     `bos_user_id` writes nothing and is alerted;
 *   - `unchanged` (C-2, C-3): already what was asked (the flag OR `cancel_at`)
 *     writes nothing at Stripe and audits nothing, and heals our row when it
 *     disagrees with Stripe;
 *   - TQ-5: a pending upgrade update is refused (X-3 showed Stripe would allow it);
 *   - the write's own answer is mirrored (no second retrieve), and a mirror
 *     failure never fails the request;
 *   - a lost answer is `outcomeUnknown` with audit facts; a refused-before-run
 *     error is not.
 */

import {
  managePlanSubscription,
  type PlanManageDeps,
  type PlanManageResult,
} from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const PERIOD_END = Math.floor(Date.parse('2026-11-26T10:00:00.000Z') / 1000);
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
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
    ...overrides,
  };
}

function fresh(overrides: Row = {}): Row {
  return {
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
    ...overrides,
  };
}

function afterWrite(cancelling: boolean, overrides: Row = {}): Row {
  return {
    id: 'sub_own',
    status: 'active',
    customerId: 'cus_own',
    livemode: false,
    cancelAtPeriodEnd: cancelling,
    cancelAt: cancelling ? PERIOD_END : null,
    endedAt: null,
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  };
}

interface Harness {
  calls: string[];
  logs: Array<[string, Record<string, unknown>]>;
  mirrors: Row[];
  deps: PlanManageDeps;
}

function harness(options: {
  row?: Row | null | 'error';
  fresh?: Row | Error;
  write?: Row | Error;
  mirror?: 'ok' | 'error' | 'not_mirrored' | 'throws';
  pricesEnabled?: boolean;
  mode?: 'test' | 'live' | 'unknown';
} = {}): Harness {
  const calls: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const mirrors: Row[] = [];
  const log = (level: string) => (context: Record<string, unknown>) => {
    logs.push([level, context]);
  };
  const deps = {
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now: () => NOW,
    switches: () => ({ pricesEnabled: options.pricesEnabled ?? true }),
    mode: () => {
      calls.push('mode');
      if (options.mode === 'unknown') throw new Error('stripe_key_mode_unknown');
      return options.mode ?? 'test';
    },
    repo: {
      findByUser: async (userId: string, livemode: boolean) => {
        calls.push(`db:findByUser:${userId}:${livemode}`);
        const r = options.row === undefined ? row() : options.row;
        if (r === 'error') return { data: null, error: new Error('down') };
        return { data: r, error: null };
      },
      mirrorSubscriptionState: async (input: Row) => {
        calls.push('db:mirror');
        mirrors.push(input);
        if (options.mirror === 'throws') throw new Error('boom');
        if (options.mirror === 'error') return { data: null, error: new Error('down') };
        return { data: { mirrored: options.mirror !== 'not_mirrored' }, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async (id: string) => {
        calls.push(`stripe:retrieve:${id}`);
        const f = options.fresh ?? fresh();
        if (f instanceof Error) throw f;
        return f;
      },
      setBusinessOsCancelAtPeriodEnd: async (id: string, value: boolean) => {
        calls.push(`stripe:update:${id}:${value}`);
        const w = options.write ?? afterWrite(value);
        if (w instanceof Error) throw w;
        return w;
      },
    },
  } as unknown as PlanManageDeps;
  return { calls, logs, mirrors, deps };
}

const run = (h: Harness, action: 'cancel' | 'reactivate' = 'cancel', accountId = USER): Promise<PlanManageResult> =>
  managePlanSubscription({ action, userId: USER, accountId }, h.deps);

const stripeCalls = (h: Harness) => h.calls.filter((call) => call.startsWith('stripe:'));
const stripeError = (type: string) => Object.assign(new Error('stripe'), { type });

describe('order contract (C-4): our-data refusals make zero Stripe calls', () => {
  it.each([
    ['switch off', { pricesEnabled: false }, 'manage_unavailable'],
    ['key mode unknown', { mode: 'unknown' as const }, 'manage_unavailable'],
    ['billing row unreadable', { row: 'error' as const }, 'billing_row_unreadable'],
    ['no billing row', { row: null }, 'not_subscribed'],
    ['no subscription id', { row: row({ stripeSubscriptionId: null }) }, 'not_subscribed'],
    ['ended on our record', { row: row({ endedAt: '2026-10-01T00:00:00.000Z' }) }, 'subscription_not_active'],
    ['canceled on our record', { row: row({ subscriptionStatus: 'canceled' }) }, 'subscription_not_active'],
    ['payment failed on our record', { row: row({ failedAttempts: 2 }) }, 'payment_failed_contact_us'],
    ['past_due on our record', { row: row({ subscriptionStatus: 'past_due' }) }, 'payment_failed_contact_us'],
    ['set to end, end passed', { row: row({ cancelAtPeriodEnd: true, currentPeriodEnd: '2026-10-01T00:00:00.000Z' }) }, 'subscription_not_active'],
  ])('%s → %s', async (_name, options, code) => {
    for (const action of ['cancel', 'reactivate'] as const) {
      const h = harness(options as Parameters<typeof harness>[0]);
      const result = await run(h, action);
      expect(result).toMatchObject({ ok: false, code });
      expect(stripeCalls(h)).toEqual([]);
      expect(h.mirrors).toEqual([]);
      expect('audit' in result && result.audit).toBeFalsy();
    }
  });

  it('the billing row is read by the SESSION user in the server key mode', async () => {
    const live = harness({ mode: 'live', row: row({ livemode: true }), fresh: fresh({ livemode: true }), write: afterWrite(true, { livemode: true }) });
    await run(live);
    expect(live.calls[1]).toBe(`db:findByUser:${USER}:true`);
  });
});

describe('C-4 cross-checks: nothing written, alerted', () => {
  it.each([
    ['another subscription', fresh({ id: 'sub_other' })],
    ['another customer', fresh({ customerId: 'cus_other' })],
    ['another mode', fresh({ livemode: true })],
    ['bos_user_id names another account', fresh({ metadata: { bos_user_id: '99999999-9999-4999-8999-999999999999' } })],
  ])('%s → billing_record_mismatch', async (_name, freshAnswer) => {
    const h = harness({ fresh: freshAnswer });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, code: 'billing_record_mismatch' });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
    expect(h.mirrors).toEqual([]);
    expect('audit' in result && result.audit).toBeFalsy();
    expect(h.logs.some(([level, ctx]) => level === 'error' && ctx.alert === true && ctx.code === 'billing_record_mismatch')).toBe(true);
  });

  it('our row in another mode than the key → mismatch', async () => {
    const h = harness({ mode: 'test', row: row({ livemode: true }), fresh: fresh({ livemode: true }) });
    expect(await run(h)).toMatchObject({ ok: false, code: 'billing_record_mismatch' });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
  });

  it('bos_user_id equal to the session account passes', async () => {
    const h = harness({ fresh: fresh({ metadata: { bos_user_id: USER } }) });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled' });
  });
});

describe('fresh Stripe status', () => {
  it('past_due at Stripe → payment_failed_contact_us, no write', async () => {
    const h = harness({ fresh: fresh({ status: 'past_due' }) });
    expect(await run(h)).toMatchObject({ ok: false, code: 'payment_failed_contact_us' });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
  });

  it('ended at Stripe → subscription_not_active, no write', async () => {
    const h = harness({ fresh: fresh({ status: 'canceled', endedAt: PERIOD_END - 10 }) });
    expect(await run(h)).toMatchObject({ ok: false, code: 'subscription_not_active' });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
  });

  it('the fresh read throwing → stripe_error, never outcomeUnknown (nothing was written)', async () => {
    const h = harness({ fresh: new Error('timeout') });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, code: 'stripe_error' });
    expect((result as { outcomeUnknown?: boolean }).outcomeUnknown).toBeUndefined();
  });
});

describe('unchanged (C-2, C-3): no write, no audit; heals our row', () => {
  it('cancel when Stripe already has the flag: unchanged, our stale row healed', async () => {
    const h = harness({ fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) });
    const result = await run(h, 'cancel');
    expect(result).toEqual({ ok: true, outcome: 'unchanged', state: 'cancelling', date: PERIOD_END_ISO });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
    expect(h.mirrors).toEqual([
      {
        userId: USER,
        livemode: false,
        stripeSubscriptionId: 'sub_own',
        status: 'active',
        cancelAtPeriodEnd: true,
        endedAtIso: null,
        nowIso: NOW.toISOString(),
      },
    ]);
  });

  it('C-3: a `cancel_at` set WITHOUT the flag counts as cancelling (unchanged on cancel)', async () => {
    const h = harness({ fresh: fresh({ cancelAtPeriodEnd: false, cancelAt: PERIOD_END }) });
    expect(await run(h, 'cancel')).toEqual({ ok: true, outcome: 'unchanged', state: 'cancelling', date: PERIOD_END_ISO });
    // Our row already says "not flagged", as Stripe does: nothing to heal.
    expect(h.mirrors).toEqual([]);
  });

  it('C-3: reactivate clears a `cancel_at` set without the flag (a write)', async () => {
    const h = harness({ row: row({ cancelAtPeriodEnd: true }), fresh: fresh({ cancelAtPeriodEnd: false, cancelAt: PERIOD_END }) });
    expect(await run(h, 'reactivate')).toMatchObject({ ok: true, outcome: 'reactivated' });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own', 'stripe:update:sub_own:false']);
  });

  it('reactivate when Stripe is not cancelling: unchanged, the stale row (says cancelling) healed', async () => {
    const h = harness({ row: row({ cancelAtPeriodEnd: true }) });
    const result = await run(h, 'reactivate');
    expect(result).toEqual({ ok: true, outcome: 'unchanged', state: 'renewing', date: PERIOD_END_ISO });
    expect(h.mirrors).toHaveLength(1);
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it('row and Stripe agree: unchanged with no mirror write', async () => {
    const h = harness({ row: row({ cancelAtPeriodEnd: true }), fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) });
    expect(await run(h, 'cancel')).toMatchObject({ ok: true, outcome: 'unchanged' });
    expect(h.mirrors).toEqual([]);
  });
});

describe('TQ-5: a pending upgrade update is refused', () => {
  it('upgrade_pending with retryAfter, no write', async () => {
    const h = harness({ fresh: fresh({ pendingUpdate: { expiresAt: PERIOD_END - 86400 * 20, priceIds: ['price_pro'] } }) });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, code: 'upgrade_pending', retryAfter: new Date((PERIOD_END - 86400 * 20) * 1000).toISOString() });
    expect(stripeCalls(h)).toEqual(['stripe:retrieve:sub_own']);
  });
});

describe('the write', () => {
  it('cancel: one update, the answer mirrored (no second retrieve), audit facts, endsOn', async () => {
    const h = harness();
    const result = await run(h, 'cancel');
    expect(result).toEqual({
      ok: true,
      outcome: 'cancelled',
      endsOn: PERIOD_END_ISO,
      audit: {
        action: 'cancel',
        outcome: 'cancelled',
        subscriptionId: 'sub_own',
        endsOn: PERIOD_END_ISO,
        renewsOn: null,
        livemode: false,
        mode: 'period_end',
        // D2 (SA Q-4): no reason given → null.
        reasonCode: null,
      },
    });
    expect(h.calls).toEqual(['mode', `db:findByUser:${USER}:false`, 'stripe:retrieve:sub_own', 'stripe:update:sub_own:true', 'db:mirror']);
    expect(h.mirrors[0]).toMatchObject({ userId: USER, livemode: false, stripeSubscriptionId: 'sub_own', status: 'active', cancelAtPeriodEnd: true });
  });

  it('reactivate: renewsOn from the answer', async () => {
    const h = harness({ row: row({ cancelAtPeriodEnd: true }), fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) });
    const result = await run(h, 'reactivate');
    expect(result).toMatchObject({ ok: true, outcome: 'reactivated', renewsOn: PERIOD_END_ISO, audit: { outcome: 'reactivated', renewsOn: PERIOD_END_ISO } });
    expect(h.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: false });
  });

  it.each(['error', 'not_mirrored', 'throws'] as const)('a mirror that answers %s never fails the request (warn)', async (mirror) => {
    const h = harness({ mirror });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled' });
    expect(h.logs.some(([level]) => level === 'warn')).toBe(true);
  });

  it('Stripe refused before running (invalid request) → stripe_error, NOT unknown, no audit', async () => {
    const h = harness({ write: stripeError('StripeInvalidRequestError') });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, code: 'stripe_error' });
    expect((result as { outcomeUnknown?: boolean }).outcomeUnknown).toBeUndefined();
    expect((result as { audit?: unknown }).audit).toBeUndefined();
    expect(h.mirrors).toEqual([]);
  });

  it('a lost answer (connection error) → outcomeUnknown with audit facts `unknown`', async () => {
    const h = harness({ write: stripeError('StripeConnectionError') });
    const result = await run(h);
    expect(result).toMatchObject({ ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { outcome: 'unknown', action: 'cancel' } });
    expect(h.mirrors).toEqual([]);
  });

  it('an answer for another subscription, or not in the asked state → outcomeUnknown, nothing mirrored', async () => {
    for (const write of [afterWrite(true, { id: 'sub_other' }), afterWrite(false), afterWrite(true, { customerId: 'cus_other' })]) {
      const h = harness({ write });
      expect(await run(h, 'cancel')).toMatchObject({ ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { outcome: 'unknown' } });
      expect(h.mirrors).toEqual([]);
    }
  });

  it('TQ-14: a trialing subscription can be cancelled', async () => {
    const h = harness({ row: row({ subscriptionStatus: 'trialing' }), fresh: fresh({ status: 'trialing' }), write: afterWrite(true, { status: 'trialing' }) });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled' });
  });
});
