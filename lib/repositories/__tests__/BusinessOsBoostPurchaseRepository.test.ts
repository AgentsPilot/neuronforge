/**
 * Unit tests for BusinessOsBoostPurchaseRepository (credits boost slice 2a;
 * workplan §3.6 and §7.2, SA conditions C-1, C-2, C-5).
 *
 * What matters here: every RPC gets exactly its typed arguments, built field by
 * field (tenant-isolation-guard Step 3); the RPC row is mapped strictly —
 * exactly one row, a known status, parsable figures, never a 0 or a guessed
 * status; a NaN never reaches the database as JSON null; scoped reads add
 * `user_id` and an explicit column list; the two webhook finders are unscoped
 * by design and only the Stripe webhook route and the reconcile cron route may
 * name them; nothing is ever thrown; and no write bypasses the functions.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { marker: 'service-role-default' } }));
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

import {
  BOOST_CAP_OVERRIDE_COLUMNS,
  BOOST_PURCHASE_COLUMNS,
  BOOST_PURCHASE_READ_LIMITS,
  BOS_ABANDON_BOOST_PURCHASE_RPC,
  BOS_ATTACH_BOOST_CHECKOUT_RPC,
  BOS_END_BOOST_CAP_OVERRIDE_RPC,
  BOS_RESERVE_BOOST_PURCHASE_RPC,
  BOS_SET_BOOST_CAP_OVERRIDE_RPC,
  BOS_CREDIT_BOOST_PURCHASE_RPC,
  BOS_TRANSITION_BOOST_PURCHASE_RPC,
  BOS_RECORD_BOOST_RECEIPT_RPC,
  BOOST_FLAG_REASONS,
  BOOST_SESSION_IN_USE_ERROR,
  BusinessOsBoostPurchaseRepository,
  businessOsBoostPurchaseRepository,
  BoostRepositoryFailure,
  isAnomalousRepositoryError,
  isDeterministicRepositoryError,
  isDeterministicSqlState,
  type BusinessOsBoostReservationInput,
  type BusinessOsBoostCreditInput,
  type BusinessOsBoostTransitionInput,
  type BusinessOsBoostTransitionTarget,
} from '@/lib/repositories/BusinessOsBoostPurchaseRepository';

const ACCOUNT = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';
const PURCHASE = '44444444-4444-4444-8444-444444444444';
const OVERRIDE = '55555555-5555-4555-8555-555555555555';
const PREVIOUS = '55555555-5555-4555-8555-555555555556';
const SESSION = 'cs_test_a1b2c3d4e5f6';
/** A checkout expiry 30 minutes out, inside the window attach accepts (SA CR-3). */
const EXPIRES = new Date(Date.now() + 30 * 60 * 1000).toISOString();

const RESERVATION: BusinessOsBoostReservationInput = {
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
  checkoutTtlSeconds: 1800,
};

const EXPECTED_RESERVE_ARGS = {
  p_user_id: ACCOUNT,
  p_livemode: false,
  p_package_id: 'plus',
  p_package_version: 1,
  p_retail_version: 1,
  p_credit_value_version: 1,
  p_price_minor: 2500,
  p_currency: 'USD',
  p_credits_base: 12500,
  p_credits_bonus: 1250,
  p_default_cap_minor: 15000,
  p_window_days: 30,
  p_checkout_ttl_seconds: 1800,
};

const PURCHASE_ROW: Record<string, unknown> = {
  id: PURCHASE,
  user_id: ACCOUNT,
  livemode: false,
  status: 'pending',
  package_id: 'plus',
  package_version: 1,
  retail_version: 1,
  credit_value_version: 1,
  price_minor: 2500,
  currency: 'USD',
  tax_exclusive: true,
  credits_base: '12500.000000',
  credits_bonus: '1250.000000',
  credits_total: '13750.000000',
  checkout_expires_at: '2026-10-05T12:30:00+00:00',
  stripe_checkout_session_id: SESSION,
  stripe_payment_intent_id: null,
  stripe_charge_id: null,
  receipt_url: null,
  amount_subtotal_minor: null,
  amount_tax_minor: null,
  amount_total_minor: null,
  amount_refunded_minor: 0,
  stripe_dispute_id: null,
  flag_reason: null,
  lot_id: null,
  paid_at: null,
  status_changed_at: '2026-10-05T12:00:00+00:00',
  created_at: '2026-10-05T12:00:00+00:00',
  updated_at: '2026-10-05T12:00:00+00:00',
};

/** A client whose `rpc()` resolves to `outcome` (or rejects with it). `from()` is refused: writes are RPCs. */
function rpcClient(outcome: { data: unknown; error: unknown } | Error) {
  const recorded: { rpc?: [string, Record<string, unknown>] } = {};
  const client = {
    rpc: jest.fn((fn: string, args: Record<string, unknown>) => {
      recorded.rpc = [fn, args];
      return outcome instanceof Error ? Promise.reject(outcome) : Promise.resolve(outcome);
    }),
    from: jest.fn(() => {
      throw new Error('a write must not use from()');
    }),
  };
  return { repo: new BusinessOsBoostPurchaseRepository(client as unknown as SupabaseClient), client, recorded };
}

