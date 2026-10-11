/**
 * Plan checkout session events (plan payments P-3b.2, workplan §3.5; P-3a SA
 * Q-1): completed links the subscription and clears the lock, expired clears
 * the lock, both by compare-and-set on THIS session's lock.
 *
 * The billing port is a fake that models the repository's compare-and-set
 * filters (user + mode + this session's lock, and "no subscription yet" for
 * the link), so "another session's lock is never cleared" is tested on state,
 * not on call shapes.
 */

import fs from 'fs';
import path from 'path';
import type Stripe from 'stripe';

import {
  onPlanCheckoutSessionCompleted,
  onPlanCheckoutSessionExpired,
  type PlanCheckoutSessionDeps,
} from '@/lib/business-os/billing/planCheckoutSessionEvents';
import type { BusinessOsBillingAccount } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import type { Logger } from '@/lib/logger';

const FIXTURES = path.join(__dirname, 'fixtures', 'stripe');
const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const CUSTOMER = 'cus_P1'; // Stripe-shaped (the fixture's id carries an underscore, which real ids never do)
const SESSION = 'cs_test_handbuilt_1';
const NOW = new Date('2026-10-07T12:00:00.000Z');

function event(name: string, change: (s: Stripe.Checkout.Session) => void = () => undefined): Stripe.Event {
  const e = JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as Stripe.Event;
  (e.data.object as Stripe.Checkout.Session).customer = CUSTOMER;
  change(e.data.object as Stripe.Checkout.Session);
  return e;
}
const COMPLETED = () => event('checkout-session-completed-subscription.json');
const EXPIRED = () => event('checkout-session-expired-subscription.json');

