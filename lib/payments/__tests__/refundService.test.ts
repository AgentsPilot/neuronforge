/**
 * The refund path, with Stripe and the database mocked.
 *
 * The assertions that matter here are about what does NOT happen. A refund that
 * fails loudly costs a support ticket; one that quietly issues twice, or issues
 * against the wrong Stripe account, costs money that cannot be recalled. So most
 * of these prove that Stripe was never called.
 *
 * The over-refund guard is deliberately NOT tested here — it lives in a database
 * trigger holding a row lock, because two concurrent requests can pass any check
 * made in application code. What is tested is that the service surfaces that
 * rejection correctly when the database raises it.
 */

const stripeRefundsCreate = jest.fn();

jest.mock('stripe', () =>
  jest.fn().mockImplementation(() => ({
    refunds: { create: stripeRefundsCreate },
  }))
);

/** A chainable Supabase stand-in driven by a per-table script. */
const dbState: {
  transaction: Record<string, unknown> | null;
  insertError: { code: string; message: string } | null;
  existingRefund: Record<string, unknown> | null;
  updates: Array<Record<string, unknown>>;
} = { transaction: null, insertError: null, existingRefund: null, updates: [] };

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      builder.select = chain;
      builder.eq = chain;
      builder.in = chain;
      builder.order = chain;
      builder.limit = chain;

      builder.maybeSingle = async () => ({
        data: table === 'payment_transactions' ? dbState.transaction : dbState.existingRefund,
        error: null,
      });

      builder.insert = () => ({
        select: () => ({
          single: async () =>
            dbState.insertError
              ? { data: null, error: dbState.insertError }
              : { data: { id: 'refund-row-1' }, error: null },
        }),
      });

      builder.update = (row: Record<string, unknown>) => {
        dbState.updates.push(row);
        return { eq: async () => ({ error: null }) };
      };

      return builder;
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { refund } from '../RefundService';

const settledTransaction = (over: Record<string, unknown> = {}) => ({
  id: 'tx-1',
  user_id: 'user-1',
  invoice_id: 'inv-1',
  amount: 200,
  currency: 'ILS',
  status: 'succeeded',
  refunded_amount: 0,
  stripe_payment_intent_id: 'pi_123',
  stripe_charge_id: null,
  stripe_connect_account_id: 'acct_1',
  account_resolution: 'recorded',
  ...over,
});

beforeEach(() => {
  stripeRefundsCreate.mockReset();
  dbState.transaction = settledTransaction();
  dbState.insertError = null;
  dbState.existingRefund = null;
  dbState.updates = [];
  process.env.STRIPE_SECRET_KEY = 'sk_test_x';
});

