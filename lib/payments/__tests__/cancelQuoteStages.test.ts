/**
 * Stopping the remaining stages of an accepted quote.
 *
 * The third stop path, for the quote that fell between the other two: a
 * milestone quote has no `subscription_id` (so `cancelPlan` cannot see it) and
 * `proposals.booking_id` is nullable (so `cancelBooking` cannot either). Its
 * stages sat `pending` forever — counted as owed, and chased at the client on
 * days 1, 3 and 7 for a job that ended.
 *
 * What these tests guard is the scoping, not the arithmetic. Every filter on the
 * update is load-bearing and a missing one damages real records:
 *
 *   user_id            or one tenant stops another's quote
 *   proposal_id        or the wrong job is stopped
 *   status = pending   or a PAID stage is rewritten, losing the record of money
 *                      that arrived
 *   subscription_id IS NULL
 *                      or a live plan's future periods are voided, falsifying
 *                      the books for money that is genuinely still arriving
 */

const dbState: {
  proposal: Record<string, unknown> | null;
  /** Stage rows returned for the billed-invoice sweep. */
  billedStages: Array<{ id: string; invoice_id: string | null }>;
  /*
   * invoice id -> the row `cancelQuoteStages` selects.
   *
   * This said `{ id, status }` — the liveness check was all it was first used
   * for. The refund cases below then set `amount`, `refunded_amount` and
   * `currency` without widening it, and Jest's transform drops types, so six
   * excess-property errors sat in a suite reporting green. The real
   * `.select()` at `cancelQuoteStages.ts:253` names all four.
   */
  invoices: Record<
    string,
    {
      id: string;
      status: string;
      amount?: number | null;
      refunded_amount?: number | null;
      currency?: string | null;
    }
  >;
  /** Stage rows the update claims to have changed. */
  closedRows: Array<{ id: string }>;
  /** Proposal rows the status update claims to have changed — [] means it was not `accepted`. */
  stoppedRows: Array<{ id: string }>;
  statusError: unknown;
  /**
   * Invoices returned for the BOOKING sweep — the ones no stage points at.
   *
   * This did not exist, and could not: the sweep's query ends in `.in(...)`,
   * which the fake had no method for, so the chain broke before it resolved and
   * the path was unreachable in this suite. Its only coverage was four regex
   * matches against the module's own source text, which moved to the repository
   * unit tests when the query did. These rows are what replaced them.
   */
  looseInvoices: Array<{ id: string; status: string }>;
  selects: Array<{ table: string; filters: Record<string, unknown>; ins: Record<string, unknown>; nots: string[]; is: Record<string, unknown> }>;
  updates: Array<{ table: string; row: Record<string, unknown>; filters: Record<string, unknown>; ins: Record<string, unknown>; nots: string[]; is: Record<string, unknown> }>;
  closeError: unknown;
  /** Written by the mock itself, so ordering assertions cannot pass by construction. */
  order: string[];
} = {
  proposal: null,
  billedStages: [],
  invoices: {},
  looseInvoices: [],
  closedRows: [],
  stoppedRows: [{ id: 'prop-1' }],
  statusError: null,
  selects: [],
  updates: [],
  closeError: null,
  order: [],
};

/*
 * A chain-faithful fake, because the ORDER of the calls is what the real client
 * cares about and what a lazier mock hides:
 *
 *   query   .from(t).select(cols).eq().eq().not().is()   <- select FIRST, awaited
 *   update  .from(t).update(row).eq().eq().is().select() <- select LAST, terminal
 *
 * So `select` cannot simply return a promise: on a query it must keep the chain
 * alive and let the final `await` resolve it. The builder is a thenable for that
 * reason.
 */
jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const isFilters: Record<string, unknown> = {};
      const inFilters: Record<string, unknown> = {};
      const nots: string[] = [];
      let mode: 'select' | 'update' = 'select';
      let updateRow: Record<string, unknown> = {};

      const builder: Record<string, unknown> = {};

      const resolveQuery = () => {
        dbState.selects.push({ table, filters: { ...filters }, ins: { ...inFilters }, nots: [...nots], is: { ...isFilters } });
        if (table === 'payment_plan_installments') {
          return { data: dbState.billedStages, error: null };
        }
        /*
         * The booking sweep. Reached only now that `in` keeps the chain alive —
         * before the move this returned `{ data: null }` for every table but
         * installments, so the sweep silently iterated nothing.
         */
        if (table === 'payment_invoices') {
          return { data: dbState.looseInvoices, error: null };
        }
        return { data: null, error: null };
      };

      builder.select = () => {
        if (mode === 'update') {
          // Terminal on an update: returns the rows that changed.
          dbState.updates.push({ table, row: updateRow, filters: { ...filters }, ins: { ...inFilters }, nots: [...nots], is: { ...isFilters } });
          dbState.order.push(`close:${table}`);
          if (table === 'proposals') {
            return Promise.resolve({
              data: dbState.statusError ? null : dbState.stoppedRows,
              error: dbState.statusError,
            });
          }
          return Promise.resolve({
            data: dbState.closeError ? null : dbState.closedRows,
            error: dbState.closeError,
          });
        }
        return builder;
      };

      builder.update = (row: Record<string, unknown>) => {
        mode = 'update';
        updateRow = row;
        return builder;
      };

      builder.eq = (column: string, value: unknown) => {
        filters[column] = value;
        return builder;
      };
      builder.is = (column: string, value: unknown) => {
        isFilters[column] = value;
        return builder;
      };
      builder.not = (column: string, op: string, value: unknown) => {
        nots.push(`${column} ${op} ${value}`);
        return builder;
      };
      /*
       * REQUIRED, not defensive. `stopAccepted` chains `.in('id', ids)`, so
       * without this the proposal update throws BEFORE its terminal `.select()`
       * — and the throw now lands inside a repository `try`, where it is
       * swallowed and reported as an ordinary error. Roughly ten tests would
       * fail with a missing update rather than a missing method.
       */
      builder.in = (column: string, value: unknown) => {
        inFilters[column] = value;
        return builder;
      };
      /*
       * These four ARE defensive, and deliberately so. This fake is an explicit
       * builder, not a Proxy: a repository method reaching for a chain method it
       * does not define throws, and §Finding exception 2 is that such a throw is
       * no longer loud. A green suite is not evidence here, so the cheap
       * insurance is to pass through what a future method is likely to call.
       */
      builder.limit = () => builder;
      builder.order = () => builder;
      builder.range = () => builder;
      builder.single = () => (builder.maybeSingle as () => Promise<unknown>)();

      builder.maybeSingle = async () => {
        if (table === 'proposals') return { data: dbState.proposal, error: null };
        if (table === 'payment_invoices') {
          const id = filters.id as string;
          return { data: dbState.invoices[id] ?? null, error: null };
        }
        return { data: null, error: null };
      };

      // Awaiting the chain itself — how the billed-stage sweep ends.
      builder.then = (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(resolveQuery()).then(onFulfilled, onRejected);

      return builder;
    },
  },
}));

const refundGroupMock = jest.fn();
const resolveTargetsMock = jest.fn();
const sendStoppedEmailMock = jest.fn();

jest.mock('@/lib/payments/RefundService', () => ({
  refundGroup: (...args: unknown[]) => refundGroupMock(...args),
  resolveRefundTargets: (...args: unknown[]) => resolveTargetsMock(...args),
}));

/*
 * The email service is reached through a LAZY import inside the function, so it
 * is mocked by module path like any static one — but the lazy import is the
 * reason it can be: a static import would pull the email transport and the PDF
 * stack into this file's module graph.
 */
jest.mock('@/lib/services/ProposalSendService', () => ({
  sendQuoteStoppedEmail: (...args: unknown[]) => sendStoppedEmailMock(...args),
}));

const voidInvoiceMock = jest.fn();

jest.mock('@/lib/payments/invoiceLifecycle', () => ({
  voidInvoice: (...args: unknown[]) => voidInvoiceMock(...args),
}));

/*
 * `logger.error` is CAPTURED, not just silenced.
 *
 * One line in this module is an operational instruction — "Money stopped but the
 * quote still reads accepted; it needs marking stopped by hand" — and whether it
 * fires is behaviour, not noise. Branching the status update on `!stoppedRows`
 * instead of on `statusError` (SA S-3) changes nothing a result assertion can
 * see: it only makes that line fire on every SECOND press, sending an owner to
 * fix a quote that is already correct. A mutation proving exactly that survived
 * until this mock could be read.
 */
const loggerErrorMock = jest.fn();
const loggerWarnMock = jest.fn();

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({
      info: jest.fn(),
      warn: (...args: unknown[]) => loggerWarnMock(...args),
      error: (...args: unknown[]) => loggerErrorMock(...args),
    }),
    info: jest.fn(),
    warn: (...args: unknown[]) => loggerWarnMock(...args),
    error: (...args: unknown[]) => loggerErrorMock(...args),
  }),
}));

import { cancelQuoteStages } from '../cancelQuoteStages';

const QUOTE = { id: 'prop-1', user_id: 'user-1', booking_id: null, status: 'accepted', title: 'Renovation' };

beforeEach(() => {
  dbState.proposal = { ...QUOTE };
  dbState.billedStages = [];
  dbState.invoices = {};
  dbState.looseInvoices = [];
  dbState.closedRows = [];
  dbState.stoppedRows = [{ id: 'prop-1' }];
  dbState.statusError = null;
  dbState.selects = [];
  dbState.updates = [];
  dbState.closeError = null;
  dbState.order = [];
  refundGroupMock.mockReset();
  refundGroupMock.mockResolvedValue({ refundedTotal: 0, legs: [] });
  resolveTargetsMock.mockReset();
  resolveTargetsMock.mockResolvedValue({ transactionIds: ['tx-1'] });
  sendStoppedEmailMock.mockReset();
  sendStoppedEmailMock.mockResolvedValue({ sent: true });
  voidInvoiceMock.mockReset();
  voidInvoiceMock.mockImplementation(async () => {
    dbState.order.push('void');
    return { data: {}, error: null };
  });
  loggerErrorMock.mockReset();
  loggerWarnMock.mockReset();
});

