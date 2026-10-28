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
import type { BusinessOsBillingEventInput } from '@/lib/repositories/BusinessOsBillingEventRepository';
import type { RecordPlanChangeInput } from '@/lib/business-os/entitlements/recordPlanChange';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  AFTER_PLAN_MOVE_AUDIT_ACTION,
  moveToFreeCohortAfterPlan,
  type AfterPlanMoveDeps,
  type AfterPlanMoveInput,
  type AfterPlanMoveRead,
  type AfterPlanMoveWrite,
} from '@/lib/business-os/billing/afterPlanMove';
import { AFTER_PLAN } from '@/lib/business-os/entitlements/config/afterPlan';
import { TIER_ORDER } from '@/lib/business-os/entitlements/config/tierMatrix';
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
  // P-6a.2: the money history (unique on the event id) and the audit port.
  const history: BusinessOsBillingEventInput[] = [];
  const audits: RecordPlanChangeInput[] = [];
  const deps: PlanSubscriptionMirrorDeps = {
    now: () => NOW,
    billingEvents: {
      recordEvent: jest.fn(async (input: BusinessOsBillingEventInput) => {
        if (history.some((h) => h.stripeEventId === input.stripeEventId)) return { data: { outcome: 'duplicate' as const }, error: null };
        history.push(input);
        return { data: { outcome: 'recorded' as const, eventRowId: `44444444-4444-4444-8444-00000000000${history.length}` }, error: null };
      }),
    },
    recordPlanChange: jest.fn(async (input: RecordPlanChangeInput) => {
      audits.push(input);
    }),
    // D3.1 (SX-2b): the after-plan move port, a stub here (its own suite is afterPlanMove.test.ts).
    afterPlanMove: jest.fn(async () => undefined),
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
  return { state, stripeState, deps, log, logged, retrieve, history, audits };
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

// ── P-6a.2: the ended history row and audit (workplan §5.5; SA C-4, C-10) ────

describe('customer.subscription.deleted: one subscription_ended row and one audit (AC-F6.3)', () => {
  const ENDED_AT = 1_801_211_893;

  it('deleted: the row records the subscription, our customer and the bought tier; one info audit, nothing invalidated', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: 'payment_failed' };
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    expect(h.history).toEqual([
      {
        accountId: ACCOUNT,
        livemode: false,
        kind: 'subscription_ended',
        stripeEventId: deleted.id,
        stripeSubscriptionId: SUB,
        stripeCustomerId: 'cus_probe_1',
        tier: 'tier_one',
      },
    ]);
    expect(h.audits).toEqual([
      expect.objectContaining({
        accountId: ACCOUNT,
        action: 'BOS_BILLING_SUBSCRIPTION_ENDED',
        actor: { kind: 'system', source: 'stripe_webhook' },
        entityType: 'business_os_account_plan',
        entityId: ACCOUNT,
        severity: 'info',
        invalidatesEntitlements: false,
        details: expect.objectContaining({ subscriptionId: SUB, cancellationReason: 'payment_failed', endedAt: new Date(ENDED_AT * 1000).toISOString(), livemode: false }),
      }),
    ]);
    expect(h.logged('bos_billing_subscription_ended')).toHaveLength(1);
  });

  it('a replay of the same event records nothing more and audits nothing', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const deleted = event('customer-subscription-deleted.json');
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    expect(h.history).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.logged('bos_billing_subscription_ended_replayed')).toHaveLength(1);
  });

  it('an unknown cancellation reason is recorded as null', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: 'something_new' as never };
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    expect(h.audits[0].details).toMatchObject({ cancellationReason: null });
  });

  it('C-4: an .updated that reads an ENDED subscription mirrors it and nothing more', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.state.row).toMatchObject({ subscriptionStatus: 'canceled', endedAt: new Date(ENDED_AT * 1000).toISOString() });
    expect(h.history).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('the row no longer holds the subscription: no row, no audit', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    (h.deps.billingAccounts.mirrorSubscriptionState as jest.Mock).mockResolvedValueOnce({ data: { mirrored: false }, error: null });
    await mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.history).toEqual([]);
    expect(h.audits).toEqual([]);
  });

  it('the history write failing throws (claim released; the retry records it then)', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    (h.deps.billingEvents.recordEvent as jest.Mock).mockResolvedValueOnce({ data: null, error: new Error('db down') });
    await expect(mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps)).rejects.toThrow('db down');
    expect(h.audits).toEqual([]);
  });

  it('never writes the plan row, current_period_end or the bought tier (SA-P8: the lifecycle derives the rest)', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    await mirrorPlanSubscription(event('customer-subscription-deleted.json'), h.log, h.deps);
    expect(h.state.row).toMatchObject({ currentPeriodEnd: '2026-11-01T00:00:00.000Z', boughtTier: 'tier_one', lastInvoiceId: 'in_1' });
  });
});