/** A read chain that records every call and resolves to `outcome` from maybeSingle() / range(). */
function readClient(outcome: { data: unknown; error: unknown }) {
  const calls: Array<[string, unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'is', 'order', 'in', 'lt']) {
    chain[name] = (...args: unknown[]) => {
      calls.push([name, args]);
      return chain;
    };
  }
  chain.maybeSingle = () => {
    calls.push(['maybeSingle', []]);
    return Promise.resolve(outcome);
  };
  chain.range = (...args: unknown[]) => {
    calls.push(['range', args]);
    return Promise.resolve(outcome);
  };
  const client = {
    from: jest.fn((table: string) => {
      calls.push(['from', [table]]);
      return chain;
    }),
    rpc: jest.fn(() => {
      throw new Error('a read must not use rpc()');
    }),
  };
  return { repo: new BusinessOsBoostPurchaseRepository(client as unknown as SupabaseClient), calls };
}

beforeEach(() => mockWarn.mockReset());

describe('reserve', () => {
  it('sends exactly the typed arguments, field by field (an injected property never reaches the RPC)', async () => {
    const { repo, recorded } = rpcClient({ data: [{ out_status: 'reserved', out_purchase_id: PURCHASE, out_cap_minor: 15000, out_counted_minor: '2500' }], error: null });
    const injected = { ...RESERVATION, user_id: 'ATTACKER', p_user_id: 'ATTACKER', status: 'paid' } as unknown as BusinessOsBoostReservationInput;
    const result = await repo.reserve(injected);
    expect(recorded.rpc).toEqual([BOS_RESERVE_BOOST_PURCHASE_RPC, EXPECTED_RESERVE_ARGS]);
    expect(result).toEqual({ data: { outcome: 'reserved', purchaseId: PURCHASE, capMinor: 15000, countedMinor: 2500 }, error: null });
  });

  it('maps cap_reached with the cap and the counted sum, and no_plan_row', async () => {
    expect(
      (await rpcClient({ data: [{ out_status: 'cap_reached', out_purchase_id: null, out_cap_minor: 15000, out_counted_minor: 15000 }], error: null }).repo.reserve(RESERVATION)).data
    ).toEqual({ outcome: 'cap_reached', capMinor: 15000, countedMinor: 15000 });
    expect(
      (await rpcClient({ data: [{ out_status: 'no_plan_row', out_purchase_id: null, out_cap_minor: null, out_counted_minor: null }], error: null }).repo.reserve(RESERVATION)).data
    ).toEqual({ outcome: 'no_plan_row' });
  });

  it('an unknown status, an unreadable figure or not exactly one row is an error, never a guess', async () => {
    for (const data of [
      [{ out_status: 'maybe', out_purchase_id: PURCHASE, out_cap_minor: 1, out_counted_minor: 0 }],
      [{ out_status: 'reserved', out_purchase_id: PURCHASE, out_cap_minor: 'lots', out_counted_minor: 0 }],
      [{ out_status: 'reserved', out_purchase_id: 'nope', out_cap_minor: 1, out_counted_minor: 0 }],
      [],
      null,
    ]) {
      const result = await rpcClient({ data, error: null }).repo.reserve(RESERVATION);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('a NaN figure, a bad account id or a non-boolean mode never reaches the RPC', async () => {
    for (const input of [
      { ...RESERVATION, creditsBase: Number.NaN },
      { ...RESERVATION, priceMinor: Number.POSITIVE_INFINITY },
      { ...RESERVATION, accountId: 'not-a-uuid' },
      { ...RESERVATION, livemode: 'false' as unknown as boolean },
    ]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      const result = await repo.reserve(input);
      expect(client.rpc).not.toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('a database error or a rejected promise is returned, never thrown, and logged without the error object', async () => {
    const dbError = { code: '22023', message: 'out of range', details: 'secret row' };
    const result = await rpcClient({ data: null, error: dbError }).repo.reserve(RESERVATION);
    expect(result).toEqual({ data: null, error: new Error('out of range') });
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ method: 'reserve', sqlstate: '22023' }), expect.any(String));
    expect(JSON.stringify(mockWarn.mock.calls)).not.toContain('secret row');
    await expect(rpcClient(new Error('network')).repo.reserve(RESERVATION)).resolves.toEqual({ data: null, error: new Error('network') });
  });
});

describe('attachCheckout and abandon', () => {
  it('attach sends its four arguments and maps each of the six statuses', async () => {
    for (const status of ['attached', 'already_attached', 'session_conflict', 'not_pending', 'reservation_expired', 'not_found']) {
      const { repo, recorded } = rpcClient({ data: [{ out_status: status }], error: null });
      const result = await repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: SESSION, checkoutExpiresAt: EXPIRES });
      expect(recorded.rpc).toEqual([
        BOS_ATTACH_BOOST_CHECKOUT_RPC,
        { p_user_id: ACCOUNT, p_purchase_id: PURCHASE, p_session_id: SESSION, p_checkout_expires_at: EXPIRES },
      ]);
      expect(result).toEqual({ data: { status }, error: null });
    }
  });

  it('SA C-2: attach refuses a session id over 194 characters or without cs_ before calling the RPC', async () => {
    for (const sessionId of [`cs_${'a'.repeat(192)}`, 'pi_test_1', '']) {
      const { repo, client } = rpcClient({ data: [{ out_status: 'attached' }], error: null });
      const result = await repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId, checkoutExpiresAt: EXPIRES });
      expect(client.rpc).not.toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(Error);
    }
    const ok = rpcClient({ data: [{ out_status: 'attached' }], error: null });
    await ok.repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: `cs_${'a'.repeat(191)}`, checkoutExpiresAt: EXPIRES });
    expect(ok.client.rpc).toHaveBeenCalled();
  });

  it('SA CR-3: attach refuses an expiry at or before now, or more than 24 h 5 min ahead, before calling the RPC', async () => {
    const now = Date.now();
    for (const at of [now - 1000, now - 60 * 60 * 1000, now + (24 * 60 + 6) * 60 * 1000]) {
      const { repo, client } = rpcClient({ data: [{ out_status: 'attached' }], error: null });
      const result = await repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: SESSION, checkoutExpiresAt: new Date(at).toISOString() });
      expect(client.rpc).not.toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(Error);
    }
    const edge = rpcClient({ data: [{ out_status: 'attached' }], error: null });
    await edge.repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: SESSION, checkoutExpiresAt: new Date(now + 24 * 60 * 60 * 1000).toISOString() });
    expect(edge.client.rpc).toHaveBeenCalled();
  });

  it('QA R-7: a session another purchase already holds (23505) is a refusal error, never a throw', async () => {
    const { repo } = rpcClient({ data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } });
    const result = await repo.attachCheckout({ accountId: ACCOUNT, purchaseId: PURCHASE, sessionId: SESSION, checkoutExpiresAt: EXPIRES });
    expect(result).toEqual({ data: null, error: new Error(BOOST_SESSION_IN_USE_ERROR) });
    expect(mockWarn).toHaveBeenCalledWith(expect.objectContaining({ method: 'attachCheckout', sqlstate: '23505' }), expect.any(String));
  });

  it('abandon sends its two arguments and maps each of the five statuses; an unknown one is an error', async () => {
    for (const status of ['abandoned', 'already_abandoned', 'has_session', 'not_pending', 'not_found']) {
      const { repo, recorded } = rpcClient({ data: [{ out_status: status }], error: null });
      expect(await repo.abandon({ accountId: ACCOUNT, purchaseId: PURCHASE })).toEqual({ data: { status }, error: null });
      expect(recorded.rpc).toEqual([BOS_ABANDON_BOOST_PURCHASE_RPC, { p_user_id: ACCOUNT, p_purchase_id: PURCHASE }]);
    }
    expect((await rpcClient({ data: [{ out_status: 'gone' }], error: null }).repo.abandon({ accountId: ACCOUNT, purchaseId: PURCHASE })).error).toBeInstanceOf(Error);
  });
});

