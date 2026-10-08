/**
 * The boost checkout orchestration (credits boost slice 3, workplan §3.2; SA
 * R-1, R-10, C-2, C-3; slice 1 QA E-2; slice 2 §3.4b). Every dependency is
 * faked, so every branch runs without HTTP, a database or Stripe.
 */

import type Stripe from 'stripe';

import {
  runBoostCheckout,
  BOOST_CHECKOUT_REFUSAL_STATUS,
  isDefiniteStripeRejection,
  stripeErrorFacts,
  type BoostCheckoutDeps,
} from '@/lib/business-os/boost/boostCheckout';

/** A Stripe SDK error stand-in: every Stripe error carries its class name as `type`. */
const stripeError = (type: string) => Object.assign(new Error(type), { type });
import type { BoostPackage } from '@/lib/business-os/entitlements/boostCatalogue';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const NOW = new Date('2026-10-06T12:00:00.000Z');
const EXPIRES_AT = Math.floor(NOW.getTime() / 1000) + 1860;

const PLUS: BoostPackage = Object.freeze({
  id: 'plus',
  version: 1,
  priceMinor: 2500,
  currency: 'USD',
  taxExclusive: true,
  baseCredits: 12500,
  bonusCredits: 1250,
  totalCredits: 13750,
  bonusPercent: 10,
  active: true,
  order: 2,
  labels: { name: { en: 'Plus', he: 'Plus', es: 'Plus' }, description: { en: 'd', he: 'd', es: 'd' }, badge: null },
  retailVersion: 1,
  creditValueVersion: 1,
}) as BoostPackage;

function session(overrides: Partial<Stripe.Checkout.Session> = {}): Stripe.Checkout.Session {
  return {
    id: 'cs_test_one',
    livemode: false,
    amount_subtotal: 2500,
    currency: 'usd',
    client_reference_id: PURCHASE,
    client_secret: 'cs_test_one_secret_abc',
    expires_at: EXPIRES_AT,
    ...overrides,
  } as Stripe.Checkout.Session;
}

function setup(overrides: Partial<{
  hold: unknown;
  holdThrows: boolean;
  pkg: BoostPackage | null;
  pkgReject: unknown;
  mode: () => 'test' | 'live';
  stripeThrows: boolean;
  reserve: unknown;
  create: () => Promise<Stripe.Checkout.Session>;
  expire: jest.Mock;
  attach: unknown;
  abandon: unknown;
}> = {}) {
  const calls: string[] = [];
  const create = jest.fn(overrides.create ?? (async () => session()));
  const expire = overrides.expire ?? jest.fn(async () => ({ id: 'cs_test_one', status: 'expired' }));
  const reserve = jest.fn(async (input: unknown) => {
    calls.push('reserve');
    void input;
    return (overrides.reserve ?? { data: { outcome: 'reserved', purchaseId: PURCHASE, capMinor: 15000, countedMinor: 0 }, error: null }) as never;
  });
  const attachCheckout = jest.fn(async () => {
    calls.push('attach');
    return (overrides.attach ?? { data: { status: 'attached' }, error: null }) as never;
  });
  const abandon = jest.fn(async () => {
    calls.push('abandon');
    return (overrides.abandon ?? { data: { status: 'abandoned' }, error: null }) as never;
  });
  const deps: BoostCheckoutDeps = {
    holdReaders: {
      lineage: {
        findHoldFactsForAccount: jest.fn(async () => {
          if (overrides.holdThrows) throw new Error('db down');
          return (overrides.hold ?? { data: null, error: null }) as never;
        }),
      },
      invites: { findHoldFactsById: jest.fn() as never },
    },
    packageSource: {
      listActive: jest.fn(),
      getActive: jest.fn(async () => {
        if (overrides.pkgReject !== undefined) throw overrides.pkgReject;
        return overrides.pkg === undefined ? PLUS : overrides.pkg;
      }),
    },
    cap: { amountMinor: 15000, currency: 'USD', windowDays: 30 },
    repo: { reserve, attachCheckout, abandon } as never,
    stripe: () => {
      if (overrides.stripeThrows) throw new Error('stripe_key_missing');
      return { checkout: { sessions: { create: async (...args: unknown[]) => { calls.push('create'); return create(...(args as [])); }, expire } } } as never;
    },
    mode: overrides.mode ?? (() => 'test'),
    now: () => NOW,
  };
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return { deps, log, calls, reserve, attachCheckout, abandon, create, expire };
}