/** The messages this module logs that mean something to an operator. */
const loggedMessages = () => loggerErrorMock.mock.calls.map(c => String(c[1]));

/*
 * The reason is mandatory, so the default harness call carries one. Tests about
 * the reason itself pass their own.
 */
const run = () =>
  cancelQuoteStages({ proposalId: 'prop-1', userId: 'user-1', reason: 'client_stopped' });

const stageUpdate = () => dbState.updates.find(u => u.table === 'payment_plan_installments');
const statusUpdate = () => dbState.updates.find(u => u.table === 'proposals');

describe('the quote that had no stop path', () => {
  it('closes the unbilled stages of a quote with no booking at all', () => {
    // The whole gap: no booking_id, no subscription_id, so neither existing path
    // could reach these rows.
    dbState.closedRows = [{ id: 'st-2' }, { id: 'st-3' }];

    return run().then(result => {
      expect(result.ok).toBe(true);
      expect(result.stagesClosed).toBe(2);
    });
  });

  it('is not an error to press it twice', async () => {
    /*
     * The second press: no pending stages, no live invoices, and the status
     * update matches nothing because the quote is already `stopped` rather than
     * `accepted`. Reported as `alreadyClosed`, not as a failure — and crucially
     * it does NOT rewrite `stopped_at`, because the update is conditional.
     */
    dbState.stoppedRows = [];

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.stagesClosed).toBe(0);
    expect(result.proposalStopped).toBe(false);
    expect(result.alreadyClosed).toBe(true);
  });

  it('still marks the quote stopped when every stage was already paid', async () => {
    /*
     * A job paid in full that the owner is closing out. Nothing to cancel, but
     * saying it ended is real work — and this is the case the old
     * `alreadyClosed` test got wrong by treating "no stages closed" as "nothing
     * happened".
     */
    const result = await run();

    expect(result.stagesClosed).toBe(0);
    expect(result.proposalStopped).toBe(true);
    expect(result.alreadyClosed).toBe(false);
  });

  it('refuses a quote that is not this user\'s', async () => {
    dbState.proposal = null;
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_FOUND');
    // Nothing was touched — the guard runs before any write.
    expect(stageUpdate()).toBeUndefined();
  });

  it('works on a quote that DOES have a booking, without needing it', async () => {
    dbState.proposal = { ...QUOTE, booking_id: 'bk-9' };
    dbState.closedRows = [{ id: 'st-2' }];
    const result = await run();
    expect(result.ok).toBe(true);
    expect(result.stagesClosed).toBe(1);
  });
});

describe('saying the job ended — the second half of the one press', () => {
  it('moves the quote to stopped, not withdrawn', async () => {
    /*
     * `withdrawn` means the offer came off the table BEFORE anyone agreed.
     * Reusing it for a part-paid job would make the two indistinguishable in
     * exactly the analytics `stop_reason` exists to feed.
     */
    await run();
    expect(statusUpdate()!.row.status).toBe('stopped');
  });

  it('only from accepted, so it cannot clobber declined or withdrawn', async () => {
    // Also what makes a second press a no-op instead of rewriting stopped_at.
    await run();
    expect(statusUpdate()!.filters.status).toBe('accepted');
  });

  it('scopes the status update by user_id too', async () => {
    await run();
    expect(statusUpdate()!.filters.user_id).toBe('user-1');
    /*
     * `in('id', ['prop-1'])`, not `eq('id', 'prop-1')` — declared delta D-2.
     * `stopAccepted` is shared with the booking cascade, which stops several
     * quotes at once, so it takes a list. Identical in SQL for one id; the
     * assertion changes shape because the recorded filter does.
     */
    expect(statusUpdate()!.ins.id).toEqual(['prop-1']);
  });

  it('records the reason code for counting', async () => {
    // 'client_not_paying' — the real code. This read 'not_paying', which is not
    // in the union, so the test was pinning a value that can never be stored.
    await cancelQuoteStages({ proposalId: 'prop-1', userId: 'user-1', reason: 'client_not_paying' });
    expect(statusUpdate()!.row.stop_reason).toBe('client_not_paying');
  });

  it('always stores a code, because the caller cannot omit one', async () => {
    /*
     * This asserted the opposite until the reason was made mandatory: it checked
     * that an absent reason stored null. `reason` is now required by the type and
     * by the route's Zod enum, so there is no path that reaches the column
     * without one — and the test that mattered is that the given code arrives
     * verbatim rather than being normalised on the way in.
     *
     * The COLUMN stays nullable for rows written before this shipped. Unknown is
     * a real historical state; it is just no longer a reachable new one.
     */
    await run();
    expect(statusUpdate()!.row.stop_reason).toBe('client_stopped');
  });

  it('keeps the note as well as the reason, never instead of it', async () => {
    await cancelQuoteStages({
      proposalId: 'prop-1',
      userId: 'user-1',
      reason: 'other',
      note: '  client moved abroad  ',
    });
    expect(statusUpdate()!.row).toMatchObject({
      stop_reason: 'other',
      stop_note: 'client moved abroad',
    });
  });

  it('turns an empty note into null, not an empty string', async () => {
    // '' would read as a note that exists and says nothing.
    await cancelQuoteStages({ proposalId: 'prop-1', userId: 'user-1', reason: 'other', note: '   ' });
    expect(statusUpdate()!.row.stop_note).toBeNull();
  });

  it('stamps stopped_at, which is not updated_at', async () => {
    await run();
    expect(statusUpdate()!.row.stopped_at).toEqual(expect.any(String));
  });

  it('leaves the acceptance itself untouched', async () => {
    // How the job ENDED, never that it was not agreed.
    await run();
    const row = statusUpdate()!.row;
    expect(row).not.toHaveProperty('decided_at');
    expect(row).not.toHaveProperty('accepted_snapshot');
    expect(row).not.toHaveProperty('total');
  });

  it('still reports ok when the money stopped but the status write failed', async () => {
    /*
     * The money is the part that reaches the client, and it is already stopped.
     * Failing the whole call would invite a retry that finds nothing left to
     * close and reports "already stopped", hiding the one thing that went wrong.
     */
    dbState.statusError = new Error('db down');
    dbState.closedRows = [{ id: 'st-2' }];

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.stagesClosed).toBe(1);
    expect(result.proposalStopped).toBe(false);
  });
});