describe('cap overrides', () => {
  it('set sends its five arguments and maps set (with the replaced override) and no_plan_row', async () => {
    const { repo, recorded } = rpcClient({ data: [{ out_status: 'set', out_override_id: OVERRIDE, out_previous_override_id: PREVIOUS }], error: null });
    const result = await repo.setCapOverride({ accountId: ACCOUNT, capMinor: 30000, currency: 'USD', reason: 'Verified business', actorAdminId: ADMIN });
    expect(recorded.rpc).toEqual([
      BOS_SET_BOOST_CAP_OVERRIDE_RPC,
      { p_user_id: ACCOUNT, p_cap_minor: 30000, p_currency: 'USD', p_reason: 'Verified business', p_actor_admin_id: ADMIN },
    ]);
    expect(result.data).toEqual({ outcome: 'set', overrideId: OVERRIDE, previousOverrideId: PREVIOUS });
    expect(
      (await rpcClient({ data: [{ out_status: 'no_plan_row', out_override_id: null, out_previous_override_id: null }], error: null }).repo.setCapOverride({
        accountId: ACCOUNT, capMinor: 30000, currency: 'USD', reason: 'Verified business', actorAdminId: ADMIN,
      })).data
    ).toEqual({ outcome: 'no_plan_row' });
  });

  it('set refuses a non-integer or non-positive cap and a missing admin before calling the RPC', async () => {
    for (const input of [
      { capMinor: 0, actorAdminId: ADMIN },
      { capMinor: 10.5, actorAdminId: ADMIN },
      { capMinor: 30000, actorAdminId: 'nobody' },
    ]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      const result = await repo.setCapOverride({ accountId: ACCOUNT, currency: 'USD', reason: 'Verified business', ...input });
      expect(client.rpc).not.toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('end maps ended and none_active', async () => {
    const { repo, recorded } = rpcClient({ data: [{ out_status: 'ended', out_override_id: OVERRIDE }], error: null });
    expect((await repo.endCapOverride({ accountId: ACCOUNT, actorAdminId: ADMIN, reason: 'Back to default' })).data).toEqual({ outcome: 'ended', overrideId: OVERRIDE });
    expect(recorded.rpc).toEqual([BOS_END_BOOST_CAP_OVERRIDE_RPC, { p_user_id: ACCOUNT, p_actor_admin_id: ADMIN, p_reason: 'Back to default' }]);
    expect(
      (await rpcClient({ data: [{ out_status: 'none_active', out_override_id: null }], error: null }).repo.endCapOverride({ accountId: ACCOUNT, actorAdminId: ADMIN, reason: 'Back to default' })).data
    ).toEqual({ outcome: 'none_active' });
  });
});

describe('QA-D3 (R-3): a null or undefined input resolves to { error }, never a rejection', () => {
  const methods: Array<[string, (repo: BusinessOsBoostPurchaseRepository, input: unknown) => Promise<unknown>]> = [
    ['reserve', (repo, input) => repo.reserve(input as BusinessOsBoostReservationInput)],
    ['attachCheckout', (repo, input) => repo.attachCheckout(input as Parameters<BusinessOsBoostPurchaseRepository['attachCheckout']>[0])],
    ['abandon', (repo, input) => repo.abandon(input as Parameters<BusinessOsBoostPurchaseRepository['abandon']>[0])],
    ['setCapOverride', (repo, input) => repo.setCapOverride(input as Parameters<BusinessOsBoostPurchaseRepository['setCapOverride']>[0])],
    ['endCapOverride', (repo, input) => repo.endCapOverride(input as Parameters<BusinessOsBoostPurchaseRepository['endCapOverride']>[0])],
  ];

  it.each(methods)('%s', async (_name, call) => {
    for (const input of [null, undefined]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      const result = (await call(repo, input)) as { data: unknown; error: unknown };
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });
});

describe('reads', () => {
  it('findForAccount scopes by id and user_id with the explicit column list and maps the row strictly', async () => {
    const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
    const result = await repo.findForAccount(PURCHASE, ACCOUNT);
    expect(calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['id', PURCHASE]],
      ['eq', ['user_id', ACCOUNT]],
      ['maybeSingle', []],
    ]);
    expect(result.data).toMatchObject({ id: PURCHASE, accountId: ACCOUNT, status: 'pending', creditsTotal: 13750, priceMinor: 2500, livemode: false });
  });

  it('findForAccount answers null for a missing or foreign purchase', async () => {
    expect(await readClient({ data: null, error: null }).repo.findForAccount(PURCHASE, ACCOUNT)).toEqual({ data: null, error: null });
  });

  it('an unknown status or an unreadable figure in a row is an error, never a guess or a 0', async () => {
    for (const patch of [{ status: 'refundish' }, { credits_total: 'many' }, { price_minor: 25.5 }, { livemode: 'no' }]) {
      const result = await readClient({ data: { ...PURCHASE_ROW, ...patch }, error: null }).repo.findForAccount(PURCHASE, ACCOUNT);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('the webhook finders are unscoped by design and return the row account (R-6, SA C-5)', async () => {
    const bySession = readClient({ data: PURCHASE_ROW, error: null });
    const found = await bySession.repo.findBySessionIdForWebhook(SESSION);
    expect(bySession.calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['stripe_checkout_session_id', SESSION]],
      ['maybeSingle', []],
    ]);
    expect(found.data?.accountId).toBe(ACCOUNT);

    const byIntent = readClient({ data: { ...PURCHASE_ROW, stripe_payment_intent_id: 'pi_test_1' }, error: null });
    await byIntent.repo.findByPaymentIntentIdForWebhook('pi_test_1');
    expect(byIntent.calls).toContainEqual(['eq', ['stripe_payment_intent_id', 'pi_test_1']]);
    expect(byIntent.calls.some(([name, args]) => name === 'eq' && args[0] === 'user_id')).toBe(false);
  });

  it('the webhook finders refuse an id that is not a Stripe id of the right kind', async () => {
    const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
    expect((await repo.findBySessionIdForWebhook('pi_test_1')).error).toBeInstanceOf(Error);
    expect((await repo.findByPaymentIntentIdForWebhook('cs_test_1')).error).toBeInstanceOf(Error);
    expect(calls).toEqual([]);
  });

  it('listForAccount scopes by user_id and mode, newest first, and clamps the limit', async () => {
    const { repo, calls } = readClient({ data: [PURCHASE_ROW], error: null });
    const result = await repo.listForAccount(ACCOUNT, { livemode: true, limit: 10_000 });
    expect(calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['user_id', ACCOUNT]],
      ['eq', ['livemode', true]],
      ['order', ['created_at', { ascending: false }]],
      ['range', [0, BOOST_PURCHASE_READ_LIMITS.MAX_LIST - 1]],
    ]);
    expect(result.data).toHaveLength(1);
  });

  it('findActiveCapOverride scopes by user_id and reads only the active row', async () => {
    const { repo, calls } = readClient({
      data: { id: OVERRIDE, user_id: ACCOUNT, cap_minor: 30000, currency: 'USD', reason: 'Verified business', actor_admin_id: ADMIN, created_at: '2026-10-05T12:00:00+00:00' },
      error: null,
    });
    const result = await repo.findActiveCapOverride(ACCOUNT);
    expect(calls).toEqual([
      ['from', ['business_os_boost_cap_overrides']],
      ['select', [BOOST_CAP_OVERRIDE_COLUMNS]],
      ['eq', ['user_id', ACCOUNT]],
      ['is', ['ended_at', null]],
      ['maybeSingle', []],
    ]);
    expect(result.data).toMatchObject({ id: OVERRIDE, capMinor: 30000 });
  });
});

describe('slice 2b: credit', () => {
  const CREDIT: BusinessOsBoostCreditInput = {
    purchaseId: PURCHASE,
    sessionId: SESSION,
    paymentIntentId: 'pi_test_1',
    amountSubtotalMinor: 2500,
    amountTaxMinor: 0,
    amountTotalMinor: 2500,
    currency: 'usd',
    livemode: false,
  };
  const LOT = '66666666-6666-4666-8666-666666666666';

  it('sends exactly the typed arguments, field by field, and no account id (R-6)', async () => {
    const { repo, recorded } = rpcClient({ data: [{ out_status: 'credited', out_user_id: ACCOUNT, out_lot_id: LOT, out_flag_reason: null }], error: null });
    const injected = { ...CREDIT, accountId: 'ATTACKER', p_user_id: 'ATTACKER' } as unknown as BusinessOsBoostCreditInput;
    const result = await repo.credit(injected);
    expect(recorded.rpc).toEqual([
      BOS_CREDIT_BOOST_PURCHASE_RPC,
      {
        p_purchase_id: PURCHASE,
        p_session_id: SESSION,
        p_payment_intent_id: 'pi_test_1',
        p_amount_subtotal: 2500,
        p_amount_tax: 0,
        p_amount_total: 2500,
        p_currency: 'usd',
        p_livemode: false,
      },
    ]);
    expect(result).toEqual({ data: { outcome: 'credited', accountId: ACCOUNT, lotId: LOT }, error: null });
  });

  it('maps already_credited, every flag reason, not_creditable and not_found', async () => {
    expect(
      (await rpcClient({ data: [{ out_status: 'already_credited', out_user_id: ACCOUNT, out_lot_id: LOT, out_flag_reason: null }], error: null }).repo.credit(CREDIT)).data
    ).toEqual({ outcome: 'already_credited', accountId: ACCOUNT, lotId: LOT });
    for (const reason of BOOST_FLAG_REASONS) {
      const { repo } = rpcClient({ data: [{ out_status: 'mismatch', out_user_id: reason === 'account_deleted' ? null : ACCOUNT, out_lot_id: null, out_flag_reason: reason }], error: null });
      expect((await repo.credit(CREDIT)).data).toEqual({ outcome: 'mismatch', accountId: reason === 'account_deleted' ? null : ACCOUNT, flagReason: reason });
    }
    expect(
      (await rpcClient({ data: [{ out_status: 'not_creditable', out_user_id: ACCOUNT, out_lot_id: null, out_flag_reason: null }], error: null }).repo.credit(CREDIT)).data
    ).toEqual({ outcome: 'not_creditable', accountId: ACCOUNT });
    expect(
      (await rpcClient({ data: [{ out_status: 'not_found', out_user_id: null, out_lot_id: null, out_flag_reason: null }], error: null }).repo.credit(CREDIT)).data
    ).toEqual({ outcome: 'not_found' });
  });

  it('an unknown status or flag, or credited without an account or lot, is an error, never a guess', async () => {
    for (const row of [
      { out_status: 'maybe', out_user_id: ACCOUNT, out_lot_id: LOT, out_flag_reason: null },
      { out_status: 'mismatch', out_user_id: ACCOUNT, out_lot_id: null, out_flag_reason: 'weird' },
      { out_status: 'credited', out_user_id: null, out_lot_id: LOT, out_flag_reason: null },
      { out_status: 'credited', out_user_id: ACCOUNT, out_lot_id: null, out_flag_reason: null },
    ]) {
      const result = await rpcClient({ data: [row], error: null }).repo.credit(CREDIT);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('a database error is { error } (4a then throws to release the claim, HP-1)', async () => {
    const result = await rpcClient({ data: null, error: { code: '40001', message: 'serialization failure' } }).repo.credit(CREDIT);
    expect(result).toEqual({ data: null, error: new Error('serialization failure') });
  });

  it('bad input never reaches the RPC', async () => {
    for (const input of [
      { ...CREDIT, purchaseId: 'nope' },
      { ...CREDIT, sessionId: 'pi_x' },
      { ...CREDIT, paymentIntentId: 'cs_x' },
      { ...CREDIT, amountTaxMinor: -1 },
      { ...CREDIT, amountSubtotalMinor: 25.5 },
      { ...CREDIT, livemode: 'false' as unknown as boolean },
      null as unknown as BusinessOsBoostCreditInput,
    ]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      const result = await repo.credit(input);
      expect(client.rpc).not.toHaveBeenCalled();
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

describe('slice 2b: transition and recordReceipt', () => {
  it('transition sends its six arguments with nulls for the unused ones and maps every outcome', async () => {
    for (const status of ['transitioned', 'already', 'stale', 'recorded', 'not_allowed', 'mismatch']) {
      const { repo, recorded } = rpcClient({ data: [{ out_status: status, out_user_id: ACCOUNT, out_from_status: 'paid' }], error: null });
      const result = await repo.transition({ purchaseId: PURCHASE, toStatus: 'partially_refunded', amountRefundedMinor: 1000 });
      expect(recorded.rpc).toEqual([
        BOS_TRANSITION_BOOST_PURCHASE_RPC,
        { p_purchase_id: PURCHASE, p_to_status: 'partially_refunded', p_payment_intent_id: null, p_amount_refunded_minor: 1000, p_dispute_id: null, p_flag_reason: null },
      ]);
      expect(result.data).toEqual({ status, accountId: ACCOUNT, fromStatus: 'paid' });
    }
    expect((await rpcClient({ data: [{ out_status: 'not_found', out_user_id: null, out_from_status: null }], error: null }).repo.transition({ purchaseId: PURCHASE, toStatus: 'expired' })).data).toEqual({
      status: 'not_found',
      accountId: null,
      fromStatus: null,
    });
  });

  it('transition refuses an unknown target, a fractional refund and null input before the RPC', async () => {
    for (const input of [
      { purchaseId: PURCHASE, toStatus: 'paid' as unknown as BusinessOsBoostTransitionTarget },
      { purchaseId: PURCHASE, toStatus: 'refunded' as BusinessOsBoostTransitionTarget, amountRefundedMinor: 10.5 },
      null as unknown as BusinessOsBoostTransitionInput,
    ]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      expect((await repo.transition(input)).error).toBeInstanceOf(Error);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it('recordReceipt sends its three arguments and maps every outcome; a bad id or url never reaches the RPC', async () => {
    for (const status of ['recorded', 'already_recorded', 'conflict', 'not_paid']) {
      const { repo, recorded } = rpcClient({ data: [{ out_status: status, out_user_id: ACCOUNT }], error: null });
      const result = await repo.recordReceipt({ purchaseId: PURCHASE, chargeId: 'ch_test_1', receiptUrl: 'https://pay.stripe.com/receipts/x' });
      expect(recorded.rpc).toEqual([BOS_RECORD_BOOST_RECEIPT_RPC, { p_purchase_id: PURCHASE, p_charge_id: 'ch_test_1', p_receipt_url: 'https://pay.stripe.com/receipts/x' }]);
      expect(result.data).toEqual({ status, accountId: ACCOUNT });
    }
    for (const input of [
      { purchaseId: PURCHASE, chargeId: 'pi_1', receiptUrl: 'https://x' },
      { purchaseId: PURCHASE, chargeId: 'ch_1', receiptUrl: 'http://x' },
    ]) {
      const { repo, client } = rpcClient({ data: [], error: null });
      expect((await repo.recordReceipt(input)).error).toBeInstanceOf(Error);
      expect(client.rpc).not.toHaveBeenCalled();
    }
  });

  it('the 2b RPC names are the functions the 2b migration creates', () => {
    const migration2b = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20261031_business_os_boost_crediting.sql'), 'utf8');
    for (const name of [BOS_CREDIT_BOOST_PURCHASE_RPC, BOS_TRANSITION_BOOST_PURCHASE_RPC, BOS_RECORD_BOOST_RECEIPT_RPC]) {
      expect(migration2b).toContain(`CREATE FUNCTION public.${name}(`);
    }
    for (const reason of BOOST_FLAG_REASONS) expect(migration2b).toContain(`'${reason}'`);
  });
});

describe('source guards', () => {
  const ROOT = process.cwd();
  const source = fs.readFileSync(path.join(ROOT, 'lib', 'repositories', 'BusinessOsBoostPurchaseRepository.ts'), 'utf8');
  const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261030_business_os_boost_purchases.sql'), 'utf8');

  it('never writes a table directly: no insert, update, delete or upsert (G-5)', () => {
    expect(source).not.toMatch(/\.(insert|update|delete|upsert)\(/);
  });

  it('imports nothing from the entitlements module (G-7)', () => {
    expect(source).not.toMatch(/(?:from|import|require\()\s*['"][^'"]*business-os\/entitlements/);
    // Negative control: the pattern catches a real import (type-only included).
    expect("import type { BoostPackage } from '@/lib/business-os/entitlements/boostCatalogue';").toMatch(
      /(?:from|import|require\()\s*['"][^'"]*business-os\/entitlements/
    );
  });

  it('defaults to the service-role client', () => {
    expect((businessOsBoostPurchaseRepository as unknown as { supabase: unknown }).supabase).toEqual({ marker: 'service-role-default' });
  });

  it('the RPC names are the functions the migration creates', () => {
    for (const name of [
      BOS_RESERVE_BOOST_PURCHASE_RPC,
      BOS_ATTACH_BOOST_CHECKOUT_RPC,
      BOS_ABANDON_BOOST_PURCHASE_RPC,
      BOS_SET_BOOST_CAP_OVERRIDE_RPC,
      BOS_END_BOOST_CAP_OVERRIDE_RPC,
    ]) {
      expect(migration).toContain(`CREATE FUNCTION public.${name}(`);
    }
  });

  it('every column the repository selects exists in the migration', () => {
    for (const column of [...BOOST_PURCHASE_COLUMNS.split(', '), ...BOOST_CAP_OVERRIDE_COLUMNS.split(', ')]) {
      expect(migration).toMatch(new RegExp(`\\n  ${column} `));
    }
  });

  it('SA C-5: under app/, only the Stripe webhook route and the reconcile cron route may name the webhook finders', () => {
    const allowed = ['app/api/stripe/webhook/', 'app/api/cron/bos-billing-reconcile/'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules') walk(rel);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
          if (/\bfind(?:BySessionId|ByPaymentIntentId)ForWebhook\b/.test(text) && !allowed.some((prefix) => rel.startsWith(prefix))) {
            offenders.push(rel);
          }
        }
      }
    };
    walk('app');
    expect(offenders).toEqual([]);
  });

  it('the C-5 guard pattern catches a use (negative control)', () => {
    expect(/\bfind(?:BySessionId|ByPaymentIntentId)ForWebhook\b/.test('repo.findBySessionIdForWebhook(id)')).toBe(true);
  });
});

describe('slice 4a: findByIdForWebhook and the failure classification (SA C-1, C-3, Q-1, Q-6)', () => {
  it('findByIdForWebhook reads one row by id, unscoped by design, and returns the row account', async () => {
    const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
    const found = await repo.findByIdForWebhook(PURCHASE);
    expect(calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['id', PURCHASE]],
      ['maybeSingle', []],
    ]);
    expect(found.data?.accountId).toBe(ACCOUNT);
  });

  it('findByIdForWebhook: no row → null; a non-UUID → a deterministic refusal with no query', async () => {
    expect(await readClient({ data: null, error: null }).repo.findByIdForWebhook(PURCHASE)).toEqual({ data: null, error: null });
    const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
    const refused = await repo.findByIdForWebhook('not-a-uuid');
    expect(calls).toEqual([]);
    expect(refused.error).toBeInstanceOf(BoostRepositoryFailure);
    expect(isDeterministicRepositoryError(refused.error)).toBe(true);
  });

  it.each([
    ['22004', true],
    ['22023', true],
    ['22003', true],
    ['22P02', true],
    ['23514', true],
    ['23502', true],
    ['23503', true],
    ['42883', true],
    ['42P01', true],
    ['42501', true],
    ['23505', false],
    ['40001', false],
    ['40P01', false],
    ['08006', false],
    ['08000', false],
    ['53300', false],
    ['57014', false],
    ['XX000', false],
    ['PGRST116', false],
    ['', false],
  ])('SQLSTATE %p → deterministic %p', (code, deterministic) => {
    expect(isDeterministicSqlState(code)).toBe(deterministic);
  });

  it.each([
    ['class 22 from the database', { code: '22023', message: 'out of range' }, true, false],
    ['a unique race (23505)', { code: '23505', message: 'duplicate key' }, false, false],
    ['a serialisation failure (40001)', { code: '40001', message: 'could not serialize' }, false, false],
    ['an internal error (XX000)', { code: 'XX000', message: 'no lot back' }, false, true],
    ['a plain error with no code (network)', { message: 'fetch failed' }, false, false],
  ])('%s → deterministic %p, anomalous %p', async (_name, error, deterministic, anomalous) => {
    const { error: failure } = await readClient({ data: null, error }).repo.findByIdForWebhook(PURCHASE);
    expect(failure).toBeInstanceOf(BoostRepositoryFailure);
    expect(isDeterministicRepositoryError(failure)).toBe(deterministic);
    expect(isAnomalousRepositoryError(failure)).toBe(anomalous);
    expect((failure as BoostRepositoryFailure).sqlstate).toBe((error as { code?: string }).code ?? null);
  });

  it('a rejected RPC with no SQLSTATE (a timeout) is transient; a repository validation refusal is deterministic', async () => {
    const timedOut = await rpcClient(new Error('timeout')).repo.transition({ purchaseId: PURCHASE, toStatus: 'expired' });
    expect(isDeterministicRepositoryError(timedOut.error)).toBe(false);
    const refused = await rpcClient({ data: [], error: null }).repo.transition({ purchaseId: 'nope', toStatus: 'expired' });
    expect(isDeterministicRepositoryError(refused.error)).toBe(true);
  });

  it('a plain Error is never deterministic (only a BoostRepositoryFailure can be)', () => {
    expect(isDeterministicRepositoryError(new Error('22023'))).toBe(false);
    expect(isDeterministicRepositoryError(Object.assign(new Error('x'), { deterministic: true }))).toBe(false);
  });

  it('SA Q-1: only the boost webhook session module names findByIdForWebhook (app, lib, components)', () => {
    const ROOT = process.cwd();
    // The session module is the one caller; the wiring file only passes the method through.
    const allowed = [
      'lib/business-os/boost/boostWebhookSession.ts',
      'lib/business-os/boost/boostWebhookDeps.ts',
      // Slice 4b.2 (SA C-2): the reconcile pass re-reads a row by the id it read
      // from our own table a moment ago (never an id from a request or Stripe).
      'lib/business-os/boost/boostReconcileDeps.ts',
      'lib/repositories/BusinessOsBoostPurchaseRepository.ts',
    ];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(rel);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
          if (/\bfindByIdForWebhook\b/.test(text) && !allowed.includes(rel)) offenders.push(rel);
        }
      }
    };
    for (const root of ['app', 'lib', 'components']) walk(root);
    expect(offenders).toEqual([]);
  });
});

describe('slice 5b.1: findForAccountBySessionId (SA C-3)', () => {
  it('reads one row scoped by user_id AND the session id, with the explicit column list', async () => {
    const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
    const found = await repo.findForAccountBySessionId(ACCOUNT, SESSION);
    expect(calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['user_id', ACCOUNT]],
      ['eq', ['stripe_checkout_session_id', SESSION]],
      ['maybeSingle', []],
    ]);
    expect(found.data?.id).toBe(PURCHASE);
  });

  it('another owner or a missing session → null (the filter decides, the caller cannot tell them apart)', async () => {
    expect(await readClient({ data: null, error: null }).repo.findForAccountBySessionId(ACCOUNT, SESSION)).toEqual({ data: null, error: null });
  });

  it('a malformed session id or account is refused before any query', async () => {
    for (const [account, session] of [
      [ACCOUNT, 'pi_test_1'],
      [ACCOUNT, ''],
      ['not-a-uuid', SESSION],
    ] as const) {
      const { repo, calls } = readClient({ data: PURCHASE_ROW, error: null });
      const result = await repo.findForAccountBySessionId(account, session);
      expect(result.data).toBeNull();
      expect(isDeterministicRepositoryError(result.error)).toBe(true);
      expect(calls).toEqual([]);
    }
  });
});

describe('slice 4b.2: listForReconcile (unscoped by design, SA C-9)', () => {
  const BEFORE = '2026-10-09T05:00:00.000Z';

  it.each([
    [
      'stuck',
      [
        ['in', ['status', ['pending', 'awaiting_payment']]],
        ['lt', ['checkout_expires_at', BEFORE]],
        ['order', ['checkout_expires_at', { ascending: true }]],
      ],
    ],
    [
      'receipt_missing',
      [
        ['eq', ['status', 'paid']],
        ['is', ['receipt_url', null]],
        ['lt', ['paid_at', BEFORE]],
        ['order', ['paid_at', { ascending: true }]],
      ],
    ],
    [
      'disputed',
      [
        ['eq', ['status', 'disputed']],
        ['lt', ['status_changed_at', BEFORE]],
        ['order', ['status_changed_at', { ascending: true }]],
      ],
    ],
  ] as const)('%s: one mode, oldest first, id as tie-break, bounded, never a user_id filter', async (kind, filters) => {
    const { repo, calls } = readClient({ data: [PURCHASE_ROW], error: null });
    const result = await repo.listForReconcile({ kind, livemode: false, before: BEFORE, limit: 50 });
    expect(calls).toEqual([
      ['from', ['business_os_boost_purchases']],
      ['select', [BOOST_PURCHASE_COLUMNS]],
      ['eq', ['livemode', false]],
      ...filters,
      ['order', ['id', { ascending: true }]],
      ['range', [0, 49]],
    ]);
    expect(calls.some(([name, args]) => name === 'eq' && args[0] === 'user_id')).toBe(false);
    expect(result.data?.map((row) => row.accountId)).toEqual([ACCOUNT]);
  });

  it('the batch is clamped to 1..50 (a larger request reads 50)', async () => {
    for (const [limit, last] of [
      [500, 49],
      [0, 0],
      [7.9, 6],
    ] as const) {
      const { repo, calls } = readClient({ data: [], error: null });
      await repo.listForReconcile({ kind: 'stuck', livemode: true, before: BEFORE, limit });
      expect(calls[calls.length - 1]).toEqual(['range', [0, last]]);
    }
    expect(BOOST_PURCHASE_READ_LIMITS.MAX_RECONCILE_BATCH).toBe(50);
  });

  it('an unknown kind, a non-boolean mode, an unreadable cut-off or a NaN batch is refused before any query (deterministic)', async () => {
    for (const input of [
      { kind: 'everything', livemode: false, before: BEFORE, limit: 50 },
      { kind: 'stuck', livemode: 'false', before: BEFORE, limit: 50 },
      { kind: 'stuck', livemode: false, before: 'yesterday', limit: 50 },
      { kind: 'stuck', livemode: false, before: BEFORE, limit: Number.NaN },
    ]) {
      const { repo, calls } = readClient({ data: [], error: null });
      const result = await repo.listForReconcile(input as never);
      expect(calls).toEqual([]);
      expect(isDeterministicRepositoryError(result.error)).toBe(true);
    }
  });

  it('a database error is returned (transient), never thrown; an unreadable row is an error, never a guess', async () => {
    const failed = await readClient({ data: null, error: { code: '57014', message: 'canceling statement' } }).repo.listForReconcile({
      kind: 'stuck',
      livemode: false,
      before: BEFORE,
      limit: 50,
    });
    expect(failed.data).toBeNull();
    expect(isDeterministicRepositoryError(failed.error)).toBe(false);

    const unreadable = await readClient({ data: [{ ...PURCHASE_ROW, status: 'stuckish' }], error: null }).repo.listForReconcile({
      kind: 'stuck',
      livemode: false,
      before: BEFORE,
      limit: 50,
    });
    expect(unreadable.data).toBeNull();
    expect(unreadable.error).toBeInstanceOf(BoostRepositoryFailure);
  });

  it('only the reconcile wiring names listForReconcile (app, lib, components)', () => {
    const ROOT = process.cwd();
    const allowed = ['lib/business-os/boost/boostReconcileDeps.ts', 'lib/repositories/BusinessOsBoostPurchaseRepository.ts'];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) {
          if (entry.name !== 'node_modules' && entry.name !== '__tests__') walk(rel);
        } else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
          // The pass names it only through its typed port (`Pick<…, 'listForReconcile'>`), the deps wire it.
          if (/\blistForReconcile\b/.test(text) && !allowed.includes(rel) && rel !== 'lib/business-os/boost/boostReconcilePass.ts') offenders.push(rel);
        }
      }
    };
    for (const root of ['app', 'lib', 'components']) walk(root);
    expect(offenders).toEqual([]);
  });
});
