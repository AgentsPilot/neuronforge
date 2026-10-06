import type Stripe from 'stripe';
import { subscriptionPeriodEnd, subscriptionPeriodEndIso } from '@/lib/stripe/subscriptionPeriod';

// Only the fields the helper reads; the rest of the Stripe object is irrelevant here.
function sub(items: unknown): Stripe.Subscription {
  return { id: 'sub_1', items } as unknown as Stripe.Subscription;
}

describe('subscriptionPeriodEnd (Stripe 2025-10-29.clover shape)', () => {
  it('reads current_period_end from the first subscription item', () => {
    expect(subscriptionPeriodEnd(sub({ data: [{ current_period_end: 1790000000 }, { current_period_end: 1 }] }))).toBe(1790000000);
  });

  it('ignores a subscription-level current_period_end (removed in Basil)', () => {
    const legacy = { id: 'sub_1', current_period_end: 123, items: { data: [{ current_period_end: 456 }] } };
    expect(subscriptionPeriodEnd(legacy as unknown as Stripe.Subscription)).toBe(456);
  });

  it.each([
    ['no items', { data: [] }],
    ['an items list without data', {}],
    ['no items object at all', undefined],
    ['an item without a period', { data: [{}] }],
  ])('returns null for %s', (_label, items) => {
    expect(subscriptionPeriodEnd(sub(items))).toBeNull();
  });
});

describe('subscriptionPeriodEndIso', () => {
  it('formats the item period end as ISO 8601', () => {
    expect(subscriptionPeriodEndIso(sub({ data: [{ current_period_end: 1790000000 }] }))).toBe(new Date(1790000000 * 1000).toISOString());
  });

  it('returns null instead of throwing when there is no period', () => {
    expect(() => subscriptionPeriodEndIso(sub({ data: [] }))).not.toThrow();
    expect(subscriptionPeriodEndIso(sub({ data: [] }))).toBeNull();
  });
});