describe('every filter on the update is load-bearing', () => {
  it('scopes by user_id, so one tenant cannot stop another\'s quote', async () => {
    await run();
    expect(stageUpdate()!.filters.user_id).toBe('user-1');
  });

  it('scopes by proposal_id, the one key these stages always carry', async () => {
    // Live data: all 7 installments on the account carry proposal_id, and none
    // carries subscription_id. That is why this is the right key.
    await run();
    expect(stageUpdate()!.filters.proposal_id).toBe('prop-1');
  });

  it('closes everything unsettled, and never a paid one', async () => {
    /*
     * A paid stage records money that arrived; rewriting it to `cancelled` would
     * delete the evidence of a real payment. An already-cancelled one is done.
     *
     * This asserted `status === 'pending'`, which was narrower than the rule and
     * left a BILLED stage open on a stopped job — the invoice voided by this
     * same call, the stage still reading "billed". The guarantee is unchanged;
     * only the expression of it is.
     */
    await run();
    expect(stageUpdate()!.nots).toContain('status in (paid,cancelled)');
    expect(stageUpdate()!.filters.status).toBeUndefined();
  });

  it('excludes subscription periods, which are money still genuinely arriving', async () => {
    // Same exclusion `cancelBooking` makes. Without it, stopping a quote would
    // void a live plan's future periods and falsify the books.
    await run();
    expect(stageUpdate()!.is.subscription_id).toBeNull();
  });

  it('writes cancelled and clears the retry clock', async () => {
    await run();
    expect(stageUpdate()!.row).toMatchObject({ status: 'cancelled', next_retry_at: null });
  });
});

describe('invoices already raised for a stage', () => {
  it('voids the ones still asking for money', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'sent' } };

    const result = await run();

    expect(voidInvoiceMock).toHaveBeenCalledWith({ invoiceId: 'inv-1', userId: 'user-1' });
    expect(result.invoicesVoided).toBe(1);
  });

  it('voids drafts and overdue invoices too', async () => {
    dbState.billedStages = [
      { id: 'st-1', invoice_id: 'inv-1' },
      { id: 'st-2', invoice_id: 'inv-2' },
    ];
    dbState.invoices = {
      'inv-1': { id: 'inv-1', status: 'draft' },
      'inv-2': { id: 'inv-2', status: 'overdue' },
    };

    expect((await run()).invoicesVoided).toBe(2);
  });

  it('leaves a PAID stage invoice alone', async () => {
    // Money that arrived. Voiding it would erase the record of a real payment,
    // and `voidInvoice` would refuse anyway — checking first keeps a correct
    // case from logging like a failure.
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'paid' } };

    const result = await run();

    expect(voidInvoiceMock).not.toHaveBeenCalled();
    expect(result.invoicesVoided).toBe(0);
  });

  it('leaves an already cancelled invoice alone', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'cancelled' } };
    expect((await run()).invoicesVoided).toBe(0);
  });

  it('keeps going when one invoice will not void', async () => {
    // One invoice the processor refuses must not leave the other stages of the
    // job still chasing the client.
    dbState.billedStages = [
      { id: 'st-1', invoice_id: 'inv-1' },
      { id: 'st-2', invoice_id: 'inv-2' },
    ];
    dbState.invoices = {
      'inv-1': { id: 'inv-1', status: 'sent' },
      'inv-2': { id: 'inv-2', status: 'sent' },
    };
    voidInvoiceMock
      .mockResolvedValueOnce({ data: null, error: new Error('Stripe said no') })
      .mockResolvedValueOnce({ data: {}, error: null });

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.invoicesVoided).toBe(1);
    // And the unbilled stages were still closed.
    expect(stageUpdate()).toBeDefined();
  });

  it('excludes subscription periods from the invoice sweep as well', async () => {
    await run();
    const sweep = dbState.selects.find(s => s.table === 'payment_plan_installments');
    expect(sweep!.is.subscription_id).toBeNull();
    expect(sweep!.filters.user_id).toBe('user-1');
  });
});