// ── D3.1 (SX-2b): the after-plan move port (workplan §6.1, §10; SA DR-8) ─────

describe('customer.subscription.deleted: the after-plan move port (D3.1, SX-2b)', () => {
  const ENDED_AT = 1_801_211_893;
  const ENDED_ISO = new Date(ENDED_AT * 1000).toISOString();

  /** The order the mirror's writes and the port run in. */
  function ordered(h: ReturnType<typeof setup>) {
    const order: string[] = [];
    const recordEvent = h.deps.billingEvents.recordEvent as jest.Mock;
    const recordEventImpl = recordEvent.getMockImplementation()!;
    recordEvent.mockImplementation(async (input: BusinessOsBillingEventInput) => {
      order.push('recordEvent');
      return recordEventImpl(input);
    });
    const recordPlanChange = h.deps.recordPlanChange as jest.Mock;
    const recordPlanChangeImpl = recordPlanChange.getMockImplementation()!;
    recordPlanChange.mockImplementation(async (input: RecordPlanChangeInput) => {
      order.push('recordPlanChange');
      return recordPlanChangeImpl(input);
    });
    (h.deps.afterPlanMove as jest.Mock).mockImplementation(async () => {
      order.push('afterPlanMove');
    });
    return order;
  }

  function deletedWith(reason: string | null): Stripe.Event {
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: reason as never };
    return deleted;
  }

  it('deleted + mirrored: called once, AFTER the ended history and audit, with our account id, the event facts, the payload reason and endedAtIso', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const order = ordered(h);
    const deleted = deletedWith('cancellation_requested');
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    expect(order).toEqual(['recordEvent', 'recordPlanChange', 'afterPlanMove']);
    expect(h.deps.afterPlanMove).toHaveBeenCalledTimes(1);
    expect(h.deps.afterPlanMove).toHaveBeenCalledWith(
      {
        accountId: ACCOUNT,
        subscriptionId: SUB,
        livemode: false,
        stripeEventId: deleted.id,
        endedAt: ENDED_ISO,
        cancellationReason: 'cancellation_requested',
      },
      h.log
    );
  });

  it.each([['payment_failed'], ['payment_disputed'], [null], ['something_new']])(
    'the payload reason %p is passed verbatim (the move decides; the ended audit keeps its own filtered reason)',
    async (reason) => {
      const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
      await mirrorPlanSubscription(deletedWith(reason), h.log, h.deps);
      expect((h.deps.afterPlanMove as jest.Mock).mock.calls[0][0]).toMatchObject({ cancellationReason: reason });
      expect(h.audits[0].details).toMatchObject({ cancellationReason: reason === 'something_new' ? null : reason });
    }
  );

  it('a replayed .deleted (the money history is a duplicate) still calls it, so a move that threw runs again', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const deleted = deletedWith('cancellation_requested');
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    await mirrorPlanSubscription(deleted, h.log, h.deps);
    expect(h.logged('bos_billing_subscription_ended_replayed')).toHaveLength(1);
    expect(h.history).toHaveLength(1);
    expect(h.audits).toHaveLength(1);
    expect(h.deps.afterPlanMove).toHaveBeenCalledTimes(2);
  });

  it('.updated (even reading an ended subscription) does not call it', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    await mirrorPlanSubscription(event('customer-subscription-updated.json'), h.log, h.deps);
    expect(h.deps.afterPlanMove).not.toHaveBeenCalled();
  });

  it('mirrored false (the row no longer holds this subscription) does not call it', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    (h.deps.billingAccounts.mirrorSubscriptionState as jest.Mock).mockResolvedValueOnce({ data: { mirrored: false }, error: null });
    await mirrorPlanSubscription(deletedWith('cancellation_requested'), h.log, h.deps);
    expect(h.deps.afterPlanMove).not.toHaveBeenCalled();
  });

  it('a metadata mismatch, or no billing record, does not call it', async () => {
    const mismatch = setup(row(), { status: 'canceled', endedAt: ENDED_AT, metadata: { bos_user_id: '22222222-2222-4222-8222-222222222222' } });
    await mirrorPlanSubscription(deletedWith('cancellation_requested'), mismatch.log, mismatch.deps);
    expect(mismatch.deps.afterPlanMove).not.toHaveBeenCalled();
    const none = setup(null, { status: 'canceled', endedAt: ENDED_AT });
    await mirrorPlanSubscription(deletedWith('cancellation_requested'), none.log, none.deps);
    expect(none.deps.afterPlanMove).not.toHaveBeenCalled();
  });

  it('the history write failing throws before the move is reached', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    (h.deps.billingEvents.recordEvent as jest.Mock).mockResolvedValueOnce({ data: null, error: new Error('db down') });
    await expect(mirrorPlanSubscription(deletedWith('cancellation_requested'), h.log, h.deps)).rejects.toThrow('db down');
    expect(h.deps.afterPlanMove).not.toHaveBeenCalled();
  });

  it("the move throwing (a read or write failure) throws through (claim released); the mirror's own writes are already done and unchanged; the retry runs the move again", async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const deleted = deletedWith('cancellation_requested');
    (h.deps.afterPlanMove as jest.Mock).mockRejectedValueOnce(new Error('plan row read failed'));
    await expect(mirrorPlanSubscription(deleted, h.log, h.deps)).rejects.toThrow('plan row read failed');
    const afterFirst = { row: { ...h.state.row }, history: [...h.history], audits: [...h.audits] };
    expect(afterFirst.row).toMatchObject({ subscriptionStatus: 'canceled', endedAt: ENDED_ISO });
    expect(afterFirst.history).toHaveLength(1);
    expect(afterFirst.audits).toHaveLength(1);

    // Stripe redelivers: the mirror is idempotent, the history a duplicate, and the move runs again.
    await expect(mirrorPlanSubscription(deleted, h.log, h.deps)).resolves.toBeUndefined();
    expect(h.state.row).toEqual(afterFirst.row);
    expect(h.history).toEqual(afterFirst.history);
    expect(h.audits).toEqual(afterFirst.audits);
    expect(h.deps.afterPlanMove).toHaveBeenCalledTimes(2);
  });
});