const INPUT = { accountId: ACCOUNT, email: 'owner@example.com', packageId: 'plus', returnUrl: 'https://app.example.com/business-os?boost=return&session_id={CHECKOUT_SESSION_ID}' };

describe('the happy path', () => {
  it('reserves, creates, attaches in that order and returns the client secret', async () => {
    const { deps, log, calls, reserve, attachCheckout } = setup();
    const outcome = await runBoostCheckout(deps, INPUT, log);
    expect(outcome).toEqual({
      ok: true,
      purchaseId: PURCHASE,
      clientSecret: 'cs_test_one_secret_abc',
      expiresAt: new Date(EXPIRES_AT * 1000).toISOString(),
      packageId: 'plus',
      packageVersion: 1,
      priceMinor: 2500,
      currency: 'USD',
      livemode: false,
    });
    expect(calls).toEqual(['reserve', 'create', 'attach']);
    expect(reserve).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      livemode: false,
      packageId: 'plus',
      packageVersion: 1,
      retailVersion: 1,
      creditValueVersion: 1,
      priceMinor: 2500,
      currency: 'USD',
      creditsBase: 12500,
      creditsBonus: 1250,
      defaultCapMinor: 15000,
      windowDays: 30,
      checkoutTtlSeconds: 1860,
    });
    expect(attachCheckout).toHaveBeenCalledWith({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: 'cs_test_one', checkoutExpiresAt: new Date(EXPIRES_AT * 1000).toISOString() });
    expect(JSON.stringify(log.info.mock.calls)).not.toContain('secret');
  });

  it('live mode from the key is reserved as live (R-10)', async () => {
    const { deps, log, reserve } = setup({ mode: () => 'live', create: async () => session({ livemode: true }) });
    expect((await runBoostCheckout(deps, INPUT, log)).ok).toBe(true);
    expect(reserve.mock.calls[0][0]).toMatchObject({ livemode: true });
  });

  it('already_attached also succeeds (an idempotent retry)', async () => {
    const { deps, log } = setup({ attach: { data: { status: 'already_attached' }, error: null } });
    expect((await runBoostCheckout(deps, INPUT, log)).ok).toBe(true);
  });
});

