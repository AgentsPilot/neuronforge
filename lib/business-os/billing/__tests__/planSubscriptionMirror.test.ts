/**
 * The plan subscription mirror (plan payments P-3b.2, workplan §3.5; SA Q-1):
 * status-only, read FRESH from Stripe, compare-and-set on the row holding the
 * subscription. A deleted subscription sets `ended_at`, which is what turns
 * `isPlanSubscriptionLive` false (so deletion and re-buy are possible again).
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import { mirrorPlanSubscription, type PlanSubscriptionMirrorDeps } from '@/lib/business-os/billing/planSubscriptionMirror';
import { isPlanSubscriptionLive } from '@/lib/business-os/purge/adminDeletionRefusals';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { Logger } from '@/lib/logger';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const SUB = 'sub_P1';
const NOW = new Date('2026-10-07T12:00:00.000Z');

function event(name: string): Stripe.Event {
  const e = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event;
  (e.data.object as Stripe.Subscription).id = SUB;
  return e;
}

function row(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: 'cus_probe_1',
    stripeSubscriptionId: SUB,
    subscriptionStatus: 'active',
    boughtTier: 'tier_one',
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
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

function setup(initial: BusinessOsBillingAccount | null = row(), fresh: Record<string, unknown> = {}) {
  const state = { row: initial };
  const stripeState = {
    sub: { id: SUB, status: 'active', customerId: 'cus_probe_1', billingCycleAnchor: 1, cancelAtPeriodEnd: false, endedAt: null as number | null, livemode: false, metadata: {}, priceIds: [], ...fresh },
  };
  const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    lines.push({ level, ctx });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error') } as unknown as Logger;
  const retrieve = jest.fn(async () => stripeState.sub);
  const deps: PlanSubscriptionMirrorDeps = {
    now: () => NOW,
    stripe: () => ({ retrieveBusinessOsSubscription: retrieve }) as unknown as ReturnType<PlanSubscriptionMirrorDeps['stripe']>,
    billingAccounts: {
      findByStripeSubscription: jest.fn(async (id: string, livemode: boolean) => ({
        data: state.row && state.row.stripeSubscriptionId === id && state.row.livemode === livemode ? state.row : null,
        error: null,
      })),
      mirrorSubscriptionState: jest.fn(
        async (input: { userId: string; livemode: boolean; stripeSubscriptionId: string; status: string; cancelAtPeriodEnd: boolean; endedAtIso: string | null; nowIso: string }) => {
          const r = state.row;
          if (!r || r.accountId !== input.userId || r.livemode !== input.livemode || r.stripeSubscriptionId !== input.stripeSubscriptionId) {
            return { data: { mirrored: false }, error: null };
          }
          state.row = {
            ...r,
            subscriptionStatus: input.status as BusinessOsBillingAccount['subscriptionStatus'],
            cancelAtPeriodEnd: input.cancelAtPeriodEnd,
            endedAt: input.endedAtIso,
            updatedAt: input.nowIso,
          };
          return { data: { mirrored: true }, error: null };
        }
      ),
    } as unknown as PlanSubscriptionMirrorDeps['billingAccounts'],
  };
  const logged = (name: string) => lines.filter((l) => l.ctx.event === name);
  return { state, stripeState, deps, log, logged, retrieve };
}

describe('customer.subscription.updated / .deleted: status-only mirror', () => {
  it('updated: reads the subscription fresh and writes exactly status, cancel flag and ended_at', async () => {
    const h = setup(row(), { cancelAtPeriodEnd: true });
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.retrieve).toHaveBeenCalledWith(SUB);
    expect(h.state.row).toEqual(row({ cancelAtPeriodEnd: true, updatedAt: NOW.toISOString() }));
    expect(h.logged('bos_billing_subscription_mirrored')).toHaveLength(1);
  });

  it('deleted: ended_at from Stripe, status canceled, so isPlanSubscriptionLive turns false', async () => {
    const endedAt = 1_790_600_000;
    const h = setup(row(), { status: 'canceled', endedAt });
    expect(isPlanSubscriptionLive({ status: h.state.row!.subscriptionStatus, stripeSubscriptionId: SUB, endedAt: null })).toBe(true);
    await mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.state.row).toMatchObject({ subscriptionStatus: 'canceled', endedAt: new Date(endedAt * 1000).toISOString() });
    expect(
      isPlanSubscriptionLive({ status: h.state.row!.subscriptionStatus, stripeSubscriptionId: SUB, endedAt: h.state.row!.endedAt })
    ).toBe(false);
  });

  it('order does not matter: a late "updated (active)" after the deletion still writes Stripe\'s CURRENT state (canceled)', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: 1_790_600_000 });
    await mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps);
    const afterDelete = { ...h.state.row };
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.state.row).toEqual(afterDelete);
  });

  it('never touches current_period_end, the bought tier or the last invoice (only a paid invoice moves those)', async () => {
    const h = setup(row(), { status: 'past_due' });
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.state.row).toMatchObject({ currentPeriodEnd: '2026-11-01T00:00:00.000Z', boughtTier: 'tier_one', lastInvoiceId: 'in_1', subscriptionStatus: 'past_due' });
  });

  it('no billing record holds the subscription (or it is detached): warn, nothing written, Stripe not asked', async () => {
    const none = setup(null);
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), none.log, none.deps);
    expect(none.logged('bos_billing_subscription_no_account')[0].level).toBe('warn');
    expect(none.retrieve).not.toHaveBeenCalled();
    const detached = setup(row({ accountId: null }));
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), detached.log, detached.deps);
    expect(detached.deps.billingAccounts.mirrorSubscriptionState).not.toHaveBeenCalled();
  });

  it('metadata on the fresh subscription naming another account: error + alert, nothing written', async () => {
    const h = setup(row(), { status: 'canceled', metadata: { bos_user_id: '22222222-2222-4222-8222-222222222222' } });
    await mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.state.row).toEqual(row());
    expect(h.logged('bos_billing_subscription_metadata_mismatch')[0].ctx.alert).toBe(true);
  });

  it('the row no longer holds the subscription between read and write: mirrored false, logged', async () => {
    const h = setup();
    (h.deps.billingAccounts.mirrorSubscriptionState as jest.Mock).mockResolvedValueOnce({ data: { mirrored: false }, error: null });
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.logged('bos_billing_subscription_mirror_skipped')).toHaveLength(1);
  });

  it.each([
    ['the Stripe read', (h: ReturnType<typeof setup>) => h.retrieve.mockRejectedValueOnce(new Error('stripe down'))],
    ['the billing read', (h: ReturnType<typeof setup>) => (h.deps.billingAccounts.findByStripeSubscription as jest.Mock).mockResolvedValueOnce({ data: null, error: new Error('db down') })],
    ['the write', (h: ReturnType<typeof setup>) => (h.deps.billingAccounts.mirrorSubscriptionState as jest.Mock).mockResolvedValueOnce({ data: null, error: new Error('db down') })],
  ])('a failure of %s throws (claim released)', async (_label, breakIt) => {
    const h = setup();
    breakIt(h);
    await expect(mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps)).rejects.toThrow();
  });
});
