/**
 * StripePluginExecutor subscription actions at Stripe API 2025-10-29.clover.
 *
 * Basil moved `current_period_end` off the Subscription onto its items. The
 * executor used to do `new Date(subscription.current_period_end * 1000)
 * .toISOString()`, which throws a RangeError on `undefined`. For
 * create_subscription that meant reporting FAILURE after Stripe had already
 * created the subscription, so a retry could create a second one. The period
 * end is now read from the first item, and is null (never a throw) without one.
 */

const mockSubscriptions = {
  create: jest.fn(),
  retrieve: jest.fn(),
  update: jest.fn(),
  list: jest.fn(),
};
jest.mock('@/lib/stripe/StripeService', () => ({
  getStripeService: () => ({ stripe: { subscriptions: mockSubscriptions } }),
}));

import { StripePluginExecutor } from '@/lib/server/stripe-plugin-executor';
import type { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import type { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

type ActionResult = { success: boolean; data: Record<string, unknown>; message?: string };
// executeSpecificAction is protected; the test drives it directly, below the
// connection/validation plumbing that BasePluginExecutor tests cover.
type ExecutorUnderTest = {
  executeSpecificAction(connection: unknown, actionName: string, parameters: unknown): Promise<ActionResult>;
};

const CONNECTION = { profile_data: { stripe_account_id: 'acct_123' } };
const PERIOD_END = 1790000000;
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

function makeExecutor(): ExecutorUnderTest {
  const executor = new StripePluginExecutor(
    {} as unknown as UserPluginConnections,
    {} as unknown as PluginManagerV2
  );
  return executor as unknown as ExecutorUnderTest;
}

function subscription(items: unknown[], extra: Record<string, unknown> = {}) {
  return { id: 'sub_1', status: 'active', customer: 'cus_1', trial_end: null, cancel_at_period_end: false, items: { data: items }, ...extra };
}

const ITEM = { id: 'si_1', current_period_end: PERIOD_END, price: { product: 'prod_1', unit_amount: 2500, currency: 'usd' } };

beforeEach(() => jest.clearAllMocks());

describe('[smoke] Stripe subscription period end (Basil item shape)', () => {
  it('create_subscription succeeds and reads current_period_end from the item', async () => {
    mockSubscriptions.create.mockResolvedValue(subscription([ITEM]));
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'create_subscription', { customer_id: 'cus_1', price_id: 'price_1' });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ subscription_id: 'sub_1', status: 'active', current_period_end: PERIOD_END_ISO, trial_end: null });
  });

  it('update_subscription succeeds and reads current_period_end from the item', async () => {
    mockSubscriptions.update.mockResolvedValue(subscription([ITEM], { cancel_at_period_end: true }));
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'update_subscription', { subscription_id: 'sub_1', cancel_at_period_end: true });
    expect(res.success).toBe(true);
    expect(res.data).toEqual({ subscription_id: 'sub_1', status: 'active', current_period_end: PERIOD_END_ISO, cancel_at_period_end: true });
  });

  it('list_subscriptions succeeds and reads current_period_end from each item', async () => {
    mockSubscriptions.list.mockResolvedValue({ data: [subscription([ITEM])], has_more: false });
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'list_subscriptions', {});
    expect(res.success).toBe(true);
    expect(res.data).toEqual({
      subscriptions: [
        { subscription_id: 'sub_1', customer_id: 'cus_1', status: 'active', current_period_end: PERIOD_END_ISO, plan_name: 'prod_1', amount: 2500, currency: 'usd' },
      ],
      total_count: 1,
      has_more: false,
    });
  });
});

describe('[full] Stripe subscription period end without items: null, never a throw', () => {
  it('create_subscription still reports success (Stripe already created it)', async () => {
    mockSubscriptions.create.mockResolvedValue(subscription([]));
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'create_subscription', { customer_id: 'cus_1', price_id: 'price_1' });
    expect(res.success).toBe(true);
    expect(res.data.subscription_id).toBe('sub_1');
    expect(res.data.current_period_end).toBeNull();
  });

  it('update_subscription returns null current_period_end', async () => {
    mockSubscriptions.update.mockResolvedValue(subscription([]));
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'update_subscription', { subscription_id: 'sub_1', cancel_at_period_end: false });
    expect(res.success).toBe(true);
    expect(res.data.current_period_end).toBeNull();
  });

  it('list_subscriptions returns null current_period_end and keeps the other defaults', async () => {
    mockSubscriptions.list.mockResolvedValue({ data: [subscription([])], has_more: false });
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'list_subscriptions', {});
    expect(res.success).toBe(true);
    const [row] = res.data.subscriptions as Record<string, unknown>[];
    expect(row).toMatchObject({ current_period_end: null, plan_name: 'Unknown', amount: 0, currency: 'usd' });
  });

  it('ignores a legacy subscription-level current_period_end', async () => {
    mockSubscriptions.create.mockResolvedValue(subscription([ITEM], { current_period_end: 1 }));
    const res = await makeExecutor().executeSpecificAction(CONNECTION, 'create_subscription', { customer_id: 'cus_1', price_id: 'price_1' });
    expect(res.data.current_period_end).toBe(PERIOD_END_ISO);
  });
});