describe('a half-finished run leaves something safe', () => {
  it('reports failure when the stages could not be closed', async () => {
    dbState.closeError = new Error('db down');
    const result = await run();
    expect(result.ok).toBe(false);
    expect(result.stagesClosed).toBe(0);
  });

  it('voids invoices BEFORE closing stages, so a crash looks unfinished', async () => {
    /*
     * Order matters for what a dead process leaves behind. Invoices first means
     * a crash leaves stages still `pending` — visibly unfinished and safe to run
     * again. Stages first would leave a closed stage beside an invoice still
     * chasing the client, which looks finished and is not.
     *
     * The sequence is read from `dbState.order`, which the MOCK writes. An
     * earlier version of this test appended 'close' by hand after the call and
     * so could not fail whatever the code did.
     */
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'sent' } };

    await run();

    /*
     * Three steps, in this order. The status is LAST because it is the thing a
     * person reads: dying before it leaves a quote that says `accepted` with its
     * stages closed — wrong, but visibly wrong. Marking it `stopped` first and
     * then failing to close the stages would leave a quote that LOOKS finished
     * while its stages go on being chased at the client.
     */
    expect(dbState.order).toEqual([
      'void',
      'close:payment_plan_installments',
      'close:proposals',
    ]);
  });
});

describe('what is still held, so a caller can offer the real refund dialog', () => {
  /*
   * Refunding used to happen INSIDE this function, behind a tick-box of its own
   * in the stop dialog. That put a second money-moving path beside the reviewed
   * one — no partial allocation rules, no over-refund guard, no notify toggle —
   * and made one refund control in the drawer behave unlike every other.
   *
   * It now reports what is held and the caller opens the standard dialog, exactly
   * as cancelling a booking does.
   */
  it('reports what the client has paid, from the settled stage invoices', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = {
      'inv-1': { id: 'inv-1', status: 'paid', amount: 600, refunded_amount: 0, currency: 'ILS' },
    };

    const result = await run();

    expect(result.collected).toBe(600);
    expect(result.currency).toBe('ILS');
  });

  it('nets prior refunds off, so a part-refunded stage is not overstated', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = {
      'inv-1': { id: 'inv-1', status: 'partially_refunded', amount: 600, refunded_amount: 200, currency: 'ILS' },
    };

    expect((await run()).collected).toBe(400);
  });

  it('reports nothing held for a quote that was never paid', async () => {
    /*
     * The ordinary case, and the one that matters for the caller: a job nobody
     * paid for must not open a refund dialog over nothing.
     */
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'sent', amount: 8500 } };

    expect((await run()).collected).toBe(0);
  });

  it('moves no money itself', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'paid', amount: 600 } };

    await run();

    // Nothing in this module may refund. The dialog does, afterwards.
    expect(refundGroupMock).not.toHaveBeenCalled();
  });
});

