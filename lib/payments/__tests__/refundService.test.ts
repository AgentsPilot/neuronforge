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
  /** Per-id rows, for the group tests. Falls back to `transaction` when empty. */
  transactionsById: Record<string, Record<string, unknown>>;
  /** Every idempotency key the ledger was asked to insert, in order. */
  insertedKeys: string[];
  /** The full ledger rows, for assertions about status and processor. */
  insertedRows: Array<Record<string, unknown>>;
} = {
  transaction: null,
  insertError: null,
  existingRefund: null,
  updates: [],
  transactionsById: {},
  insertedKeys: [],
  insertedRows: [],
};

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const chain = () => builder;

      let requestedId: string | null = null;

      builder.select = chain;
      builder.eq = (column: string, value: unknown) => {
        if (column === 'id') requestedId = value as string;
        return builder;
      };
      builder.in = chain;
      builder.order = chain;
      builder.limit = chain;

      builder.maybeSingle = async () => {
        if (table !== 'payment_transactions') return { data: dbState.existingRefund, error: null };

        // A group refund asks for each transaction in turn, so the harness has
        // to be able to answer differently per id.
        const perId = requestedId ? dbState.transactionsById[requestedId] : undefined;
        return { data: perId ?? dbState.transaction, error: null };
      };

      builder.insert = (row: Record<string, unknown>) => {
        if (table === 'payment_refunds' && typeof row?.idempotency_key === 'string') {
          dbState.insertedKeys.push(row.idempotency_key);
          dbState.insertedRows.push(row);
        }
        return ({
        select: () => ({
          single: async () =>
            dbState.insertError
              ? { data: null, error: dbState.insertError }
              : { data: { id: 'refund-row-1' }, error: null },
        }),
      });
      };

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

import {
  refund,
  refundGroup,
  getRefundability,
  resolveStripeRefundTarget,
} from '../RefundService';

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
  dbState.transactionsById = {};
  dbState.insertedKeys = [];
  dbState.insertedRows = [];
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

