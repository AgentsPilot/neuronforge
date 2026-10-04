/**
 * The shared, Stripe-only customer function (plan payments P-2a, Q-T8, SA
 * P2-C3 and P2-C5). The agent-platform behaviour is pinned separately by
 * `getOrCreateCustomer.characterisation.test.ts`; this suite covers what only
 * the Business OS caller uses: the idempotency key, and `livemode` (including
 * `null` for a reused deleted customer).
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const mockRetrieve = jest.fn();
const mockCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    customers: {
      retrieve: (...args: unknown[]) => mockRetrieve(...args),
      create: (...args: unknown[]) => mockCreate(...args),
    },
  }))
);

const mockWarn = jest.fn();
jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {
      info: jest.fn(),
      warn: (...args: unknown[]) => mockWarn(...args),
      error: jest.fn(),
      debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');

beforeEach(() => {
  mockRetrieve.mockReset();
  mockCreate.mockReset();
  mockWarn.mockReset();
});

describe('findOrCreatePlatformCustomer', () => {
  it('reuses a retrieved customer and reports its livemode, with no create', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', object: 'customer', livemode: true });
    await expect(
      service().findOrCreatePlatformCustomer({ existingCustomerId: 'cus_1', email: 'a@example.com', metadata: {} })
    ).resolves.toEqual({ customerId: 'cus_1', created: false, livemode: true });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('a retrieved DELETED customer is reused with livemode null (P2-C3), not an invented mode', async () => {
    mockRetrieve.mockResolvedValue({ id: 'cus_1', object: 'customer', deleted: true });
    await expect(
      service().findOrCreatePlatformCustomer({ existingCustomerId: 'cus_1', email: 'a@example.com', metadata: {} })
    ).resolves.toEqual({ customerId: 'cus_1', created: false, livemode: null });
  });

  it('a retrieve that throws warns through Pino with { err } and falls through to create', async () => {
    const failure = new Error('No such customer');
    mockRetrieve.mockRejectedValue(failure);
    mockCreate.mockResolvedValue({ id: 'cus_2', object: 'customer', livemode: false });
    await expect(
      service().findOrCreatePlatformCustomer({ existingCustomerId: 'cus_1', email: 'a@example.com', metadata: { k: 'v' } })
    ).resolves.toEqual({ customerId: 'cus_2', created: true, livemode: false });
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ err: failure, customerId: 'cus_1' }), expect.any(String));
  });

  it('with an idempotency key, passes it as a request option', async () => {
    mockCreate.mockResolvedValue({ id: 'cus_3', object: 'customer', livemode: false });
    await service().findOrCreatePlatformCustomer({
      email: 'a@example.com',
      name: 'Ann',
      metadata: { product: 'business_os_plan' },
      idempotencyKey: 'bos-customer:abc',
    });
    expect(mockCreate.mock.calls).toEqual([
      [{ email: 'a@example.com', name: 'Ann', metadata: { product: 'business_os_plan' } }, { idempotencyKey: 'bos-customer:abc' }],
    ]);
  });

  it('without a key, calls create with ONE argument (exactly the agent-platform call)', async () => {
    mockCreate.mockResolvedValue({ id: 'cus_4', object: 'customer', livemode: false });
    await service().findOrCreatePlatformCustomer({ existingCustomerId: null, email: 'a@example.com', metadata: {} });
    expect(mockCreate.mock.calls[0]).toHaveLength(1);
    expect(mockRetrieve).not.toHaveBeenCalled();
  });

  it('a create error rejects', async () => {
    mockCreate.mockRejectedValue(new Error('boom'));
    await expect(service().findOrCreatePlatformCustomer({ email: 'a@example.com', metadata: {} })).rejects.toThrow('boom');
  });
});

describe('source guards (CLAUDE.md § Logging, P2-C5)', () => {
  const source = readFileSync(join(process.cwd(), 'lib', 'stripe', 'StripeService.ts'), 'utf8');

  it('StripeService.ts holds no console.* call', () => {
    expect(source).not.toMatch(/\bconsole\.\w+\(/);
  });

  it('findOrCreatePlatformCustomer takes no database client and touches no table', () => {
    const start = source.indexOf('async findOrCreatePlatformCustomer(');
    const end = source.indexOf('async getOrCreateCustomer(');
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const body = source.slice(start, end);
    expect(body).not.toMatch(/SupabaseClient|\.from\(/);
  });
});