describe('refusals before the reservation write nothing', () => {
  it.each([
    ['held account', { hold: { data: { source: 'account_invite', first_paid_at: null, invite_id: null }, error: null } }, 'awaiting_payment'],
    ['unreadable hold', { hold: { data: null, error: new Error('read failed') } }, 'payment_hold_check_failed'],
    ['hold read throws', { holdThrows: true }, 'payment_hold_check_failed'],
    ['unknown or inactive package', { pkg: null }, 'unknown_package'],
    ['catalogue rejects with a plain Error (QA E-2)', { pkgReject: new Error('boom') }, 'catalogue_unavailable'],
    ['catalogue rejects as invalid', { pkgReject: Object.assign(new Error('invalid'), { issues: ['x'] }) }, 'catalogue_unavailable'],
    ['bad Stripe key mode', { mode: () => { throw new Error('stripe_key_mode_unknown'); } }, 'payments_unavailable'],
    ['missing Stripe key', { stripeThrows: true }, 'payments_unavailable'],
  ] as const)('%s → %s', async (_name, overrides, error) => {
    const { deps, log, reserve, create } = setup(overrides as never);
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error });
    expect(reserve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    ['no plan row', { data: { outcome: 'no_plan_row' }, error: null }, 'not_eligible'],
    ['cap reached', { data: { outcome: 'cap_reached', capMinor: 15000, countedMinor: 15000 }, error: null }, 'cap_reached'],
    ['reservation error (deterministic, N-1 / I-3)', { data: null, error: new Error('22023') }, 'reservation_failed'],
  ] as const)('%s → %s, with no Stripe call and nothing to release', async (_name, reserveResult, error) => {
    const { deps, log, create, abandon } = setup({ reserve: reserveResult });
    expect(await runBoostCheckout(deps, INPUT, log)).toMatchObject({ ok: false, error });
    expect(create).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('5b SA C-5: cap_reached carries the cap (an override included) and its window, never the counted amount', async () => {
    const { deps, log } = setup({ reserve: { data: { outcome: 'cap_reached', capMinor: 30000, countedMinor: 29000 }, error: null } });
    const outcome = await runBoostCheckout(deps, INPUT, log);
    expect(outcome).toEqual({ ok: false, error: 'cap_reached', cap: { capMinor: 30000, windowDays: deps.cap.windowDays } });
    expect(JSON.stringify(outcome)).not.toContain('29000');
  });

  it('5b SA C-5: no other refusal carries cap figures', async () => {
    const { deps, log } = setup({ reserve: { data: { outcome: 'no_plan_row' }, error: null } });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'not_eligible' });
  });

  it('Q-7: cap_reached is a warn with the counted amount and no email', async () => {
    const { deps, log } = setup({ reserve: { data: { outcome: 'cap_reached', capMinor: 15000, countedMinor: 14000 }, error: null } });
    await runBoostCheckout(deps, INPUT, log);
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ code: 'cap_reached', countedMinor: 14000 }), 'bos_boost_checkout_refused');
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('owner@example.com');
  });

  it('every refusal maps to a status', () => {
    expect(BOOST_CHECKOUT_REFUSAL_STATUS).toEqual({
      payment_hold_check_failed: 500,
      awaiting_payment: 409,
      catalogue_unavailable: 503,
      unknown_package: 404,
      payments_unavailable: 500,
      not_eligible: 403,
      cap_reached: 409,
      reservation_failed: 500,
      checkout_unavailable: 502,
    });
  });
});

