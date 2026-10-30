/**
 * releaseConnectedAccount (self-service exit SX-5 / D5; SA W-3, W-4, W-11, W-13).
 *
 * Stripe is faked through the injected deps. The error fixtures are Stripe's
 * shapes ({ type, code, statusCode }); no real Stripe call runs. The spike
 * that would have recorded the "already gone" shapes could not run (workplan
 * §14), so the shipped list is empty and every retrieve error must refuse.
 */

import {
  ALREADY_GONE_ON_RETRIEVE,
  releaseConnectedAccount,
  stripeErrorFacts,
  type ConnectReleaseDeps,
} from '@/lib/business-os/account-deletion/connectRelease';

const ACCOUNT = 'acct_1TestAccount';

function stripeError(type: string, code: string | undefined, statusCode: number, message = 'Stripe said acct_1TestAccount and ca_secretish') {
  return Object.assign(new Error(message), { type, code, statusCode });
}

function deps(overrides: Partial<ConnectReleaseDeps> = {}): ConnectReleaseDeps & {
  retrieveKind: jest.Mock;
  deauthorize: jest.Mock;
  del: jest.Mock;
} {
  return {
    retrieveKind: jest.fn().mockResolvedValue('platform'),
    deauthorize: jest.fn().mockResolvedValue({ stripeUserId: ACCOUNT }),
    del: jest.fn().mockResolvedValue({ id: ACCOUNT, deleted: true }),
    clientId: () => 'ca_platform',
    ...overrides,
  } as ConnectReleaseDeps & { retrieveKind: jest.Mock; deauthorize: jest.Mock; del: jest.Mock };
}

