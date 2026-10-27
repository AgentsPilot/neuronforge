/**
 * D2 / SX-1: the plan cancel / keep engine's additions over P-7a.1 (workplan
 * docs/workplans/BUSINESS_OS_D2_PLAN_CANCEL_ENGINE_WORKPLAN.md §6; SA W-3,
 * W-4, W-6, W-10).
 *
 * What matters:
 *   - SX C-4 / Q-3: a FRESH idempotency key per attempt. cancel → keep → cancel
 *     within 24 h makes three real writes under three different keys (no stale
 *     replay, P-7a TQ-3's concern), each of the stated shape, and the key never
 *     reaches a log line;
 *   - W-3: `change_pending` refuses a cancel on our data with zero Stripe calls
 *     and no audit facts; a Keep is never refused for it;
 *   - SA-4 / Q-4: the cancel's reason code is in the audit facts (null when
 *     absent), never on reactivate;
 *   - SA-6 pin: while cancelling, neither an upgrade nor a purchase is offered;
 *     after Keep the upgrade is offered again.
 *
 * A stateful fake Stripe: the write flips its state, the mirror writes our row,
 * and the next attempt reads both. All in-memory, no network.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));

import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
import { planPurchaseOffer, planUpgradeOffer } from '@/lib/business-os/billing/planCheckoutEligibility';
import { isLiveSubscriptionStatus } from '@/lib/business-os/billing/planCheckout';
import {
  managePlanSubscription,
  planManageAttemptKey,
  type PlanManageDeps,
  type PlanManageResult,
} from '@/lib/business-os/billing/planSubscriptionManage';

const USER = '11111111-1111-4111-8111-111111111111';
const T0 = Date.parse('2026-10-26T10:00:00.000Z');
const PERIOD_END_ISO = '2026-11-26T10:00:00.000Z';
const PERIOD_END = Math.floor(Date.parse(PERIOD_END_ISO) / 1000);
const KEY_SHAPE = /^bos-plan-manage:sub_[A-Za-z0-9]+:(cancel|reactivate):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LOWEST = TIER_ORDER[0];

type Row = Record<string, unknown>;

function baseRow(overrides: Row = {}): Row {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    accountId: USER,
    livemode: false,
    stripeCustomerId: 'cus_own',
    stripeSubscriptionId: 'sub_own',
    subscriptionStatus: 'active',
    boughtTier: LOWEST,
    currentPeriodEnd: PERIOD_END_ISO,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: null,
    openCheckoutExpiresAt: null,
    endedAt: null,
    failedAttempts: 0,
    ...overrides,
  };
}

/** Stripe and our row, kept in step by the engine's own write and mirror. */
function world(initial: Row = {}) {
  const state = { row: baseRow(initial), stripeCancelling: Boolean(initial.cancelAtPeriodEnd), clock: T0 };
  const keys: string[] = [];
  const stripeCalls: string[] = [];
  const logs: unknown[] = [];
  const log = (level: string) => (context: Record<string, unknown>, message: string) => {
    logs.push([level, context, message]);
  };
  const deps = (): PlanManageDeps =>
    ({
      logger: { info: log('info'), warn: log('warn'), error: log('error') },
      now: () => new Date(state.clock),
      switches: () => ({ pricesEnabled: true }),
      mode: () => 'test',
      repo: {
        findByUser: async () => ({ data: { ...state.row }, error: null }),
        mirrorSubscriptionState: async (input: { cancelAtPeriodEnd: boolean; status: string }) => {
          state.row = { ...state.row, cancelAtPeriodEnd: input.cancelAtPeriodEnd, subscriptionStatus: input.status };
          return { data: { mirrored: true }, error: null };
        },
      },
      stripe: {
        retrieveBusinessOsSubscription: async (id: string) => {
          stripeCalls.push(`retrieve:${id}`);
          return {
            id: 'sub_own',
            status: 'active',
            customerId: 'cus_own',
            billingCycleAnchor: PERIOD_END - 86400 * 30,
            cancelAtPeriodEnd: state.stripeCancelling,
            cancelAt: state.stripeCancelling ? PERIOD_END : null,
            endedAt: null,
            livemode: false,
            metadata: {},
            priceIds: ['price_one'],
            items: [{ id: 'si_1', priceId: 'price_one', currentPeriodStart: PERIOD_END - 86400 * 30, currentPeriodEnd: PERIOD_END }],
            pendingUpdate: null,
            latestInvoiceId: 'in_last',
          };
        },
        setBusinessOsCancelAtPeriodEnd: async (id: string, value: boolean, options?: { idempotencyKey?: string }) => {
          stripeCalls.push(`update:${id}:${value}`);
          keys.push(options?.idempotencyKey ?? '<none>');
          state.stripeCancelling = value;
          return {
            id: 'sub_own',
            status: 'active',
            customerId: 'cus_own',
            livemode: false,
            cancelAtPeriodEnd: value,
            cancelAt: value ? PERIOD_END : null,
            endedAt: null,
            currentPeriodEnd: PERIOD_END,
          };
        },
      },
    }) as unknown as PlanManageDeps;
  return { state, keys, stripeCalls, logs, deps };
}

