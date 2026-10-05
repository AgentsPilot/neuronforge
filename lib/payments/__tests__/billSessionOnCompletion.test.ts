/**
 * Marking a package session as held is what bills it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A block sold "after each meeting" is approved owing nothing: ten meetings,
 * ten manual stages, each bound to its own meeting. Nothing bills itself, which
 * is the point — a session that has not happened is not owed for.
 *
 * So this runs on EVERY completed booking in the product, and the two things
 * that matter are what it does on the one that is a session and what it does
 * not do on all the others:
 *
 *   · it never bills a DATED stage, which the reminder cron owns and which
 *     would then be billed twice;
 *   · it bills one stage, the one bound to this booking;
 *   · "already billed" is not a fault — pressing complete twice, or a chat and
 *     a button racing, must leave one invoice.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

/** Every filter the stage lookup applied, in order. */
const filters: Array<[string, unknown]> = [];
let stageRow: Record<string, unknown> | null = null;
let lookupError: Error | null = null;

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: stageRow, error: lookupError }),
        };
        return chain;
      },
    }),
  },
}));

const mockBillStage = jest.fn();
jest.mock('@/lib/services/PaymentStageBillingService', () => ({
  billStage: (...args: unknown[]) => mockBillStage(...args),
}));

import { billSessionOnCompletion } from '../billSessionOnCompletion';

beforeEach(() => {
  jest.clearAllMocks();
  filters.length = 0;
  stageRow = null;
  lookupError = null;
  mockBillStage.mockResolvedValue({
    invoiceId: 'inv-7',
    amount: 500,
    currency: 'ILS',
    description: 'Meeting 3',
    failure: null,
  });
});

describe('an ordinary booking', () => {
  it('bills nothing, because no stage is bound to it', async () => {
    const result = await billSessionOnCompletion('booking-1', 'user-1');

    expect(result).toBeNull();
    expect(mockBillStage).not.toHaveBeenCalled();
  });

  it('is asked about with every filter that makes this safe', async () => {
    await billSessionOnCompletion('booking-1', 'user-1');

    expect(filters).toEqual([
      ['booking_id', 'booking-1'],
      ['user_id', 'user-1'],
      ['status', 'pending'],
      ['trigger', 'manual'],
    ]);
  });
});

describe('a package session', () => {
  beforeEach(() => {
    stageRow = { id: 'stage-3', installment_number: 3, amount: 500, label: 'Meeting 3' };
  });

  it('bills its own stage', async () => {
    const result = await billSessionOnCompletion('meeting-3', 'user-1');

    expect(result).toEqual({ stageId: 'stage-3', invoiceId: 'inv-7', amount: 500 });
  });

  it('refuses to bill a dated stage, whatever the lookup returned', async () => {
    await billSessionOnCompletion('meeting-3', 'user-1');

    // The cron owns dated stages. Without this guard a stage could be billed
    // here and again when its date arrived.
    expect(mockBillStage).toHaveBeenCalledWith('stage-3', 'user-1', {
      expectTrigger: 'manual',
      auditAction: 'PAYMENT_SESSION_BILLED',
    });
  });

  it('reports nothing when the stage was already billed', async () => {
    // Pressing complete twice. One invoice exists, which is the right answer —
    // and it is not a failure to report upward.
    mockBillStage.mockResolvedValue({
      invoiceId: null,
      amount: null,
      currency: null,
      description: null,
      failure: 'already_done',
    });

    expect(await billSessionOnCompletion('meeting-3', 'user-1')).toBeNull();
  });

  it('reports nothing when billing fails, rather than throwing', async () => {
    // The meeting is already marked held by the time this runs; throwing would
    // tell the owner the completion had not been recorded.
    mockBillStage.mockResolvedValue({
      invoiceId: null,
      amount: null,
      currency: null,
      description: null,
      failure: 'invoice_failed',
    });

    expect(await billSessionOnCompletion('meeting-3', 'user-1')).toBeNull();
  });
});

describe('when the stage cannot be read at all', () => {
  it('bills nothing and does not throw', async () => {
    lookupError = new Error('db down');

    expect(await billSessionOnCompletion('meeting-3', 'user-1')).toBeNull();
    expect(mockBillStage).not.toHaveBeenCalled();
  });
});