describe('telling the client', () => {
  it('emails them with the facts of the stop', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'paid', amount: 600, refunded_amount: 0 } };
    dbState.closedRows = [{ id: 'st-2' }, { id: 'st-3' }];

    await cancelQuoteStages({
      proposalId: 'prop-1',
      userId: 'user-1',
      reason: 'owner_cannot_deliver',
      note: 'we could not source the materials',
    });

    expect(sendStoppedEmailMock).toHaveBeenCalledWith('prop-1', 'user-1', {
      // Paid, from the settled invoice this loop skipped rather than voided.
      paidAmount: 600,
      refundedAmount: 0,
      invoicesVoided: 0,
      stagesClosed: 2,
      note: 'we could not source the materials',
      /*
       * The code IS passed — the template renders its CLIENT-SAFE phrasing and
       * never the code itself. An earlier version of this withheld the code
       * entirely, which meant a client whose owner kept their note private was
       * told the work had stopped and given no reason at all.
       */
      reasonCode: 'owner_cannot_deliver',
    });
  });

  it('withholds the note when the owner keeps it private, but still sends the reason', async () => {
    /*
     * The note is withheld HERE rather than in the template: a template that
     * decides what to hide is one somebody will forget to check. The code still
     * travels, because the client is entitled to know WHY the work stopped — the
     * template turns it into a neutral sentence and never prints the code.
     */
    await cancelQuoteStages({
      proposalId: 'prop-1',
      userId: 'user-1',
      reason: 'client_not_paying',
      note: 'chased four times, nothing',
      shareNoteWithClient: false,
    });

    expect(sendStoppedEmailMock).toHaveBeenCalledWith(
      'prop-1',
      'user-1',
      expect.objectContaining({ note: null, reasonCode: 'client_not_paying' })
    );
  });

  it('shares the note when the owner leaves sharing on', async () => {
    await cancelQuoteStages({
      proposalId: 'prop-1',
      userId: 'user-1',
      reason: 'client_stopped',
      note: 'moving abroad',
    });

    expect(sendStoppedEmailMock).toHaveBeenCalledWith(
      'prop-1',
      'user-1',
      expect.objectContaining({ note: 'moving abroad' })
    );
  });

  it('never claims a refund it did not make', async () => {
    dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
    dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'paid', amount: 600, refunded_amount: 0 } };

    await cancelQuoteStages({ proposalId: 'prop-1', userId: 'user-1', reason: 'client_stopped' });

    /*
     * Zero, always. Refunding happens afterwards in the standard dialog, which
     * sends its own email when money actually goes back — quoting a refund here
     * would be a promise this function cannot keep.
     */
    expect(sendStoppedEmailMock).toHaveBeenCalledWith(
      'prop-1',
      'user-1',
      expect.objectContaining({ refundedAmount: 0, paidAmount: 600 })
    );
  });

  it('still succeeds when the email cannot be sent', async () => {
    /*
     * The invoices are already voided and the stages already closed. Throwing
     * here would report a failure for work that completed, and a retry would find
     * nothing left to do while the owner believed nothing had happened.
     */
    sendStoppedEmailMock.mockRejectedValue(new Error('smtp down'));
    dbState.closedRows = [{ id: 'st-2' }];

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.stagesClosed).toBe(1);
  });
});

