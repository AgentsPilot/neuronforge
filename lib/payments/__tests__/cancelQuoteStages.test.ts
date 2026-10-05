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
  selects: Array<{ table: string; filters: Record<string, unknown>; nots: string[]; is: Record<string, unknown> }>;
  updates: Array<{ table: string; row: Record<string, unknown>; filters: Record<string, unknown>; nots: string[]; is: Record<string, unknown> }>;
  closeError: unknown;
  /** Written by the mock itself, so ordering assertions cannot pass by construction. */
  order: string[];
} = {
  proposal: null,
  billedStages: [],
  invoices: {},
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
      const nots: string[] = [];
      let mode: 'select' | 'update' = 'select';
      let updateRow: Record<string, unknown> = {};

      const builder: Record<string, unknown> = {};

      const resolveQuery = () => {
        dbState.selects.push({ table, filters: { ...filters }, nots: [...nots], is: { ...isFilters } });
        if (table === 'payment_plan_installments') {
          return { data: dbState.billedStages, error: null };
        }
        return { data: null, error: null };
      };

      builder.select = () => {
        if (mode === 'update') {
          // Terminal on an update: returns the rows that changed.
          dbState.updates.push({ table, row: updateRow, filters: { ...filters }, nots: [...nots], is: { ...isFilters } });
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

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { cancelQuoteStages } from '../cancelQuoteStages';

const QUOTE = { id: 'prop-1', user_id: 'user-1', booking_id: null, status: 'accepted', title: 'Renovation' };

beforeEach(() => {
  dbState.proposal = { ...QUOTE };
  dbState.billedStages = [];
  dbState.invoices = {};
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
});

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
    expect(statusUpdate()!.filters.id).toBe('prop-1');
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
