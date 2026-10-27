/**
 * P-7a.4 — Cancel during a failed payment ends the plan now (plan payments
 * workplan docs/workplans/BUSINESS_OS_PLAN_PAYMENTS_P7A_WORKPLAN.md §4.3;
 * BQ-3 = A, user 2026-10-26; SA C-11, TQ-12; SA's P-7a.1 binding note).
 *
 * What matters:
 *   - STRIPE's fresh status picks the mode, never our row: a `failing` row that
 *     Stripe already cured gets the period-end write, never an immediate end;
 *     a row that still says renewing while Stripe says past_due ends now;
 *   - the immediate end is ONE `cancelBusinessOsSubscriptionNow` under a key
 *     fresh per attempt, then (C-11) every open invoice of THAT subscription is
 *     voided, each its own call under its own per-attempt key;
 *   - a void that cannot be done never fails the request (the plan HAS ended):
 *     it is counted as left open and alerted;
 *   - a lost answer on the end itself is `outcomeUnknown`, audited `unknown`
 *     with mode `immediate`; a refused-before-run error is not audited;
 *   - already ended at Stripe → `unchanged` / `ended`, healed, no write, no audit;
 *   - no key appears in any log line.
 */

import {
  managePlanSubscription,
  planCancelNowAttemptKey,
  planVoidInvoiceAttemptKey,
  type PlanManageDeps,
  type PlanManageResult,
} from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const NOW_UNIX = Math.floor(NOW.getTime() / 1000);
const PERIOD_END = Math.floor(Date.parse('2026-11-26T10:00:00.000Z') / 1000);
const ATTEMPT = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';

type Row = Record<string, unknown>;

function row(overrides: Row = {}): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'past_due',
    boughtTier: 'tier_one',
    // A failed renewal: the paid-through date has passed.
    currentPeriodEnd: '2026-10-20T10:00:00.000Z',
    cancelAtPeriodEnd: false,
    endedAt: null,
    failedAttempts: 1,
    ...overrides,
  };
}

function fresh(overrides: Row = {}): Row {
  return {
    id: 'sub_own',
    status: 'past_due',
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
    latestInvoiceId: 'in_open',
    ...overrides,
  };
}

function ended(overrides: Row = {}): Row {
  return {
    id: 'sub_own',
    status: 'canceled',
    customerId: 'cus_own',
    livemode: false,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    endedAt: NOW_UNIX,
    currentPeriodEnd: PERIOD_END,
    ...overrides,
  };
}

function openInvoice(id: string, overrides: Row = {}): Row {
  return { id, status: 'open', customerId: 'cus_own', subscriptionId: 'sub_own', livemode: false, ...overrides };
}

interface Harness {
  calls: string[];
  logs: Array<[string, Record<string, unknown>]>;
  mirrors: Row[];
  keys: string[];
  deps: PlanManageDeps;
}