describe('refund — refusals that must never reach Stripe', () => {
  it('does not call Stripe when the account is unresolved', async () => {
    // THE most important assertion in this file. An unresolved charge could be
    // on the platform or on a connected account, and refunding against the wrong
    // one returns money from a balance that did not take it.
    dbState.transaction = settledTransaction({
      account_resolution: 'unknown',
      stripe_connect_account_id: null,
    });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'req-1',
    });

    expect(result).toMatchObject({ ok: false, code: 'ACCOUNT_UNRESOLVED' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe when the charge was found on several accounts', async () => {
    dbState.transaction = settledTransaction({ account_resolution: 'ambiguous' });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
    });

    expect(result).toMatchObject({ ok: false, code: 'ACCOUNT_UNRESOLVED' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe for a payment that never settled', async () => {
    dbState.transaction = settledTransaction({ status: 'pending' });

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result).toMatchObject({ ok: false, code: 'NOT_REFUNDABLE' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe when the payment is already fully refunded', async () => {
    dbState.transaction = settledTransaction({ refunded_amount: 200 });

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result).toMatchObject({ ok: false, code: 'NOTHING_REMAINING' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe when asked for more than remains', async () => {
    dbState.transaction = settledTransaction({ refunded_amount: 150 });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      amount: 100, // only 50 left
      source: 'app',
    });

    expect(result).toMatchObject({ ok: false, code: 'EXCEEDS_REMAINING' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('does not call Stripe for someone else\'s payment', async () => {
    dbState.transaction = null; // the user_id filter found nothing

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });
});

describe('refund — the Stripe call', () => {
  it('passes the connected account and an idempotency key', async () => {
    stripeRefundsCreate.mockResolvedValue({ id: 're_1', status: 'succeeded' });

    await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app', clientRequestId: 'r1' });

    const [payload, options] = stripeRefundsCreate.mock.calls[0];
    expect(payload).toMatchObject({ payment_intent: 'pi_123', amount: 20000 });
    expect(options.stripeAccount).toBe('acct_1');
    expect(options.idempotencyKey).toEqual(expect.any(String));
  });

  it('OMITS the account object entirely for a platform charge', async () => {
    // `{ stripeAccount: undefined }` is not the same as no account — the SDK
    // treats them differently, and a manual payment lives on neither.
    dbState.transaction = settledTransaction({ stripe_connect_account_id: null });
    stripeRefundsCreate.mockResolvedValue({ id: 're_2', status: 'succeeded' });

    await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    const [, options] = stripeRefundsCreate.mock.calls[0];
    expect(options).not.toHaveProperty('stripeAccount');
    expect(options.idempotencyKey).toEqual(expect.any(String));
  });

  it('defaults to everything remaining, not the original amount', async () => {
    dbState.transaction = settledTransaction({ refunded_amount: 50 });
    stripeRefundsCreate.mockResolvedValue({ id: 're_3', status: 'succeeded' });

    await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(stripeRefundsCreate.mock.calls[0][0].amount).toBe(15000); // 150, not 200
  });

  it('refunds against the charge when there is no payment intent', async () => {
    dbState.transaction = settledTransaction({
      stripe_payment_intent_id: null,
      stripe_charge_id: 'ch_9',
    });
    stripeRefundsCreate.mockResolvedValue({ id: 're_4', status: 'succeeded' });

    await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(stripeRefundsCreate.mock.calls[0][0]).toMatchObject({ charge: 'ch_9' });
  });
});

describe('refund — replay and failure', () => {
  it('returns the original refund instead of issuing a second', async () => {
    // The duplicate-submit case. The unique index on idempotency_key rejects the
    // insert, and the answer is the first refund — not a new one.
    dbState.insertError = { code: '23505', message: 'duplicate key' };
    dbState.existingRefund = {
      id: 'refund-row-1',
      processor_refund_id: 're_original',
      amount: 200,
      currency: 'ILS',
    };

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'same-request',
    });

    expect(result).toMatchObject({ ok: true, replayed: true, processorRefundId: 're_original' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('surfaces the database over-refund guard as a refusal', async () => {
    // Raised by refund_guard_before(), which holds the row lock. Two concurrent
    // requests can pass every application check; only this stops the second.
    dbState.insertError = { code: 'P0001', message: 'Refund of 200 would exceed the transaction' };

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result).toMatchObject({ ok: false, code: 'EXCEEDS_REMAINING' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('leaves the ledger row failed when Stripe refuses, and reports it', async () => {
    stripeRefundsCreate.mockRejectedValue(
      Object.assign(new Error('Insufficient funds'), { code: 'balance_insufficient' })
    );

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result).toMatchObject({ ok: false, code: 'BALANCE_INSUFFICIENT' });
    // Marked failed, never succeeded — claiming otherwise would report money as
    // returned when none moved.
    expect(dbState.updates.some(u => u.status === 'failed')).toBe(true);
    expect(dbState.updates.some(u => u.status === 'succeeded')).toBe(false);
  });

  it('does not leak Stripe internals outside development', async () => {
    const previous = process.env.NODE_ENV;
    // @ts-expect-error - overridden for this assertion
    process.env.NODE_ENV = 'production';

    stripeRefundsCreate.mockRejectedValue(new Error('card_declined: raw processor detail'));

    const result = await refund({ userId: 'user-1', transactionId: 'tx-1', source: 'app' });

    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).not.toContain('raw processor detail');

    // @ts-expect-error - restoring
    process.env.NODE_ENV = previous;
  });
});