/**
 * Calling off an invoice no stage points at — the owner's choice, never the stop's.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A single-payment quote raises one invoice against its BOOKING and has no
 * stages, so the stage walk above cannot see it. Stopping such a quote left the
 * invoice `sent`: owed, chased, and still payable by the client, because the
 * public page refuses only invoices already settled. Two live quotes were in
 * that state, one of them ₪5,000.
 *
 * Off unless asked for, because stopping is not refunding.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe('the unpaid invoice outside the stages', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/payments/cancelQuoteStages.ts'), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('strips comments first, or it passes on its own explanation', () => {
    expect(source).toContain('stopping is not refunding');
    expect(code).not.toContain('stopping is not refunding');
  });

  it('does nothing unless the caller asks', () => {
    // The default is the decision: an owner stopping half way is often still
    // owed for the half that happened.
    expect(code).toContain('cancelUnpaidInvoice = false');
    expect(code).toContain('if (cancelUnpaidInvoice && proposal.booking_id)');
  });

  /*
   * THE FOUR ASSERTIONS THAT USED TO BE HERE MOVED, they were not dropped.
   *
   * They matched this file's source text for the sweep's query — the `in` filter
   * on the status list, the list's own declaration, and the two `eq` scopes —
   * because that query could not be executed from this suite at all. Now that it
   * lives in `paymentInvoiceRepository.findOpenForBooking`, each one is an
   * assertion on a real call in
   * `lib/repositories/__tests__/PaymentInvoiceRepository.quoteStop.test.ts`,
   * which also pins the constant's value AND the one word that separates it from
   * `ISSUED_INVOICE_STATUSES`.
   *
   * What stays here is what is still this file's own decision.
   */
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND NOW THE PATH ITSELF RUNS, for the first time in this suite.
   *
   * Every test below was impossible before the query moved: the sweep ends in
   * `.in(...)`, the fake had no such method, and the chain could not resolve.
   * This is the coverage the four source-text matches were standing in for, and
   * it is strictly more than they could assert — they could see the query's
   * shape, not what the function does with its answer.
   * ───────────────────────────────────────────────────────────────────────────
   */
  describe('now that it is reachable', () => {
    const WITH_BOOKING = { ...QUOTE, booking_id: 'booking-9' };

    const stop = (cancelUnpaidInvoice: boolean) =>
      cancelQuoteStages({
        proposalId: 'prop-1',
        userId: 'user-1',
        reason: 'client_stopped',
        cancelUnpaidInvoice,
      });

    it('leaves the invoice alone unless the owner asks', async () => {
      dbState.proposal = { ...WITH_BOOKING };
      dbState.looseInvoices = [{ id: 'inv-loose', status: 'sent' }];

      const result = await stop(false);

      /*
       * The default, and the decision it encodes: an owner stopping half way is
       * often still owed for the half that happened. Voiding it for them would
       * decide that nothing is owed.
       */
      expect(voidInvoiceMock).not.toHaveBeenCalled();
      expect(result.invoicesVoided).toBe(0);
    });

    it('voids the booking invoice no stage points at, when asked', async () => {
      dbState.proposal = { ...WITH_BOOKING };
      dbState.looseInvoices = [{ id: 'inv-loose', status: 'sent' }];

      const result = await stop(true);

      /* The ₪5,000 case: one invoice raised straight against the booking, with
         nothing linking it back to the quote. */
      expect(voidInvoiceMock).toHaveBeenCalledWith({ invoiceId: 'inv-loose', userId: 'user-1' });
      expect(result.invoicesVoided).toBe(1);
    });

    it('does not void a stage invoice twice', async () => {
      dbState.proposal = { ...WITH_BOOKING };
      /* The same invoice reached both ways: through its stage, and again in the
         booking sweep. */
      dbState.billedStages = [{ id: 'st-1', invoice_id: 'inv-1' }];
      dbState.invoices = { 'inv-1': { id: 'inv-1', status: 'sent' } };
      dbState.looseInvoices = [
        { id: 'inv-1', status: 'sent' },
        { id: 'inv-loose', status: 'overdue' },
      ];

      const result = await stop(true);

      /*
       * Without the dedupe `invoicesVoided` reads 3 for two invoices, and the
       * owner is told more was called off than exists.
       */
      expect(result.invoicesVoided).toBe(2);
      expect(voidInvoiceMock).toHaveBeenCalledTimes(2);
      expect(voidInvoiceMock.mock.calls.map(c => c[0].invoiceId)).toEqual(['inv-1', 'inv-loose']);
    });

    it('one invoice refusing to void does not abandon the rest', async () => {
      dbState.proposal = { ...WITH_BOOKING };
      dbState.looseInvoices = [
        { id: 'inv-bad', status: 'sent' },
        { id: 'inv-good', status: 'sent' },
      ];
      voidInvoiceMock.mockImplementation(async ({ invoiceId }: { invoiceId: string }) => {
        dbState.order.push('void');
        if (invoiceId === 'inv-bad') return { data: null, error: new Error('processor said no') };
        return { data: {}, error: null };
      });

      const result = await stop(true);

      /* A job half-called-off is worse than one called off with an invoice still
         open: the open invoice is visible, the half-finished state is not. */
      expect(result.ok).toBe(true);
      expect(result.invoicesVoided).toBe(1);
      expect(voidInvoiceMock).toHaveBeenCalledTimes(2);
    });

    it('a failed sweep read does not stop the quote being closed', async () => {
      dbState.proposal = { ...WITH_BOOKING };
      dbState.looseInvoices = [];
      dbState.closedRows = [{ id: 'st-2' }];

      const result = await stop(true);

      /* The stages are the fact that matters; the sweep is an extra the owner
         asked for. */
      expect(result.ok).toBe(true);
      expect(result.stagesClosed).toBe(1);
    });

    it('never runs for a quote with no booking', async () => {
      /* `payment_invoices` has no `proposal_id`, so there is nothing to scope a
         sweep by — and `QUOTE` deliberately has `booking_id: null`. */
      dbState.looseInvoices = [{ id: 'inv-loose', status: 'sent' }];

      const result = await stop(true);

      expect(voidInvoiceMock).not.toHaveBeenCalled();
      expect(result.invoicesVoided).toBe(0);
    });
  });

  it('keeps the settled list, which is a judgement about a row and not a filter', () => {
    /*
     * `SETTLED_INVOICE_STATUSES` did NOT move with its sibling. It is applied to
     * an invoice already returned, to decide what counts as collected — there is
     * no query for it to travel with. `refunded` and `partially_refunded` are in
     * it because both were PAID.
     */
    expect(code).toContain("const SETTLED_INVOICE_STATUSES = ['paid', 'refunded', 'partially_refunded']");
  });

  it('does not void the same invoice twice', () => {
    // A stage invoice has already been handled by the loop above, and would
    // otherwise be counted again in `invoicesVoided`.
    const sweep = code.slice(code.indexOf('if (cancelUnpaidInvoice'), code.indexOf('if (cancelUnpaidInvoice') + 900);
    expect(sweep).toContain('if (stageInvoiceIds.includes(invoice.id)) continue;');
  });

  it('one invoice refusing to void does not abandon the rest', () => {
    const sweep = code.slice(code.indexOf('if (cancelUnpaidInvoice'), code.indexOf('if (cancelUnpaidInvoice') + 1100);
    expect(sweep).toMatch(/if \(voidError\) \{[\s\S]*logger\.warn[\s\S]*continue;/);
  });
});


/*
 * ───────────────────────────────────────────────────────────────────────────────
 * THREE GAPS A MUTATION RUN FOUND, and they are the reason a green suite is not
 * evidence. Each of these mutations survived the first run:
 *
 *   · `if (!invoice) continue;`  ->  `if (false) continue;`
 *   · the close stops being passed the owner's reason
 *   · the status update branches on `!stoppedRows` instead of on `statusError`
 *
 * None of them is caught by a filter assertion on a repository, because none of
 * them is about what is ASKED — they are about what this function does with the
 * answer.
 * ───────────────────────────────────────────────────────────────────────────────
 */