function harness(options: {
  row?: Row;
  fresh?: Row | Error;
  cancelNow?: Row | Error;
  list?: { invoices: Row[]; hasMore: boolean } | Error;
  voids?: Record<string, Row | Error>;
  mirror?: 'ok' | 'error';
} = {}): Harness {
  const calls: string[] = [];
  const logs: Array<[string, Record<string, unknown>]> = [];
  const mirrors: Row[] = [];
  const keys: string[] = [];
  const log = (level: string) => (context: Record<string, unknown>, message: string) => {
    logs.push([level, { ...context, message }]);
  };
  const deps = {
    logger: { info: log('info'), warn: log('warn'), error: log('error') },
    now: () => NOW,
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    newAttemptId: () => ATTEMPT,
    repo: {
      findByUser: async () => ({ data: options.row ?? row(), error: null }),
      mirrorSubscriptionState: async (input: Row) => {
        calls.push(`db:mirror:${String(input.status)}`);
        mirrors.push(input);
        if (options.mirror === 'error') return { data: null, error: new Error('down') };
        return { data: { mirrored: true }, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async (id: string) => {
        calls.push(`stripe:retrieve:${id}`);
        const f = options.fresh ?? fresh();
        if (f instanceof Error) throw f;
        return f;
      },
      setBusinessOsCancelAtPeriodEnd: async (id: string, value: boolean, opts?: { idempotencyKey?: string }) => {
        calls.push(`stripe:update:${id}:${value}`);
        if (opts?.idempotencyKey) keys.push(opts.idempotencyKey);
        return { id: 'sub_own', status: 'active', customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: value, cancelAt: value ? PERIOD_END : null, endedAt: null, currentPeriodEnd: PERIOD_END };
      },
      cancelBusinessOsSubscriptionNow: async (id: string, opts: { idempotencyKey: string }) => {
        calls.push(`stripe:cancel_now:${id}`);
        keys.push(opts.idempotencyKey);
        const answer = options.cancelNow ?? ended();
        if (answer instanceof Error) throw answer;
        return answer;
      },
      listBusinessOsOpenSubscriptionInvoices: async (id: string) => {
        calls.push(`stripe:list_open:${id}`);
        const listed = options.list ?? { invoices: [openInvoice('in_open')], hasMore: false };
        if (listed instanceof Error) throw listed;
        return listed;
      },
      voidBusinessOsInvoice: async (id: string, opts: { idempotencyKey: string }) => {
        calls.push(`stripe:void:${id}`);
        keys.push(opts.idempotencyKey);
        const answer = options.voids?.[id] ?? { id, status: 'void' };
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  } as unknown as PlanManageDeps;
  return { calls, logs, mirrors, keys, deps };
}

const run = (h: Harness, action: 'cancel' | 'reactivate' = 'cancel'): Promise<PlanManageResult> =>
  managePlanSubscription({ action, userId: USER, accountId: USER, reasonCode: action === 'cancel' ? 'too_expensive' : null }, h.deps);
const stripeError = (type: string) => Object.assign(new Error('stripe'), { type });
const alerts = (h: Harness) => h.logs.filter(([level, ctx]) => level === 'error' && ctx.alert === true);

describe('P-7a.4: the mode comes from Stripe\'s fresh status', () => {
  it.each(['past_due', 'unpaid'])('%s at Stripe → ends NOW: cancel, then void, then mirror', async (status) => {
    const h = harness({ fresh: fresh({ status }) });
    const result = await run(h);

    expect(h.calls).toEqual(['stripe:retrieve:sub_own', 'stripe:cancel_now:sub_own', 'stripe:list_open:sub_own', 'stripe:void:in_open', 'db:mirror:canceled']);
    const endsOn = new Date(NOW_UNIX * 1000).toISOString();
    expect(result).toEqual({
      ok: true,
      outcome: 'cancelled',
      endsOn,
      mode: 'immediate',
      audit: {
        action: 'cancel',
        outcome: 'cancelled',
        subscriptionId: 'sub_own',
        endsOn,
        renewsOn: null,
        livemode: false,
        mode: 'immediate',
        reasonCode: 'too_expensive',
        invoicesVoided: 1,
        invoicesLeftOpen: 0,
      },
    });
    expect(h.mirrors[0]).toMatchObject({ userId: USER, livemode: false, stripeSubscriptionId: 'sub_own', status: 'canceled', cancelAtPeriodEnd: false, endedAtIso: endsOn });
    expect(alerts(h)).toEqual([]);
  });

  it('SA binding note: a FAILING row that Stripe already cured (active) → the period-end write, never an immediate end', async () => {
    const h = harness({ row: row({ subscriptionStatus: 'past_due', failedAttempts: 2 }), fresh: fresh({ status: 'active' }) });
    const result = await run(h);
    expect(h.calls.filter((c) => c.startsWith('stripe:'))).toEqual(['stripe:retrieve:sub_own', 'stripe:update:sub_own:true']);
    expect(result).toMatchObject({ ok: true, outcome: 'cancelled', audit: { mode: 'period_end' } });
    expect('mode' in result && result.mode).toBeFalsy();
  });

  it('a row that still says renewing while Stripe says past_due → ends now (Stripe decides)', async () => {
    const h = harness({ row: row({ subscriptionStatus: 'active', failedAttempts: 0, currentPeriodEnd: '2026-11-26T10:00:00.000Z' }) });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled', mode: 'immediate' });
    expect(h.calls).toContain('stripe:cancel_now:sub_own');
  });

  it('already ended at Stripe (a second tab) → unchanged / ended, healed, no write, no audit', async () => {
    const h = harness({ fresh: fresh({ status: 'canceled', endedAt: NOW_UNIX - 60 }) });
    const result = await run(h);
    expect(result).toEqual({ ok: true, outcome: 'unchanged', state: 'ended', date: new Date((NOW_UNIX - 60) * 1000).toISOString() });
    expect(h.calls).toEqual(['stripe:retrieve:sub_own', 'db:mirror:canceled']);
  });

  it('reactivate during a failed payment at Stripe is refused, nothing written', async () => {
    const h = harness({ row: row({ subscriptionStatus: 'active', failedAttempts: 0, cancelAtPeriodEnd: true, currentPeriodEnd: '2026-11-26T10:00:00.000Z' }), fresh: fresh({ cancelAtPeriodEnd: true, cancelAt: PERIOD_END }) });
    expect(await run(h, 'reactivate')).toMatchObject({ ok: false, code: 'payment_failed_contact_us' });
    expect(h.calls).toEqual(['stripe:retrieve:sub_own']);
  });

  it('TQ-5 holds on the immediate path: a pending upgrade update → upgrade_pending, no write', async () => {
    const h = harness({ fresh: fresh({ pendingUpdate: { expiresAt: PERIOD_END, priceIds: ['price_two'] } }) });
    expect(await run(h)).toMatchObject({ ok: false, code: 'upgrade_pending' });
    expect(h.calls).toEqual(['stripe:retrieve:sub_own']);
  });
});

describe('P-7a.4: idempotency keys (D2 pattern) are per attempt and never logged', () => {
  it('the end and each void carry their own key built from the attempt id', async () => {
    const h = harness({ list: { invoices: [openInvoice('in_a'), openInvoice('in_b')], hasMore: false } });
    expect(await run(h)).toMatchObject({ ok: true, audit: { invoicesVoided: 2, invoicesLeftOpen: 0 } });
    expect(h.keys).toEqual([
      planCancelNowAttemptKey('sub_own', ATTEMPT),
      planVoidInvoiceAttemptKey('in_a', ATTEMPT),
      planVoidInvoiceAttemptKey('in_b', ATTEMPT),
    ]);
    expect(h.keys[0]).toBe(`bos-plan-manage:sub_own:cancel_now:${ATTEMPT}`);
    const logged = JSON.stringify(h.logs);
    for (const key of h.keys) expect(logged).not.toContain(key);
    expect(logged).not.toContain(ATTEMPT);
  });
});

describe('P-7a.4: C-11, a void that cannot be done never un-ends the plan', () => {
  it('an invoice of another customer, subscription or mode is NOT voided: left open, alerted', async () => {
    const h = harness({
      list: {
        invoices: [
          openInvoice('in_cust', { customerId: 'cus_other' }),
          openInvoice('in_sub', { subscriptionId: 'sub_other' }),
          openInvoice('in_mode', { livemode: true }),
          openInvoice('in_ok'),
        ],
        hasMore: false,
      },
    });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled', audit: { invoicesVoided: 1, invoicesLeftOpen: 3 } });
    expect(h.calls.filter((c) => c.startsWith('stripe:void'))).toEqual(['stripe:void:in_ok']);
    expect(alerts(h)).toHaveLength(3);
  });

  it('a void that throws, or answers not void → left open, alerted; the request still succeeds', async () => {
    const h = harness({
      list: { invoices: [openInvoice('in_throw'), openInvoice('in_odd')], hasMore: false },
      voids: { in_throw: stripeError('StripeConnectionError'), in_odd: { id: 'in_odd', status: 'open' } },
    });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled', mode: 'immediate', audit: { invoicesVoided: 0, invoicesLeftOpen: 2 } });
    expect(alerts(h).map(([, ctx]) => ctx.invoiceId)).toEqual(['in_throw', 'in_odd']);
    expect(h.calls).toContain('db:mirror:canceled');
  });

  it('the open-invoice list fails → leftOpen null (could not tell), alerted, still ended', async () => {
    const h = harness({ list: stripeError('StripeAPIError') });
    expect(await run(h)).toMatchObject({ ok: true, audit: { invoicesVoided: 0, invoicesLeftOpen: null } });
    expect(alerts(h)).toHaveLength(1);
  });

  it('more than one page → leftOpen null, alerted (never guessed)', async () => {
    const h = harness({ list: { invoices: [openInvoice('in_a')], hasMore: true } });
    expect(await run(h)).toMatchObject({ ok: true, audit: { invoicesVoided: 1, invoicesLeftOpen: null } });
    expect(alerts(h).some(([, ctx]) => ctx.reason === 'more_than_one_page')).toBe(true);
  });

  it('nothing open → nothing voided, nothing alerted', async () => {
    const h = harness({ list: { invoices: [], hasMore: false } });
    expect(await run(h)).toMatchObject({ ok: true, audit: { invoicesVoided: 0, invoicesLeftOpen: 0 } });
    expect(alerts(h)).toEqual([]);
  });

  it('a mirror failure never fails the request (the webhook converges)', async () => {
    const h = harness({ mirror: 'error' });
    expect(await run(h)).toMatchObject({ ok: true, outcome: 'cancelled', mode: 'immediate' });
  });
});

describe('P-7a.4: the end itself fails', () => {
  it.each(['StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError', 'StripeRateLimitError'])(
    '%s (refused before running) → stripe_error, not audited, no sweep',
    async (type) => {
      const h = harness({ cancelNow: stripeError(type) });
      const result = await run(h);
      expect(result).toMatchObject({ ok: false, code: 'stripe_error' });
      expect('audit' in result && result.audit).toBeFalsy();
      expect(h.calls).toEqual(['stripe:retrieve:sub_own', 'stripe:cancel_now:sub_own']);
    }
  );

  it('a lost answer → outcomeUnknown, audited `unknown` with mode immediate, no sweep', async () => {
    const h = harness({ cancelNow: stripeError('StripeConnectionError') });
    const result = await run(h);
    expect(result).toMatchObject({
      ok: false,
      code: 'stripe_error',
      outcomeUnknown: true,
      audit: { outcome: 'unknown', mode: 'immediate', endsOn: null, invoicesVoided: 0, invoicesLeftOpen: null, reasonCode: 'too_expensive' },
    });
    expect(h.calls).toEqual(['stripe:retrieve:sub_own', 'stripe:cancel_now:sub_own']);
  });

  it.each([
    ['still past_due', ended({ status: 'past_due', endedAt: null })],
    ['another subscription', ended({ id: 'sub_other' })],
    ['another customer', ended({ customerId: 'cus_other' })],
    ['another mode', ended({ livemode: true })],
  ])('an answer that is not OUR ended subscription (%s) → outcomeUnknown, no sweep, no mirror', async (_name, answer) => {
    const h = harness({ cancelNow: answer });
    expect(await run(h)).toMatchObject({ ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { outcome: 'unknown', mode: 'immediate' } });
    expect(h.calls).toEqual(['stripe:retrieve:sub_own', 'stripe:cancel_now:sub_own']);
  });
});
