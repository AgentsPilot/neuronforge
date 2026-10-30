/**
 * QA P-7a.1 (QA focus 2, 3, 4) on `managePlanSubscription` with a STATEFUL
 * Stripe fake (one subscription whose flag / `cancel_at` change with each
 * write) and a stateful row (the mirror writes it), so a sequence of presses
 * behaves as two tabs would.
 */

import { managePlanSubscription, type PlanManageDeps, type PlanManageResult } from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-26T10:00:00.000Z');
const PERIOD_END = Math.floor(Date.parse('2026-11-26T10:00:00.000Z') / 1000);
const iso = (u: number) => new Date(u * 1000).toISOString();

function world(initial: { flag?: boolean; cancelAt?: number | null; rowFlag?: boolean; rowStatus?: string; freshStatus?: string } = {}) {
  const sub = { flag: initial.flag ?? false, cancelAt: initial.cancelAt ?? (initial.flag ? PERIOD_END : null), status: initial.freshStatus ?? 'active' };
  const row: Record<string, unknown> = {
    id: 'row', accountId: USER, livemode: false, stripeCustomerId: 'cus_own', stripeSubscriptionId: 'sub_own',
    subscriptionStatus: initial.rowStatus ?? 'active', boughtTier: 't', currentPeriodEnd: iso(PERIOD_END),
    cancelAtPeriodEnd: initial.rowFlag ?? sub.flag, endedAt: null, failedAttempts: 0,
  };
  const calls: string[] = [];
  const mirrors: Array<Record<string, unknown>> = [];
  const deps = {
    logger: { info: () => undefined, warn: () => undefined, error: () => undefined },
    now: () => NOW,
    switches: () => ({ pricesEnabled: true }),
    mode: () => 'test',
    repo: {
      findByUser: async () => ({ data: { ...row }, error: null }),
      mirrorSubscriptionState: async (input: Record<string, unknown>) => {
        calls.push('db:mirror');
        mirrors.push(input);
        row.cancelAtPeriodEnd = input.cancelAtPeriodEnd;
        row.subscriptionStatus = input.status;
        return { data: { mirrored: true }, error: null };
      },
    },
    stripe: {
      retrieveBusinessOsSubscription: async () => {
        calls.push('stripe:retrieve');
        return {
          id: 'sub_own', status: sub.status, customerId: 'cus_own', billingCycleAnchor: PERIOD_END - 2592000,
          cancelAtPeriodEnd: sub.flag, cancelAt: sub.cancelAt, endedAt: null, livemode: false, metadata: { bos_user_id: USER },
          priceIds: ['p'], items: [{ id: 'si', priceId: 'p', currentPeriodStart: PERIOD_END - 2592000, currentPeriodEnd: PERIOD_END }],
          pendingUpdate: null, latestInvoiceId: null,
        };
      },
      setBusinessOsCancelAtPeriodEnd: async (_id: string, value: boolean) => {
        calls.push(`stripe:update:${value}`);
        sub.flag = value;
        sub.cancelAt = value ? PERIOD_END : null;
        return { id: 'sub_own', status: sub.status, customerId: 'cus_own', livemode: false, cancelAtPeriodEnd: sub.flag, cancelAt: sub.cancelAt, endedAt: null, currentPeriodEnd: PERIOD_END };
      },
    },
  } as unknown as PlanManageDeps;
  const run = (action: 'cancel' | 'reactivate'): Promise<PlanManageResult> => managePlanSubscription({ action, userId: USER, accountId: USER }, deps);
  return { sub, row, calls, mirrors, run };
}

const writes = (calls: string[]) => calls.filter((c) => c.startsWith('stripe:update')).length;

describe('QA focus 2: two tabs / double press', () => {
  it('cancel, then cancel again: one write, one mirror, audit facts only on the first; the second is unchanged with the date', async () => {
    const w = world();
    const first = await w.run('cancel');
    const second = await w.run('cancel');
    expect(first).toMatchObject({ ok: true, outcome: 'cancelled', endsOn: iso(PERIOD_END), audit: { outcome: 'cancelled' } });
    expect(second).toEqual({ ok: true, outcome: 'unchanged', state: 'cancelling', date: iso(PERIOD_END) });
    expect(writes(w.calls)).toBe(1);
    expect(w.mirrors).toHaveLength(1);
    expect(w.row.cancelAtPeriodEnd).toBe(true);
  });

  it('cancel → reactivate → cancel → reactivate: four writes, each audited once (no idempotency replay, TQ-3)', async () => {
    const w = world();
    const outcomes = [];
    for (const action of ['cancel', 'reactivate', 'cancel', 'reactivate'] as const) outcomes.push(await w.run(action));
    expect(outcomes.map((r) => (r.ok ? r.outcome : r.code))).toEqual(['cancelled', 'reactivated', 'cancelled', 'reactivated']);
    expect(w.calls.filter((c) => c.startsWith('stripe:update'))).toEqual(['stripe:update:true', 'stripe:update:false', 'stripe:update:true', 'stripe:update:false']);
    expect(w.sub).toMatchObject({ flag: false, cancelAt: null });
  });
});

describe('QA focus 3: stale-row heal', () => {
  it('row status differs (trialing on the row, active at Stripe), flags agree: unchanged, healed to active, no write', async () => {
    const w = world({ flag: true, rowFlag: true, rowStatus: 'trialing' });
    const r = await w.run('cancel');
    expect(r).toMatchObject({ ok: true, outcome: 'unchanged', state: 'cancelling' });
    expect(writes(w.calls)).toBe(0);
    expect(w.mirrors).toEqual([expect.objectContaining({ status: 'active', cancelAtPeriodEnd: true, userId: USER, stripeSubscriptionId: 'sub_own', livemode: false })]);
    expect('audit' in r).toBe(false);
  });

  it('after a heal, the next press of the other action writes normally', async () => {
    const w = world({ flag: false, rowFlag: true });
    expect(await w.run('reactivate')).toMatchObject({ outcome: 'unchanged', state: 'renewing' });
    expect(w.row.cancelAtPeriodEnd).toBe(false);
    expect(await w.run('cancel')).toMatchObject({ outcome: 'cancelled' });
    expect(writes(w.calls)).toBe(1);
  });
});

describe('QA focus 4: `cancel_at` alone (dashboard-style)', () => {
  const EARLIER = PERIOD_END - 86400 * 3;

  it('cancel → unchanged, the date is Stripe\'s `cancel_at` (not the period end), no Stripe write; our row healed to the derived true (follow-ups C-3)', async () => {
    const w = world({ flag: false, cancelAt: EARLIER });
    const r = await w.run('cancel');
    expect(r).toEqual({ ok: true, outcome: 'unchanged', state: 'cancelling', date: iso(EARLIER) });
    expect(writes(w.calls)).toBe(0);
    // Follow-ups C-3: an early `cancel_at` will not renew, so the stored flag is true.
    expect(w.mirrors).toHaveLength(1);
    expect(w.mirrors[0]).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it('reactivate (the route, the row says renewing) → one write of false, Stripe cleared', async () => {
    const w = world({ flag: false, cancelAt: EARLIER });
    const r = await w.run('reactivate');
    expect(r).toMatchObject({ ok: true, outcome: 'reactivated', renewsOn: iso(PERIOD_END) });
    expect(w.sub).toMatchObject({ flag: false, cancelAt: null });
  });
});