describe('what the mutation run caught the tests not saying', () => {
  it('skips a stage whose invoice row is gone, instead of crashing on it', async () => {
    /*
     * A stage carries an `invoice_id` whose row this owner cannot read: deleted,
     * or belonging to someone else. Without the guard the next line asks a null
     * for its `.status` and the whole stop dies — every later stage left open on
     * a job that ended, for one dangling pointer.
     */
    dbState.billedStages = [
      { id: 'st-1', invoice_id: 'inv-gone' },
      { id: 'st-2', invoice_id: 'inv-2' },
    ];
    dbState.invoices = { 'inv-2': { id: 'inv-2', status: 'sent' } };
    dbState.closedRows = [{ id: 'st-3' }];

    const result = await run();

    expect(result.ok).toBe(true);
    /* The reachable one still voided — the loop carried on past the gap. */
    expect(result.invoicesVoided).toBe(1);
    expect(voidInvoiceMock).toHaveBeenCalledWith({ invoiceId: 'inv-2', userId: 'user-1' });
  });

  it("passes the owner's reason through to the close", async () => {
    /*
     * The repository writes `cancel_reason` when it is given one, and its own
     * test proves that. This proves the call site HANDS it over — which is the
     * half that was missing, and the half the shared-namespace invariant
     * actually depends on. The owner answered on the stop dialog; dropping the
     * answer here throws it away at the last step.
     */
    await cancelQuoteStages({
      proposalId: 'prop-1',
      userId: 'user-1',
      reason: 'client_stopped',
      note: '  Client paused it.  ',
    });

    expect(stageUpdate()!.row.cancel_reason).toBe('client_stopped');
    /* Trimmed, so an empty textarea cannot store '' and read as a note. */
    expect(stageUpdate()!.row.cancel_note).toBe('Client paused it.');
    expect(stageUpdate()!.row.cancelled_by).toBe('owner');
  });

  it('does not tell an operator to fix a quote by hand on a second press', async () => {
    /*
     * SA S-3. The status update is conditional on `accepted`, so a second press
     * legitimately matches no rows — `stoppedRows` is empty and nothing is
     * wrong. Branching that log on `!stoppedRows` instead of on `statusError`
     * compiles, passes every result assertion, and sends the owner to repair a
     * quote that is already correct.
     */
    dbState.stoppedRows = [];

    const result = await run();

    expect(result.ok).toBe(true);
    expect(result.proposalStopped).toBe(false);
    expect(loggedMessages()).not.toContain(
      'Money stopped but the quote still reads accepted; it needs marking stopped by hand'
    );
  });

  it('DOES tell an operator to fix it by hand when the status update really failed', async () => {
    /* The same line, on the case it exists for — so the test above cannot pass
       by the log never firing at all. */
    dbState.statusError = new Error('deadlock');

    const result = await run();

    /* Loud, and still not a failure of the whole call: the money is stopped,
       which is the part that reaches the client. */
    expect(result.ok).toBe(true);
    expect(result.proposalStopped).toBe(false);
    expect(loggedMessages()).toContain(
      'Money stopped but the quote still reads accepted; it needs marking stopped by hand'
    );
  });
});

describe('the surfaces that drive it', () => {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const read = (p: string) =>
    fs.readFileSync(path.join(process.cwd(), p), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('the route defaults the flag to false', () => {
    const route = read('app/api/business-os/proposals/[id]/stop-payments/route.ts');
    expect(route).toContain('cancel_unpaid_invoice: z.boolean().optional().default(false)');
    expect(route).toContain('cancelUnpaidInvoice: parsed.data.cancel_unpaid_invoice');
  });

  it('the stop dialog offers it as a toggle, off by default', () => {
    const dialog = read('components/crm/contact-drawer/StopQuoteDialog.tsx');
    expect(dialog).toContain('const [cancelUnpaid, setCancelUnpaid] = useState(false)');
    expect(dialog).toContain('cancel_unpaid_invoice: cancelUnpaid');
    expect(dialog).toContain("t('crm.quote.stop.cancel_unpaid_label')");
  });

  it('the payment dialog can call one off on its own', () => {
    // For an invoice stranded before this existed, and for anything stopped by
    // a route that does not pass through the dialog.
    const modal = read('components/crm/contact-drawer/PaymentManagementModal.tsx');
    expect(modal).toContain("body: JSON.stringify({ status: 'cancelled' })");
    expect(modal).toContain('{!isPaid && voidableInvoiceId && (');
  });

  it('and asks twice before doing it', () => {
    const modal = read('components/crm/contact-drawer/PaymentManagementModal.tsx');
    expect(modal).toContain('setConfirmingVoid(true)');
    expect(modal).toContain("t('crm.payment.cancel_invoice_confirm')");
  });
});