describe('SA C-2: after the reservation, never abandon while a session may be payable', () => {
  it.each(['StripeInvalidRequestError', 'StripeAuthenticationError', 'StripePermissionError', 'StripeRateLimitError', 'StripeCardError'])(
    'CR-1: a definite rejection (%s) → nothing created, so the reservation is abandoned with no retry',
    async (type) => {
      const { deps, log, abandon, expire, create } = setup({ create: async () => { throw stripeError(type); } });
      expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
      expect(create).toHaveBeenCalledTimes(1);
      expect(expire).not.toHaveBeenCalled();
      expect(abandon).toHaveBeenCalledWith({ accountId: ACCOUNT, purchaseId: PURCHASE });
    }
  );

  it('CR-1: a connection error, then a session on the retry with the same key → expire it, then abandon', async () => {
    let calls = 0;
    const { deps, log, abandon, expire, create } = setup({
      create: async () => {
        calls += 1;
        if (calls === 1) throw stripeError('StripeConnectionError');
        return session();
      },
    });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]).toEqual(create.mock.calls[1]);
    expect(expire).toHaveBeenCalledWith('cs_test_one');
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('CR-1: an unknown error twice (timeout, 5xx) → the row stays pending and bos_boost_session_unknown alerts', async () => {
    const { deps, log, abandon, expire, create } = setup({ create: async () => { throw stripeError('StripeAPIError'); } });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(expire).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ alert: true, purchaseId: PURCHASE }), 'bos_boost_session_unknown');
  });

  it('CR-1: a plain Error with no Stripe type is indeterminate, never a definite rejection', () => {
    expect(isDefiniteStripeRejection(new Error('socket hang up'))).toBe(false);
    expect(isDefiniteStripeRejection(stripeError('StripeConnectionError'))).toBe(false);
    expect(isDefiniteStripeRejection(stripeError('StripeIdempotencyError'))).toBe(false);
    expect(isDefiniteStripeRejection(stripeError('StripeInvalidRequestError'))).toBe(true);
    expect(isDefiniteStripeRejection(null)).toBe(false);
  });

  it.each([
    ['the mode differs', { livemode: true }],
    ['the amount differs', { amount_subtotal: 2400 }],
    ['the currency differs', { currency: 'eur' }],
    ['the reference differs', { client_reference_id: 'someone-else' }],
    ['no client secret', { client_secret: null }],
  ] as const)('a session cross-check fails (%s) → expire, then abandon', async (_name, patch) => {
    const { deps, log, abandon, expire, calls } = setup({ create: async () => session(patch as never) });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(expire).toHaveBeenCalledWith('cs_test_one');
    expect(abandon).toHaveBeenCalled();
    expect(calls).not.toContain('attach');
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ purchaseId: PURCHASE, sessionId: 'cs_test_one' }), 'bos_boost_session_mismatch');
  });

  it.each([
    ['session held by another purchase (23505)', { data: null, error: new Error('boost_checkout_session_in_use') }],
    ['reservation expired', { data: { status: 'reservation_expired' }, error: null }],
    ['session conflict', { data: { status: 'session_conflict' }, error: null }],
    ['not pending', { data: { status: 'not_pending' }, error: null }],
    ['attach error', { data: null, error: new Error('db down') }],
  ] as const)('attach fails (%s) → expire the session, then abandon', async (_name, attach) => {
    const { deps, log, abandon, expire, calls } = setup({ attach });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledTimes(1);
    expect(calls.indexOf('abandon')).toBeGreaterThan(calls.indexOf('attach'));
  });

  it('expire fails once, succeeds on the retry → abandon', async () => {
    const expire = jest.fn().mockRejectedValueOnce(new Error('blip')).mockResolvedValueOnce({ id: 'cs_test_one' });
    const { deps, log, abandon } = setup({ attach: { data: { status: 'reservation_expired' }, error: null }, expire });
    await runBoostCheckout(deps, INPUT, log);
    expect(expire).toHaveBeenCalledTimes(2);
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('expire fails twice → the row stays pending (no abandon) and an orphan alert names both ids', async () => {
    const expire = jest.fn().mockRejectedValue(new Error('stripe down'));
    const { deps, log, abandon } = setup({ attach: { data: { status: 'reservation_expired' }, error: null }, expire });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(expire).toHaveBeenCalledTimes(2);
    expect(abandon).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ alert: true, purchaseId: PURCHASE, sessionId: 'cs_test_one' }, 'bos_boost_orphan_session');
  });

  it('abandon failing or throwing is logged and never changes the answer', async () => {
    const failing = setup({ create: async () => { throw stripeError('StripeInvalidRequestError'); }, abandon: { data: null, error: new Error('db') } });
    expect(await runBoostCheckout(failing.deps, INPUT, failing.log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(failing.log.error).toHaveBeenCalledWith(expect.objectContaining({ purchaseId: PURCHASE }), 'bos_boost_abandon_failed');

    const throwing = setup({ create: async () => { throw stripeError('StripeInvalidRequestError'); } });
    (throwing.deps.repo.abandon as jest.Mock).mockRejectedValueOnce(new Error('network'));
    expect(await runBoostCheckout(throwing.deps, INPUT, throwing.log)).toEqual({ ok: false, error: 'checkout_unavailable' });
  });
});