describe('the mirror with the REAL after-plan move (ports stubbed): only an owner-started end moves', () => {
  const ENDED_AT = 1_801_211_893;

  function realMove(read: { error?: Error } = {}) {
    const reads: string[] = [];
    const writes: unknown[] = [];
    const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
    const at = (level: string) => (ctx: Record<string, unknown>) => void lines.push({ level, ctx });
    const log: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: () => undefined };
    log.child = () => log;
    const port = (input: AfterPlanMoveInput, l: Logger) =>
      moveToFreeCohortAfterPlan(input, l, {
        readMoveInputs: async (accountId) => {
          reads.push(accountId);
          if (read.error) return { data: null, error: read.error };
          return { data: null, error: null };
        },
        writeMove: async (input) => {
          writes.push(input);
          return { data: { outcome: 'applied', moves: 1 }, error: null };
        },
        config: () => getEntitlementConfig(),
        recordPlanChange: async () => undefined,
        now: () => NOW,
      });
    return { port, reads, writes, lines, log: log as unknown as Logger };
  }

  it("payment_failed keeps today's path: history + ended audit, the move reads and writes nothing", async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const move = realMove();
    h.deps.afterPlanMove = move.port;
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: 'payment_failed' };
    await mirrorPlanSubscription(deleted, move.log, h.deps);
    expect(h.history).toHaveLength(1);
    expect(h.audits.map((a) => a.action)).toEqual(['BOS_BILLING_SUBSCRIPTION_ENDED']);
    expect(move.reads).toEqual([]);
    expect(move.writes).toEqual([]);
    expect(move.lines.find((l) => l.ctx.event === 'bos_plan_after_plan_skipped')?.ctx.skip).toBe('not_owner_end');
  });

  it('cancellation_requested reaches the plan read for OUR account; a failed read alerts and throws (retried)', async () => {
    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    const move = realMove({ error: new Error('db down') });
    h.deps.afterPlanMove = move.port;
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: 'cancellation_requested' };
    await expect(mirrorPlanSubscription(deleted, move.log, h.deps)).rejects.toThrow('db down');
    expect(move.reads).toEqual([ACCOUNT]);
    expect(move.lines.find((l) => l.ctx.event === 'bos_plan_after_plan_read_failed')).toMatchObject({ level: 'error', ctx: { alert: true } });
    // The mirror's own result stands.
    expect(h.state.row).toMatchObject({ subscriptionStatus: 'canceled', endedAt: new Date(ENDED_AT * 1000).toISOString() });
    expect(h.history).toHaveLength(1);
  });

  it('replay (P-8b reconcile): the same .deleted twice replayed through the mirror after a successful move: the port is called each time, reports already_applied, and nothing changes', async () => {
    const endedIso = new Date(ENDED_AT * 1000).toISOString();
    // A stateful plan store: the write lands on the row the next read returns, as the plan table does.
    const store: AfterPlanMoveRead = {
      plan: {
        user_id: ACCOUNT, tier: TIER_ORDER[TIER_ORDER.length - 1], plan_version: 0, tier_expires_at: endedIso, cohort: AFTER_PLAN.cohort,
        cohort_expires_at: null, onboarding_started_at: '2026-01-01T00:00:00.000Z', profile_created_at: null, trial_started_at: null,
        trial_ends_at: null, grace_ends_at: null, period_anchor: '2026-10-01T00:00:00+00:00', origin: 'admin', updated_by_admin_id: null,
        created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-10-01T00:00:00.123456+00:00',
      },
      moves: 0,
      lastSubscriptionId: null,
    };
    const moveWrites: AfterPlanMoveWrite[] = [];
    const moveDeps: AfterPlanMoveDeps = {
      readMoveInputs: async () => ({ data: { plan: { ...store.plan }, moves: store.moves, lastSubscriptionId: store.lastSubscriptionId }, error: null }),
      writeMove: async (input) => {
        moveWrites.push(input);
        if (input.expected.updatedAt !== store.plan.updated_at || input.expected.moves !== store.moves) return { data: { outcome: 'stale' }, error: null };
        store.plan = {
          ...store.plan,
          cohort: input.cohort,
          trial_started_at: input.trialStartedAt,
          trial_ends_at: input.trialEndsAt,
          grace_ends_at: input.clearGraceEndsAt ? null : store.plan.grace_ends_at,
          period_anchor: input.periodAnchor,
          updated_at: '2026-10-07T12:00:00.000001+00:00',
        };
        store.moves += 1;
        store.lastSubscriptionId = input.subscriptionId;
        return { data: { outcome: 'applied', moves: store.moves }, error: null };
      },
      config: () => getEntitlementConfig(),
      recordPlanChange: async () => undefined,
      now: () => NOW,
    };

    const h = setup(row(), { status: 'canceled', endedAt: ENDED_AT });
    // One audit list for both: the mirror's ended audit and the move's free-period audit.
    moveDeps.recordPlanChange = h.deps.recordPlanChange;
    const lines: Array<{ level: string; ctx: Record<string, unknown> }> = [];
    const at = (level: string) => (ctx: Record<string, unknown>) => void lines.push({ level, ctx });
    const logRecord: Record<string, unknown> = { info: at('info'), warn: at('warn'), error: at('error'), debug: () => undefined };
    logRecord.child = () => logRecord;
    const log = logRecord as unknown as Logger;
    const port = jest.fn((input: AfterPlanMoveInput, l: Logger) => moveToFreeCohortAfterPlan(input, l, moveDeps));
    h.deps.afterPlanMove = port;
    const deleted = event('customer-subscription-deleted.json');
    (deleted.data.object as Stripe.Subscription).cancellation_details = { comment: null, feedback: null, reason: 'cancellation_requested' };
    const freePeriodAudits = () => h.audits.filter((a) => a.action === AFTER_PLAN_MOVE_AUDIT_ACTION);

    // First delivery: the move lands.
    await mirrorPlanSubscription(deleted, log, h.deps);
    expect(moveWrites).toHaveLength(1);
    expect(store.moves).toBe(1);
    expect(store.lastSubscriptionId).toBe(SUB);
    expect(freePeriodAudits()).toHaveLength(1);
    const after = {
      store: JSON.parse(JSON.stringify(store)) as AfterPlanMoveRead,
      row: { ...h.state.row },
      history: [...h.history],
      audits: [...h.audits],
    };

    // Two replays (Stripe redelivery, then the P-8b reconcile): the full mirror again, same event, each time.
    for (const run of [2, 3]) {
      await expect(mirrorPlanSubscription(deleted, log, h.deps)).resolves.toBeUndefined();
      expect(port).toHaveBeenCalledTimes(run); // the replay path still calls the port
      expect(lines.filter((l) => l.ctx.event === 'bos_plan_after_plan_skipped').map((l) => [l.level, l.ctx.skip])).toEqual(
        Array.from({ length: run - 1 }, () => ['info', 'already_applied'])
      );
      expect(moveWrites).toHaveLength(1); // still one plan write in total
      expect(store).toEqual(after.store); // after_plan_moves still 1, guarded by after_plan_last_subscription_id
      expect(store.plan.period_anchor).toBe(after.store.plan.period_anchor); // no second credit grant
      expect(freePeriodAudits()).toHaveLength(1); // still one BOS_PLAN_FREE_PERIOD_AFTER_CANCEL
      expect(h.audits).toEqual(after.audits);
      expect(h.state.row).toEqual(after.row); // the mirror's result is unchanged
      expect(h.history).toEqual(after.history);
      expect(lines.filter((l) => l.ctx.event === 'bos_billing_subscription_ended_replayed')).toHaveLength(run - 1);
    }
    // already_applied logged exactly twice: once per replay.
    expect(lines.filter((l) => l.ctx.skip === 'already_applied')).toHaveLength(2);
  });
});
