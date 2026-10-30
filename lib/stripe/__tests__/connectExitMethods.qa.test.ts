/**
 * QA (D5 / SX-5, 2026-10-30): the three StripeService methods the Connect
 * delete relies on. Stripe answers are hand-built. What matters: the kind is
 * read from Stripe's own object, deauthorize sends exactly our account id and
 * the given client id, delete reports `deleted` only on a literal `true`, and
 * Stripe's errors pass through unchanged for `connectRelease` to classify.
 */

const mockRetrieve = jest.fn();
const mockDel = jest.fn();
const mockDeauthorize = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    accounts: {
      retrieve: (...args: unknown[]) => mockRetrieve(...args),
      del: (...args: unknown[]) => mockDel(...args),
    },
    oauth: { deauthorize: (...args: unknown[]) => mockDeauthorize(...args) },
  }))
);

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  logger.child = () => logger;
  return { createLogger: () => logger };
});

import { StripeService } from '@/lib/stripe/StripeService';

const service = () => new StripeService('sk_test_unit');
const ACCOUNT = 'acct_1QaStripeShape';

beforeEach(() => jest.clearAllMocks());

describe('retrieveConnectedAccountKind', () => {
  it.each([
    ['type standard', { id: ACCOUNT, type: 'standard' }, 'standard'],
    ['controller.type account (no type)', { id: ACCOUNT, controller: { type: 'account' } }, 'standard'],
    ['type express', { id: ACCOUNT, type: 'express', controller: { type: 'application' } }, 'platform'],
    ['type custom', { id: ACCOUNT, type: 'custom' }, 'platform'],
    ['type none, platform controller', { id: ACCOUNT, type: 'none', controller: { type: 'application' } }, 'platform'],
    ['a deleted object', { id: ACCOUNT, deleted: true }, 'deleted'],
    ['deleted:"true" as a string is not deleted', { id: ACCOUNT, deleted: 'true', type: 'express' }, 'platform'],
  ])('%s → %s', async (_label, answer, kind) => {
    mockRetrieve.mockResolvedValue(answer);
    await expect(service().retrieveConnectedAccountKind(ACCOUNT)).resolves.toBe(kind);
    expect(mockRetrieve).toHaveBeenCalledWith(ACCOUNT);
  });

  it('a Stripe error passes through unchanged', async () => {
    const error = Object.assign(new Error('boom'), { type: 'StripeConnectionError' });
    mockRetrieve.mockRejectedValue(error);
    await expect(service().retrieveConnectedAccountKind(ACCOUNT)).rejects.toBe(error);
  });
});

describe('deauthorizeConnectedAccount', () => {
  it('sends exactly { client_id, stripe_user_id } and returns the echoed id', async () => {
    mockDeauthorize.mockResolvedValue({ stripe_user_id: ACCOUNT });
    await expect(service().deauthorizeConnectedAccount({ clientId: 'ca_x', accountId: ACCOUNT })).resolves.toEqual({ stripeUserId: ACCOUNT });
    expect(mockDeauthorize).toHaveBeenCalledWith({ client_id: 'ca_x', stripe_user_id: ACCOUNT });
  });
});

describe('deleteConnectedAccount', () => {
  it('reports deleted only on a literal true', async () => {
    mockDel.mockResolvedValueOnce({ id: ACCOUNT, deleted: true });
    await expect(service().deleteConnectedAccount(ACCOUNT)).resolves.toEqual({ id: ACCOUNT, deleted: true });
    mockDel.mockResolvedValueOnce({ id: ACCOUNT, deleted: 'yes' });
    await expect(service().deleteConnectedAccount(ACCOUNT)).resolves.toEqual({ id: ACCOUNT, deleted: false });
    mockDel.mockResolvedValueOnce({ id: ACCOUNT });
    await expect(service().deleteConnectedAccount(ACCOUNT)).resolves.toEqual({ id: ACCOUNT, deleted: false });
  });

  it('a Stripe refusal passes through unchanged', async () => {
    const error = Object.assign(new Error('balance'), { type: 'StripeInvalidRequestError', statusCode: 400 });
    mockDel.mockRejectedValue(error);
    await expect(service().deleteConnectedAccount(ACCOUNT)).rejects.toBe(error);
  });
});