describe('QA follow-ups (R-1 to R-4)', () => {
  it('R-1 (QA3-D1): a reserve that throws is reservation_failed, with no Stripe call', async () => {
    const { deps, log, create, abandon } = setup();
    (deps.repo.reserve as jest.Mock).mockRejectedValueOnce(new Error('network'));
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'reservation_failed' });
    expect(create).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
  });

  it('R-1 (QA3-D1): an attach that throws expires the session, then abandons', async () => {
    const { deps, log, expire, abandon } = setup();
    (deps.repo.attachCheckout as jest.Mock).mockRejectedValueOnce(new Error('network'));
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(expire).toHaveBeenCalledWith('cs_test_one');
    expect(abandon).toHaveBeenCalledTimes(1);
  });

  it('R-1 (QA3-D1): an attach that throws and an expire that fails twice → orphan alert, no abandon', async () => {
    const expire = jest.fn().mockRejectedValue(stripeError('StripeConnectionError'));
    const { deps, log, abandon } = setup({ expire });
    (deps.repo.attachCheckout as jest.Mock).mockRejectedValueOnce(new Error('network'));
    await runBoostCheckout(deps, INPUT, log);
    expect(abandon).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith({ alert: true, purchaseId: PURCHASE, sessionId: 'cs_test_one' }, 'bos_boost_orphan_session');
  });

  it('R-2 (QA3-D2): a Stripe error whose message names the email never puts the email in any log line', async () => {
    const leaky = () =>
      Object.assign(new Error('Invalid email: owner@example.com'), {
        type: 'StripeConnectionError',
        code: 'email_invalid',
        param: 'customer_email',
        requestId: 'req_1',
        statusCode: 500,
        raw: { message: 'owner@example.com' },
      });
    const expire = jest.fn().mockRejectedValue(leaky());
    const { deps, log } = setup({ create: async () => { throw leaky(); }, expire });
    await runBoostCheckout(deps, INPUT, log);
    const all = JSON.stringify([...log.info.mock.calls, ...log.warn.mock.calls, ...log.error.mock.calls]);
    expect(all).not.toContain('owner@example.com');
    expect(all).toContain('req_1');
    expect(stripeErrorFacts(leaky())).toEqual({ type: 'StripeConnectionError', code: 'email_invalid', param: 'customer_email', requestId: 'req_1', statusCode: 500 });
  });

  it('R-2: expire failures are logged as facts only', async () => {
    const leaky = Object.assign(new Error('owner@example.com'), { type: 'StripeAPIError' });
    const expire = jest.fn().mockRejectedValue(leaky);
    const { deps, log } = setup({ attach: { data: { status: 'reservation_expired' }, error: null }, expire });
    await runBoostCheckout(deps, INPUT, log);
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain('owner@example.com');
  });

  it('R-3: an indeterminate create, then a DEFINITE rejection on the retry → still pending + alert (the first attempt may have made a session)', async () => {
    let calls = 0;
    const { deps, log, abandon, expire, create } = setup({
      create: async () => {
        calls += 1;
        throw stripeError(calls === 1 ? 'StripeConnectionError' : 'StripeInvalidRequestError');
      },
    });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(create).toHaveBeenCalledTimes(2);
    expect(expire).not.toHaveBeenCalled();
    expect(abandon).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ alert: true, purchaseId: PURCHASE }), 'bos_boost_session_unknown');
  });

  it.each([
    ['currency upper case', { currency: 'USD' }],
    ['subtotal missing', { amount_subtotal: null }],
    ['no expiry', { expires_at: null }],
  ] as const)('R-4: a session with %s is a mismatch → expire, then abandon', async (_name, patch) => {
    const { deps, log, expire, abandon } = setup({ create: async () => session(patch as never) });
    expect(await runBoostCheckout(deps, INPUT, log)).toEqual({ ok: false, error: 'checkout_unavailable' });
    expect(expire).toHaveBeenCalledTimes(1);
    expect(abandon).toHaveBeenCalledTimes(1);
  });
});
