/**
 * StripeService — the Business OS plan TEST CLOCK methods (plan payments
 * P-6a.1, workplan §5.8; SA C-5).
 *
 * What matters: every method refuses a non-test key BEFORE any Stripe call
 * (defence in depth behind the route); the customer is created on the new
 * clock with the Business OS metadata and a per-clock idempotency key, and no
 * email or name; and the methods take no database client.
 */

const mockClockCreate = jest.fn();
const mockClockRetrieve = jest.fn();
const mockClockAdvance = jest.fn();
const mockCustomerCreate = jest.fn();
const mockCustomerRetrieve = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    testHelpers: {
      testClocks: {
        create: (...args: unknown[]) => mockClockCreate(...args),
        retrieve: (...args: unknown[]) => mockClockRetrieve(...args),
        advance: (...args: unknown[]) => mockClockAdvance(...args),
      },
    },
    customers: {
      create: (...args: unknown[]) => mockCustomerCreate(...args),
      retrieve: (...args: unknown[]) => mockCustomerRetrieve(...args),
    },
  }))
);

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { readFileSync } from 'fs';
import { join } from 'path';

import { StripeService } from '@/lib/stripe/StripeService';

const ACCOUNT = 'abcdef99-9999-4999-8999-99999999999f';
const FROZEN_UNIX = 1_793_491_200; // 2026-11-01T00:00:00Z

beforeEach(() => {
  jest.clearAllMocks();
  mockClockCreate.mockResolvedValue({ id: 'clock_1', frozen_time: FROZEN_UNIX, status: 'ready' });
  mockClockRetrieve.mockResolvedValue({ id: 'clock_1', frozen_time: FROZEN_UNIX, status: 'ready' });
  mockClockAdvance.mockResolvedValue({ id: 'clock_1', frozen_time: FROZEN_UNIX + 86400, status: 'advancing' });
  mockCustomerCreate.mockResolvedValue({ id: 'cus_clock1', livemode: false });
  mockCustomerRetrieve.mockResolvedValue({ id: 'cus_clock1', test_clock: 'clock_1', metadata: { product: 'business_os_plan', bos_user_id: ACCOUNT } });
});

describe('a live (or unknown) key is refused before any Stripe call (SA C-5)', () => {
  it.each(['sk_live_unit', 'rk_live_unit', 'pk_test_unit', 'whatever'])('%s', async (key) => {
    const service = new StripeService(key);
    await expect(service.createBusinessOsTestClockCustomer({ bosUserId: ACCOUNT, frozenTimeUnix: FROZEN_UNIX })).rejects.toThrow(
      'test_clock_requires_test_mode_key'
    );
    await expect(service.retrieveBusinessOsCustomerClock('cus_1')).rejects.toThrow('test_clock_requires_test_mode_key');
    await expect(service.retrieveBusinessOsTestClock('clock_1')).rejects.toThrow('test_clock_requires_test_mode_key');
    await expect(service.advanceBusinessOsTestClock('clock_1', FROZEN_UNIX + 60)).rejects.toThrow('test_clock_requires_test_mode_key');

    expect(mockClockCreate).not.toHaveBeenCalled();
    expect(mockClockRetrieve).not.toHaveBeenCalled();
    expect(mockClockAdvance).not.toHaveBeenCalled();
    expect(mockCustomerCreate).not.toHaveBeenCalled();
    expect(mockCustomerRetrieve).not.toHaveBeenCalled();
  });

  it('the refusal never echoes the key', async () => {
    const service = new StripeService('sk_live_SECRETVALUE');
    await expect(service.retrieveBusinessOsTestClock('clock_1')).rejects.toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('SECRETVALUE') })
    );
  });
});