function row(overrides: Partial<BusinessOsBillingAccount> = {}): BusinessOsBillingAccount {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    accountId: ACCOUNT,
    livemode: false,
    stripeCustomerId: CUSTOMER,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    boughtTier: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingTier: null,
    openCheckoutSessionId: SESSION,
    openCheckoutExpiresAt: '2026-10-07T12:31:00.000Z',
    lastInvoiceId: null,
    lastPaidAt: null,
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

function setup(initial: BusinessOsBillingAccount | null = row()) {
  const state = { row: initial };
  const linkError: { value: Error | null } = { value: null };
  const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
  const at = (level: string) => (ctx: Record<string, unknown>) => {
    lines.push({ level, ctx });
  };
  const log = { info: at('info'), warn: at('warn'), error: at('error') } as unknown as Logger;
  const matches = (input: { userId: string; livemode: boolean; sessionId: string }) =>
    !!state.row && state.row.accountId === input.userId && state.row.livemode === input.livemode && state.row.openCheckoutSessionId === input.sessionId;

  const deps: PlanCheckoutSessionDeps = {
    now: () => NOW,
    billingAccounts: {
      findByStripeCustomer: jest.fn(async (customerId: string, livemode: boolean) => ({
        data: state.row && state.row.stripeCustomerId === customerId && state.row.livemode === livemode ? state.row : null,
        error: null,
      })),
      linkCheckoutSession: jest.fn(async (input: { userId: string; livemode: boolean; sessionId: string; stripeSubscriptionId: string; nowIso: string }) => {
        if (linkError.value) return { data: null, error: linkError.value };
        if (!matches(input) || state.row!.stripeSubscriptionId !== null) return { data: { linked: false }, error: null };
        state.row = { ...state.row!, stripeSubscriptionId: input.stripeSubscriptionId, openCheckoutSessionId: null, openCheckoutExpiresAt: null, updatedAt: input.nowIso };
        return { data: { linked: true }, error: null };
      }),
      releaseCheckoutLock: jest.fn(async (input: { userId: string; livemode: boolean; sessionId: string; nowIso: string }) => {
        if (!matches(input)) return { data: { released: false }, error: null };
        state.row = { ...state.row!, openCheckoutSessionId: null, openCheckoutExpiresAt: null, updatedAt: input.nowIso };
        return { data: { released: true }, error: null };
      }),
    } as unknown as PlanCheckoutSessionDeps['billingAccounts'],
  };
  const logged = (name: string) => lines.filter((l) => l.ctx.event === name);
  return { state, deps, log, logged, linkError };
}

describe('checkout.session.completed', () => {
  it('links the subscription and clears the lock on the matching session', async () => {
    const h = setup();
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.state.row).toMatchObject({ stripeSubscriptionId: 'sub_probe_1', openCheckoutSessionId: null, openCheckoutExpiresAt: null, updatedAt: NOW.toISOString() });
    expect(h.logged('bos_billing_checkout_linked')).toHaveLength(1);
    expect(h.deps.billingAccounts.findByStripeCustomer).toHaveBeenCalledWith(CUSTOMER, false);
  });

  it('a replay is a no-op (count 0), logged at info', async () => {
    const h = setup();
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    const after = { ...h.state.row };
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.state.row).toEqual(after);
    expect(h.logged('bos_billing_checkout_lock_already_clear')).toEqual([expect.objectContaining({ level: 'info' })]);
  });

  it('the paid invoice linked it first: the lock alone is cleared', async () => {
    const h = setup(row({ stripeSubscriptionId: 'sub_probe_1' }));
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.deps.billingAccounts.linkCheckoutSession).not.toHaveBeenCalled();
    expect(h.state.row).toMatchObject({ stripeSubscriptionId: 'sub_probe_1', openCheckoutSessionId: null });
  });

  it("another session's lock is never cleared, and nothing is linked through it", async () => {
    const h = setup(row({ openCheckoutSessionId: 'cs_test_other', openCheckoutExpiresAt: '2026-10-07T12:40:00.000Z' }));
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.state.row).toMatchObject({ openCheckoutSessionId: 'cs_test_other', stripeSubscriptionId: null });
  });

  it('a row holding ANOTHER subscription: the lock is cleared, the link is left to invoice.paid, warn', async () => {
    const h = setup(row({ stripeSubscriptionId: 'sub_Old' }));
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.state.row).toMatchObject({ stripeSubscriptionId: 'sub_Old', openCheckoutSessionId: null });
    expect(h.deps.billingAccounts.linkCheckoutSession).not.toHaveBeenCalled();
    expect(h.logged('bos_billing_checkout_other_subscription')[0].level).toBe('warn');
  });

  it("the subscription is another account's (unique violation): the lock is still cleared, nothing linked", async () => {
    const h = setup();
    h.linkError.value = new Error('stripe_subscription_held_by_another_account');
    await onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps);
    expect(h.state.row).toMatchObject({ stripeSubscriptionId: null, openCheckoutSessionId: null });
  });

  it('any other link failure throws (claim released)', async () => {
    const h = setup();
    h.linkError.value = new Error('db down');
    await expect(onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps)).rejects.toThrow('db down');
  });

  it('metadata naming another account: error + alert, NOTHING written (metadata never chooses)', async () => {
    const h = setup();
    const e = event('checkout-session-completed-subscription.json', (s) => {
      s.metadata = { bos_user_id: '22222222-2222-4222-8222-222222222222' };
    });
    await onPlanCheckoutSessionCompleted(e, h.log, h.deps);
    expect(h.state.row).toEqual(row());
    expect(h.logged('bos_billing_session_metadata_mismatch')[0]).toMatchObject({ level: 'error', ctx: expect.objectContaining({ alert: true }) });
  });

  it('a customer with no billing record (or a detached one): warn, nothing written', async () => {
    const none = setup(null);
    await onPlanCheckoutSessionCompleted(COMPLETED(), none.log, none.deps);
    expect(none.logged('bos_billing_session_no_account')[0].level).toBe('warn');
    const detached = setup(row({ accountId: null }));
    await onPlanCheckoutSessionCompleted(COMPLETED(), detached.log, detached.deps);
    expect(detached.deps.billingAccounts.releaseCheckoutLock).not.toHaveBeenCalled();
  });

  it('the other mode is a different row: a live-mode event does not touch the test-mode record', async () => {
    const h = setup();
    const e = COMPLETED();
    e.livemode = true;
    await onPlanCheckoutSessionCompleted(e, h.log, h.deps);
    expect(h.state.row).toEqual(row());
  });

  it('a read failure throws', async () => {
    const h = setup();
    (h.deps.billingAccounts.findByStripeCustomer as jest.Mock).mockResolvedValueOnce({ data: null, error: new Error('read down') });
    await expect(onPlanCheckoutSessionCompleted(COMPLETED(), h.log, h.deps)).rejects.toThrow('read down');
  });
});

describe('checkout.session.expired', () => {
  it('clears its own lock', async () => {
    const h = setup();
    await onPlanCheckoutSessionExpired(EXPIRED(), h.log, h.deps);
    expect(h.state.row).toMatchObject({ openCheckoutSessionId: null, openCheckoutExpiresAt: null, stripeSubscriptionId: null });
    expect(h.deps.billingAccounts.linkCheckoutSession).not.toHaveBeenCalled();
  });

  it("only its own: another session's lock stays", async () => {
    const h = setup(row({ openCheckoutSessionId: 'cs_test_other' }));
    await onPlanCheckoutSessionExpired(EXPIRED(), h.log, h.deps);
    expect(h.state.row?.openCheckoutSessionId).toBe('cs_test_other');
  });

  it('a lock already gone is a no-op', async () => {
    const h = setup(row({ openCheckoutSessionId: null, openCheckoutExpiresAt: null }));
    await onPlanCheckoutSessionExpired(EXPIRED(), h.log, h.deps);
    expect(h.logged('bos_billing_checkout_lock_already_clear')).toHaveLength(1);
  });
});