describe('releaseConnectedAccount', () => {
  it('ships with no "already gone" retrieve shape (the spike could not run)', () => {
    expect(ALREADY_GONE_ON_RETRIEVE).toEqual([]);
  });

  it('Express / Custom: deleted only on { deleted: true } for the same id', async () => {
    const d = deps();
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toEqual({ kind: 'released', how: 'deleted', accountKind: 'platform' });
    expect(d.del).toHaveBeenCalledWith(ACCOUNT);
    expect(d.deauthorize).not.toHaveBeenCalled();
  });

  it('Express: a delete answer that is not a confirmed deletion refuses', async () => {
    const d = deps({ del: jest.fn().mockResolvedValue({ id: ACCOUNT, deleted: false }) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'not_available', step: 'delete' });
  });

  it('Express: Stripe refusing the delete (a balance) is stripe_refused, the honest BQ-19 answer', async () => {
    const d = deps({ del: jest.fn().mockRejectedValue(stripeError('StripeInvalidRequestError', undefined, 400)) });
    const outcome = await releaseConnectedAccount(ACCOUNT, d);
    expect(outcome).toEqual({
      kind: 'refused',
      reason: 'stripe_refused',
      step: 'delete',
      stripe: { type: 'StripeInvalidRequestError', code: null, statusCode: 400 },
    });
    // W-13: Stripe's message is never carried.
    expect(JSON.stringify(outcome)).not.toContain('Stripe said');
  });

  it('Express: a delete error never means "already gone" (W-4)', async () => {
    const d = deps({ del: jest.fn().mockRejectedValue(stripeError('StripeInvalidRequestError', 'resource_missing', 404)) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'stripe_refused' });
  });

  it('Express: permission / authentication errors are not_available', async () => {
    const d = deps({ del: jest.fn().mockRejectedValue(stripeError('StripePermissionError', 'account_invalid', 403)) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'not_available', step: 'delete' });
  });

  it.each([
    ['StripeConnectionError', undefined, 0],
    ['StripeAPIError', undefined, 500],
    ['StripeRateLimitError', 'rate_limit', 429],
  ])('a transient %s is stripe_unreachable', async (type, code, status) => {
    const d = deps({ del: jest.fn().mockRejectedValue(stripeError(type, code, status)) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'stripe_unreachable' });
  });

  it('Standard: deauthorize with OUR account id and the one STRIPE_CLIENT_ID; confirmed only on the echoed id', async () => {
    const d = deps({ retrieveKind: jest.fn().mockResolvedValue('standard') });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toEqual({ kind: 'released', how: 'deauthorized', accountKind: 'standard' });
    expect(d.deauthorize).toHaveBeenCalledWith({ clientId: 'ca_platform', accountId: ACCOUNT });
    expect(d.del).not.toHaveBeenCalled();
  });

  it('Standard: a different echoed id is not a confirmation', async () => {
    const d = deps({
      retrieveKind: jest.fn().mockResolvedValue('standard'),
      deauthorize: jest.fn().mockResolvedValue({ stripeUserId: 'acct_1Other' }),
    });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'not_available', step: 'deauthorize' });
  });

  it('Standard: a refused deauthorize is not_available, never stripe_refused (W-11)', async () => {
    const d = deps({
      retrieveKind: jest.fn().mockResolvedValue('standard'),
      deauthorize: jest.fn().mockRejectedValue(stripeError('StripeInvalidRequestError', 'invalid_client', 400)),
    });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'not_available', step: 'deauthorize' });
  });

  it('Standard: no STRIPE_CLIENT_ID → not_available with no Stripe call (W-3)', async () => {
    const d = deps({ retrieveKind: jest.fn().mockResolvedValue('standard'), clientId: () => null });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toEqual({ kind: 'refused', reason: 'not_available', step: 'config' });
    expect(d.deauthorize).not.toHaveBeenCalled();
  });

  it('a deleted object from retrieve is already gone, with no further call', async () => {
    const d = deps({ retrieveKind: jest.fn().mockResolvedValue('deleted') });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toEqual({ kind: 'released', how: 'already_gone', accountKind: 'deleted' });
    expect(d.del).not.toHaveBeenCalled();
    expect(d.deauthorize).not.toHaveBeenCalled();
  });

  it('a retrieve error is a refusal while no shape is recorded (W-4: a test key on a live id looks the same)', async () => {
    const d = deps({ retrieveKind: jest.fn().mockRejectedValue(stripeError('StripeInvalidRequestError', 'resource_missing', 404)) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'not_available', step: 'retrieve' });
    expect(d.del).not.toHaveBeenCalled();
  });

  it('a retrieve error matching a recorded shape (code AND status) is already gone; the class does not matter', async () => {
    const shapes = [{ code: 'account_invalid', statusCode: 403 }];
    const gone = deps({ alreadyGoneShapes: shapes, retrieveKind: jest.fn().mockRejectedValue(stripeError('StripePermissionError', 'account_invalid', 403)) });
    await expect(releaseConnectedAccount(ACCOUNT, gone)).resolves.toEqual({ kind: 'released', how: 'already_gone', accountKind: 'unknown' });
    const otherStatus = deps({ alreadyGoneShapes: shapes, retrieveKind: jest.fn().mockRejectedValue(stripeError('StripePermissionError', 'account_invalid', 400)) });
    await expect(releaseConnectedAccount(ACCOUNT, otherStatus)).resolves.toMatchObject({ kind: 'refused' });
  });

  it('a transient retrieve error is stripe_unreachable', async () => {
    const d = deps({ retrieveKind: jest.fn().mockRejectedValue(stripeError('StripeConnectionError', undefined, 0)) });
    await expect(releaseConnectedAccount(ACCOUNT, d)).resolves.toMatchObject({ kind: 'refused', reason: 'stripe_unreachable', step: 'retrieve' });
  });
});

describe('stripeErrorFacts', () => {
  it('reads type, code and status only', () => {
    expect(stripeErrorFacts(stripeError('StripeInvalidRequestError', 'x', 400))).toEqual({ type: 'StripeInvalidRequestError', code: 'x', statusCode: 400 });
    expect(stripeErrorFacts('boom')).toEqual({ type: null, code: null, statusCode: null });
  });
});