describe('with a test key', () => {
  const service = () => new StripeService('sk_test_unit');

  it('creates a clock, then a customer ON it with the Business OS metadata and a per-clock idempotency key, no email', async () => {
    const result = await service().createBusinessOsTestClockCustomer({ bosUserId: ACCOUNT, frozenTimeUnix: FROZEN_UNIX });

    expect(mockClockCreate).toHaveBeenCalledWith({ frozen_time: FROZEN_UNIX, name: 'Business OS plan test clock' });
    expect(mockCustomerCreate).toHaveBeenCalledWith(
      { test_clock: 'clock_1', metadata: { product: 'business_os_plan', bos_user_id: ACCOUNT } },
      { idempotencyKey: `bos-customer-clock:${ACCOUNT}:clock_1` }
    );
    const [customerParams] = mockCustomerCreate.mock.calls[0];
    expect(customerParams).not.toHaveProperty('email');
    expect(customerParams).not.toHaveProperty('name');
    expect(result).toEqual({
      testClockId: 'clock_1',
      frozenTime: '2026-11-01T00:00:00.000Z',
      customerId: 'cus_clock1',
      livemode: false,
    });
  });

  it('reads the customer clock and its bos_user_id; an expanded clock object reads by id; a deleted customer reads deleted', async () => {
    expect(await service().retrieveBusinessOsCustomerClock('cus_clock1')).toEqual({
      deleted: false,
      testClockId: 'clock_1',
      bosUserId: ACCOUNT,
    });

    mockCustomerRetrieve.mockResolvedValue({ id: 'cus_clock1', test_clock: { id: 'clock_2' }, metadata: {} });
    expect(await service().retrieveBusinessOsCustomerClock('cus_clock1')).toEqual({ deleted: false, testClockId: 'clock_2', bosUserId: null });

    mockCustomerRetrieve.mockResolvedValue({ id: 'cus_clock1', test_clock: null, metadata: {} });
    expect((await service().retrieveBusinessOsCustomerClock('cus_clock1')).testClockId).toBeNull();

    mockCustomerRetrieve.mockResolvedValue({ id: 'cus_clock1', deleted: true });
    expect(await service().retrieveBusinessOsCustomerClock('cus_clock1')).toEqual({ deleted: true, testClockId: null, bosUserId: null });
  });

  it('reads and advances a clock, returning ISO times', async () => {
    expect(await service().retrieveBusinessOsTestClock('clock_1')).toEqual({
      testClockId: 'clock_1',
      frozenTime: '2026-11-01T00:00:00.000Z',
      status: 'ready',
    });
    expect(await service().advanceBusinessOsTestClock('clock_1', FROZEN_UNIX + 86400)).toEqual({
      testClockId: 'clock_1',
      frozenTime: '2026-11-02T00:00:00.000Z',
      status: 'advancing',
    });
    expect(mockClockAdvance).toHaveBeenCalledWith('clock_1', { frozen_time: FROZEN_UNIX + 86400 });
  });

  it('a Stripe error propagates (the use case decides what it means)', async () => {
    mockClockAdvance.mockRejectedValue(Object.assign(new Error('too far'), { type: 'StripeInvalidRequestError' }));
    await expect(service().advanceBusinessOsTestClock('clock_1', FROZEN_UNIX + 86400)).rejects.toThrow('too far');
  });
});

describe('source guards', () => {
  const svc = readFileSync(join(process.cwd(), 'lib', 'stripe', 'StripeService.ts'), 'utf8').replace(/\r\n/g, '\n');
  const NAMES = [
    'createBusinessOsTestClockCustomer',
    'retrieveBusinessOsCustomerClock',
    'retrieveBusinessOsTestClock',
    'advanceBusinessOsTestClock',
  ];

  it('each test-clock method checks the key mode first, sits after the P-3a methods and takes no database client', () => {
    const p3a = svc.indexOf('async expireCheckoutSession(');
    for (const name of NAMES) {
      const start = svc.indexOf(`async ${name}(`);
      expect(start).toBeGreaterThan(p3a);
      const body = svc.slice(start, svc.indexOf('\n  }\n', start));
      expect(body).not.toMatch(/SupabaseClient|supabase/i);
      // Every signature ends `...Promise<...> {`; the first statement follows.
      const firstStatement = body.slice(body.indexOf('> {\n') + 4).trim();
      expect(firstStatement.startsWith('this.assertTestModeKey();')).toBe(true);
    }
  });

  it('the service keeps only the key MODE, never the key itself', () => {
    expect(svc).toContain('private readonly isTestModeKey: boolean;');
    expect(svc).not.toMatch(/this\.\w*[kK]ey\s*=\s*stripeSecretKey;/);
  });
});