const run = (w: ReturnType<typeof world>, action: 'cancel' | 'reactivate', reasonCode?: 'too_expensive' | null): Promise<PlanManageResult> =>
  managePlanSubscription({ action, userId: USER, accountId: USER, ...(reasonCode !== undefined ? { reasonCode } : {}) }, w.deps());

describe('SX C-4: a fresh idempotency key per attempt', () => {
  it('cancel → keep → cancel within 24 h: three writes, three different keys, no stale replay', async () => {
    const w = world();
    const first = await run(w, 'cancel');
    w.state.clock = T0 + 3600_000;
    const second = await run(w, 'reactivate');
    w.state.clock = T0 + 2 * 3600_000;
    const third = await run(w, 'cancel');

    expect([first, second, third].map((r) => (r.ok ? r.outcome : r.code))).toEqual(['cancelled', 'reactivated', 'cancelled']);
    expect(w.stripeCalls.filter((c) => c.startsWith('update:'))).toEqual(['update:sub_own:true', 'update:sub_own:false', 'update:sub_own:true']);
    expect(w.keys).toHaveLength(3);
    expect(new Set(w.keys).size).toBe(3);
    for (const key of w.keys) expect(key).toMatch(KEY_SHAPE);
    expect(w.keys[0]).toMatch(/:cancel:/);
    expect(w.keys[1]).toMatch(/:reactivate:/);
    // The third answer is Stripe's live state, not a replay of the first: our row says cancelling.
    expect(w.state.row.cancelAtPeriodEnd).toBe(true);
  });

  it('a double press: one write, the second is unchanged and consumes no key', async () => {
    const w = world();
    await run(w, 'cancel');
    const again = await run(w, 'cancel');
    expect(again).toMatchObject({ ok: true, outcome: 'unchanged', state: 'cancelling' });
    expect(w.keys).toHaveLength(1);
  });

  it('the key never appears in a log line', async () => {
    const w = world();
    await run(w, 'cancel');
    await run(w, 'reactivate');
    const logged = JSON.stringify(w.logs);
    for (const key of w.keys) {
      expect(logged).not.toContain(key);
      expect(logged).not.toContain(key.split(':').pop() as string);
    }
  });

  it('the injected attempt id is used once, in the one write', async () => {
    const w = world();
    const ids = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'];
    let calls = 0;
    await managePlanSubscription({ action: 'cancel', userId: USER, accountId: USER }, { ...w.deps(), newAttemptId: () => ids[calls++] });
    expect(calls).toBe(1);
    expect(w.keys).toEqual([planManageAttemptKey('sub_own', 'cancel', ids[0])]);
  });

  it('planManageAttemptKey: the stated shape', () => {
    expect(planManageAttemptKey('sub_X1', 'reactivate', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')).toBe(
      'bos-plan-manage:sub_X1:reactivate:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    );
  });
});

describe('SA W-3: change_pending refuses a cancel only', () => {
  it.each([
    ['pending_tier', { pendingTier: TIER_ORDER[TIER_ORDER.length - 1] }],
    ['an open checkout', { openCheckoutSessionId: 'cs_open', openCheckoutExpiresAt: '2026-10-26T11:00:00.000Z' }],
  ])('%s: cancel → 409 change_pending, zero Stripe calls, no audit facts', async (_name, overrides) => {
    const w = world(overrides);
    const result = await run(w, 'cancel', 'too_expensive');
    expect(result).toEqual({ ok: false, code: 'change_pending' });
    expect(w.stripeCalls).toEqual([]);
    expect(w.logs).toContainEqual(['warn', expect.objectContaining({ event: 'bos_billing_manage_refused', code: 'change_pending' }), expect.any(String)]);
  });

  it('an expired checkout lock does not block a cancel', async () => {
    const w = world({ openCheckoutSessionId: 'cs_old', openCheckoutExpiresAt: '2026-10-25T10:00:00.000Z' });
    expect(await run(w, 'cancel')).toMatchObject({ ok: true, outcome: 'cancelled' });
  });

  it('Keep is never refused for it: a cancelling plan with pending_tier is kept', async () => {
    const w = world({ cancelAtPeriodEnd: true, pendingTier: TIER_ORDER[TIER_ORDER.length - 1] });
    expect(await run(w, 'reactivate')).toMatchObject({ ok: true, outcome: 'reactivated' });
  });

  it('Keep on a (possibly stale) renewing row with a change pending still reaches Stripe', async () => {
    const w = world({ pendingTier: TIER_ORDER[TIER_ORDER.length - 1] });
    // Our row says renewing, Stripe says cancelling (stale row, P-7a C-2): the press repairs it.
    w.state.stripeCancelling = true;
    expect(await run(w, 'reactivate')).toMatchObject({ ok: true, outcome: 'reactivated' });
  });
});

describe('SA-4 / Q-4: the reason code in the audit facts', () => {
  it('cancel with a reason → audit reasonCode', async () => {
    const w = world();
    const result = await run(w, 'cancel', 'too_expensive');
    expect(result).toMatchObject({ ok: true, outcome: 'cancelled', audit: { reasonCode: 'too_expensive' } });
  });

  it('cancel without a reason → null', async () => {
    const w = world();
    expect(await run(w, 'cancel')).toMatchObject({ audit: { reasonCode: null } });
  });

  it('reactivate never carries a reason, even if one is passed', async () => {
    const w = world({ cancelAtPeriodEnd: true });
    expect(await run(w, 'reactivate', 'too_expensive')).toMatchObject({ ok: true, outcome: 'reactivated', audit: { reasonCode: null } });
  });

  it('a lost answer (outcome unknown) still carries the reason', async () => {
    const w = world();
    const deps = w.deps();
    (deps.stripe as { setBusinessOsCancelAtPeriodEnd: unknown }).setBusinessOsCancelAtPeriodEnd = async () => {
      throw Object.assign(new Error('socket hang up'), { type: 'StripeConnectionError' });
    };
    const result = await managePlanSubscription({ action: 'cancel', userId: USER, accountId: USER, reasonCode: 'too_expensive' }, deps);
    expect(result).toMatchObject({ ok: false, code: 'stripe_error', outcomeUnknown: true, audit: { outcome: 'unknown', reasonCode: 'too_expensive' } });
  });
});

describe('SA-6 pin: no second sale while cancelling; Keep restores', () => {
  const switches = { checkoutEnabled: true, pricesEnabled: true };
  const upgradeFacts = (r: Row) => ({
    boughtTier: r.boughtTier as string,
    subscriptionId: r.stripeSubscriptionId as string,
    subscriptionStatus: r.subscriptionStatus as string,
    cancelAtPeriodEnd: r.cancelAtPeriodEnd as boolean,
    endedAt: r.endedAt as string | null,
  });

  it('cancel → upgrade and purchase refused; keep → upgrade offered again', async () => {
    if (TIER_ORDER.length < 2) throw new Error('needs a tier above the lowest');
    const w = world();
    expect(planUpgradeOffer(upgradeFacts(w.state.row), switches, TIER_ORDER).kind).toBe('upgrade');

    await run(w, 'cancel');
    expect(planUpgradeOffer(upgradeFacts(w.state.row), switches, TIER_ORDER)).toEqual({ kind: 'none', reason: 'cancelling' });
    expect(
      planPurchaseOffer({ openEndedFreeAccess: false, subscriptionLive: isLiveSubscriptionStatus(w.state.row.subscriptionStatus as 'active') }, switches, TIER_ORDER)
    ).toEqual({ kind: 'none', reason: 'paying' });

    await run(w, 'reactivate');
    expect(planUpgradeOffer(upgradeFacts(w.state.row), switches, TIER_ORDER).kind).toBe('upgrade');
  });
});