describe('refund — money with no Stripe reference', () => {
  /*
   * Every payment plan installment was in this state: recorded with the Stripe
   * INVOICE id and neither a payment intent nor a charge. The old code wrote a
   * ledger row, called Stripe, and threw — so the owner got a 502 on a button
   * the UI had offered them, and the ledger kept a failed row for a refund that
   * was never possible.
   */
  const noReference = () =>
    settledTransaction({ stripe_payment_intent_id: null, stripe_charge_id: null });

  it('refuses before writing a ledger row', async () => {
    dbState.transaction = noReference();

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'req-no-ref',
    });

    expect(result).toMatchObject({ ok: false, code: 'MISSING_REFERENCE' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
    // The refusal happens ahead of the insert, so nothing was written and no
    // refund budget was held for money that could never move.
    expect(dbState.updates).toHaveLength(0);
  });

  it('reports it through getRefundability, so the button is never offered', async () => {
    dbState.transaction = noReference();

    const verdict = await getRefundability('user-1', 'tx-1');

    expect(verdict).toMatchObject({ refundable: false, reason: 'MISSING_REFERENCE' });
    // The remaining amount is still reported: the money is real and partly
    // refundable in principle — it just cannot be returned through Stripe.
    expect(verdict.remaining).toBe(200);
  });

  it('prefers the payment intent when both are present', () => {
    // Stripe rejects a request carrying both, so the choice has to be made once
    // and in one place — which is the reason this resolver is shared.
    expect(
      resolveStripeRefundTarget({ stripe_payment_intent_id: 'pi_1', stripe_charge_id: 'ch_1' })
    ).toEqual({ payment_intent: 'pi_1' });
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


/**
 * Refunding everything a booking holds.
 *
 * The defect this exists for: a twelve-period plan puts twelve transactions on
 * one booking, the old resolver took the newest, and "refund this booking"
 * returned one twelfth of the money and reported success.
 */
describe('refundGroup', () => {
  const threePeriods = () => {
    dbState.transactionsById = {
      'tx-a': settledTransaction({ id: 'tx-a', amount: 100 }),
      'tx-b': settledTransaction({ id: 'tx-b', amount: 100 }),
      'tx-c': settledTransaction({ id: 'tx-c', amount: 100 }),
    };
  };

  it('refunds every payment and totals what actually went back', async () => {
    threePeriods();
    stripeRefundsCreate.mockResolvedValue({ id: 're_x', status: 'succeeded' });

    const result = await refundGroup({
      userId: 'user-1',
      transactionIds: ['tx-a', 'tx-b', 'tx-c'],
      source: 'app',
      clientRequestId: 'group-1',
    });

    expect(stripeRefundsCreate).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ requested: 3, succeeded: 3, refundedTotal: 300 });
  });

  it('gives each leg its own key, derived from the group', async () => {
    // A retry of the same group intent must replay all three legs rather than
    // refund each of them again — and a per-leg `randomUUID()` would silently
    // discard that guarantee. Derived keys also have to DIFFER from each other,
    // or leg two collides with leg one and returns leg one's refund.
    threePeriods();
    stripeRefundsCreate.mockResolvedValue({ id: 're_x', status: 'succeeded' });

    await refundGroup({
      userId: 'user-1',
      transactionIds: ['tx-a', 'tx-b', 'tx-c'],
      source: 'app',
      clientRequestId: 'group-1',
    });

    expect(new Set(dbState.insertedKeys).size).toBe(3);
  });

  it('reports a partial failure as a partial failure', async () => {
    // Stripe refunds are individually final: two succeeded and one did not, and
    // there is no rolling that back. Collapsing this into `ok: true` is how the
    // original defect stayed invisible.
    threePeriods();
    stripeRefundsCreate
      .mockResolvedValueOnce({ id: 're_1', status: 'succeeded' })
      .mockResolvedValueOnce({ id: 're_2', status: 'succeeded' })
      .mockRejectedValueOnce(Object.assign(new Error('insufficient funds'), {
        code: 'balance_insufficient',
      }));

    const result = await refundGroup({
      userId: 'user-1',
      transactionIds: ['tx-a', 'tx-b', 'tx-c'],
      source: 'app',
      clientRequestId: 'group-2',
    });

    expect(result.succeeded).toBe(2);
    expect(result.requested).toBe(3);
    expect(result.refundedTotal).toBe(200);
    expect(result.legs[2]).toMatchObject({ ok: false, code: 'BALANCE_INSUFFICIENT' });
  });

  it('treats an already-refunded payment as done, not as a failure', async () => {
    // Refunding a booking whose periods were partly returned already should end
    // with everything refunded and no alarm: the end state asked for is the end
    // state reached.
    dbState.transactionsById = {
      'tx-a': settledTransaction({ id: 'tx-a', amount: 100, refunded_amount: 100 }),
      'tx-b': settledTransaction({ id: 'tx-b', amount: 100 }),
    };
    stripeRefundsCreate.mockResolvedValue({ id: 're_x', status: 'succeeded' });

    const result = await refundGroup({
      userId: 'user-1',
      transactionIds: ['tx-a', 'tx-b'],
      source: 'app',
      clientRequestId: 'group-3',
    });

    expect(result.succeeded).toBe(2);
    expect(result.refundedTotal).toBe(100);
    expect(stripeRefundsCreate).toHaveBeenCalledTimes(1);
  });

  it('refunds one at a time', async () => {
    /*
     * The over-refund guard is a `SELECT … FOR UPDATE` in a trigger. Firing
     * these concurrently makes legitimate legs contend for the row lock and
     * surface as spurious EXCEEDS_REMAINING, so the loop must not overlap.
     */
    threePeriods();
    let inFlight = 0;
    let overlapped = false;

    stripeRefundsCreate.mockImplementation(async () => {
      inFlight++;
      if (inFlight > 1) overlapped = true;
      await new Promise(resolve => setTimeout(resolve, 1));
      inFlight--;
      return { id: 're_x', status: 'succeeded' };
    });

    await refundGroup({
      userId: 'user-1',
      transactionIds: ['tx-a', 'tx-b', 'tx-c'],
      source: 'app',
      clientRequestId: 'group-4',
    });

    expect(overlapped).toBe(false);
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
      // A replay is only a success if the original SUCCEEDED. Without this the
      // fixture described a row in no particular state, which is how the code
      // came to return `ok: true` for refunds that had failed.
      status: 'succeeded',
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

  it('does NOT report success when the original refund failed', async () => {
    /*
     * The dangerous replay. The first attempt hit `balance_insufficient` and the
     * ledger row is `failed`; a retry with the same request id collides on the
     * unique index. This used to return `ok: true` with a null
     * `processorRefundId`, and the callers believed it — the booking was marked
     * refunded, an audit entry was written at severity `critical`, and the
     * client was emailed about money that never moved.
     */
    dbState.insertError = { code: '23505', message: 'duplicate key' };
    dbState.existingRefund = {
      id: 'refund-row-1',
      processor_refund_id: null,
      amount: 200,
      currency: 'ILS',
      status: 'failed',
      failure_code: 'balance_insufficient',
      failure_message: 'The connected account has insufficient funds.',
    };

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'same-request',
    });

    expect(result.ok).toBe(false);
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  it('reports an in-flight refund distinctly, so callers do not act on it', async () => {
    // Still pending: the money may yet move. Neither a success to record nor a
    // failure to retry — the caller must wait rather than email the client.
    dbState.insertError = { code: '23505', message: 'duplicate key' };
    dbState.existingRefund = {
      id: 'refund-row-1',
      processor_refund_id: null,
      amount: 200,
      currency: 'ILS',
      status: 'pending',
    };

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'same-request',
    });

    expect(result).toMatchObject({ ok: false, code: 'IN_FLIGHT' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });
});

/**
 * Money that never went through a processor.
 *
 * A business collecting by bank transfer can take money through the platform —
 * `mark-paid` records it as a real transaction — but until now could never
 * record it coming back. The refund was refused, so the invoice stayed paid
 * forever, reports overstated, and the ledger export showed no reversal.
 *
 * The tests that matter here are the REFUSALS, again. Recording a refund is
 * writing "this money went back" with nothing to verify it against, so the one
 * thing that must never happen is recording it for money a processor is
 * actually holding.
 */
describe('refund — money returned by hand', () => {
  const manualTransaction = (over: Record<string, unknown> = {}) =>
    settledTransaction({
      processor_type: 'manual',
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
      stripe_connect_account_id: null,
      account_resolution: null,
      ...over,
    });

  it('records the refund without calling Stripe', async () => {
    dbState.transaction = manualTransaction();

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      amount: 50,
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-1',
    });

    expect(result).toMatchObject({ ok: true, amount: 50, currency: 'ILS' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
  });

  /*
   * `pending` exists to cover the wait for a processor's answer. There is no
   * wait here — the money already moved — and a row left pending would hold
   * refund budget against a completed movement with nothing ever coming along
   * to close it, making the rest of the payment permanently un-refundable.
   */
  it('writes the ledger row already succeeded, not pending', async () => {
    dbState.transaction = manualTransaction();

    await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-2',
    });

    expect(dbState.insertedRows).toHaveLength(1);
    expect(dbState.insertedRows[0]).toMatchObject({
      status: 'succeeded',
      processor_type: 'manual',
      stripe_connect_account_id: null,
    });
    expect(dbState.insertedRows[0].succeeded_at).toEqual(expect.any(String));
  });

  it('reports no processor reference rather than inventing one', async () => {
    dbState.transaction = manualTransaction();

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-3',
    });

    // A reconciler matches on this field. A placeholder would match nothing and
    // read as a reference that has gone missing.
    expect(result).toMatchObject({ ok: true, processorRefundId: null });
  });

  // No account to resolve, so the guard that protects Stripe refunds must not
  // block the one path that never touches Stripe.
  it('does not need a resolved Stripe account', async () => {
    dbState.transaction = manualTransaction({ account_resolution: 'ambiguous' });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-4',
    });

    expect(result).toMatchObject({ ok: true });
  });

  /*
   * THE ONE THAT MATTERS.
   *
   * The flag says the business returned the money itself. If that were trusted
   * alone, a live card charge could be marked refunded: the invoice would
   * close, the booking would free, revenue would drop — and the client would
   * still be out of pocket holding a document saying they were repaid.
   */
  it('refuses to record a manual refund against processor money', async () => {
    dbState.transaction = settledTransaction({ processor_type: 'stripe' });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-5',
    });

    expect(result).toMatchObject({ ok: false, code: 'NOT_REFUNDABLE' });
    expect(stripeRefundsCreate).not.toHaveBeenCalled();
    expect(dbState.insertedRows).toHaveLength(0);
  });

  /*
   * The subtler half of the same rule. A Stripe payment whose charge reference
   * was never recorded looks referenceless — but that money DID go through
   * Stripe and has to come back through it. Recording it by hand would leave a
   * real charge standing against a ledger claiming it was returned.
   */
  it('refuses for a Stripe payment that merely lost its reference', async () => {
    dbState.transaction = settledTransaction({
      processor_type: 'stripe',
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
    });

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      manual: true,
      clientRequestId: 'req-manual-6',
    });

    expect(result).toMatchObject({ ok: false, code: 'NOT_REFUNDABLE' });
    expect(dbState.insertedRows).toHaveLength(0);
  });

  // Without the flag nothing changes: the caller has not asserted anything, so
  // the old refusal stands. This is what keeps every existing caller identical.
  it('still refuses manual money when the caller did not ask to record one', async () => {
    dbState.transaction = manualTransaction();

    const result = await refund({
      userId: 'user-1',
      transactionId: 'tx-1',
      source: 'app',
      clientRequestId: 'req-manual-7',
    });

    expect(result).toMatchObject({ ok: false, code: 'MISSING_REFERENCE' });
    expect(dbState.insertedRows).toHaveLength(0);
  });

  it('tells the UI that manual money is recordable, and Stripe money is not', async () => {
    dbState.transaction = manualTransaction();
    await expect(getRefundability('user-1', 'tx-1')).resolves.toMatchObject({
      refundable: false,
      recordable: true,
    });

    dbState.transaction = settledTransaction({
      processor_type: 'stripe',
      stripe_payment_intent_id: null,
      stripe_charge_id: null,
    });
    await expect(getRefundability('user-1', 'tx-1')).resolves.toMatchObject({
      refundable: false,
      recordable: false,
    });
  });
});
