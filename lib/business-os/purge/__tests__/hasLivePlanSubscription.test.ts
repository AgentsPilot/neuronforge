/**
 * hasLivePlanSubscription (plan payments P-3b.1, PF-13; SA ruling 2 and Q-6;
 * QA Bug 1).
 *
 * The admin entitlements route keeps the credit-period anchor of a subscribed
 * account through this one function. It reads BOTH Stripe modes (SA ruling 2):
 * a live subscription in either mode is "subscribed", and a failed read in
 * either mode is "could not tell" (null), which the admin op refuses.
 */

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

type Row = { subscriptionStatus: string | null; stripeSubscriptionId: string | null; endedAt: string | null };
type Answer = { data: Row | null; error: Error | null };
const answers: { test: Answer; live: Answer } = {
  test: { data: null, error: null },
  live: { data: null, error: null },
};
const reads: Array<[string, boolean]> = [];

jest.mock('@/lib/repositories/BusinessOsBillingAccountRepository', () => ({
  businessOsBillingAccountRepository: {
    async findByUser(accountId: string, livemode: boolean) {
      reads.push([accountId, livemode]);
      return livemode ? answers.live : answers.test;
    },
  },
}));

import { hasLivePlanSubscription } from '../adminDeletionFacts';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const LIVE_ROW: Row = { subscriptionStatus: 'active', stripeSubscriptionId: 'sub_1', endedAt: null };
const ENDED_ROW: Row = { subscriptionStatus: 'canceled', stripeSubscriptionId: 'sub_1', endedAt: '2026-10-01T00:00:00.000Z' };

beforeEach(() => {
  answers.test = { data: null, error: null };
  answers.live = { data: null, error: null };
  reads.length = 0;
});

describe('hasLivePlanSubscription', () => {
  it('reads both Stripe modes for the given account', async () => {
    await hasLivePlanSubscription(ACCOUNT);
    expect(reads.sort()).toEqual([
      [ACCOUNT, false],
      [ACCOUNT, true],
    ]);
  });

  it('a live-mode subscription alone is subscribed', async () => {
    answers.live = { data: LIVE_ROW, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(true);
  });

  it('a test-mode subscription alone is subscribed', async () => {
    answers.test = { data: LIVE_ROW, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(true);
  });

  it('a subscription Stripe has not ended is subscribed whatever the mirrored status says', async () => {
    answers.test = { data: { subscriptionStatus: 'canceled', stripeSubscriptionId: 'sub_1', endedAt: null }, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(true);
  });

  it('an ended subscription is not subscribed', async () => {
    answers.test = { data: ENDED_ROW, error: null };
    answers.live = { data: ENDED_ROW, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(false);
  });

  it('no billing row in either mode is not subscribed', async () => {
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(false);
  });

  it('a row with no subscription is not subscribed', async () => {
    answers.test = { data: { subscriptionStatus: null, stripeSubscriptionId: null, endedAt: null }, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBe(false);
  });

  it.each([
    ['test', 'live'],
    ['live', 'test'],
  ] as const)('a failed %s-mode read is null (could not tell), even when the %s mode is live', async (failed, other) => {
    answers[failed] = { data: null, error: new Error('read failed') };
    answers[other] = { data: LIVE_ROW, error: null };
    await expect(hasLivePlanSubscription(ACCOUNT)).resolves.toBeNull();
  });
});
