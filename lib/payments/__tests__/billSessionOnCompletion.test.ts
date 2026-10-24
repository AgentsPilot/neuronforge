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

/** Every filter the stage lookup applied. */
const filters: Array<[string, unknown]> = [];
/** What the lookup finds. Several rows is the ambiguous case. */
let stageRows: Array<Record<string, unknown>> = [];
let lookupError: Error | null = null;
/** How many rows the lookup asked for — 1 is exact, 2 is "is there another?". */
let limitAsked: number | null = null;
/** The columns the select named, so a filter on an unselected one is caught. */
let selected = '';

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({
      select: (columns: string) => {
        selected = columns;
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            filters.push([column, value]);
            return chain;
          },
          order: () => chain,
          limit: async (n: number) => {
            limitAsked = n;
            return { data: stageRows, error: lookupError };
          },
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
  stageRows = [];
  lookupError = null;
  limitAsked = null;
  selected = '';
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

    /* Sorted, because the shared query applies the common filters before the
       key — the set is the guarantee, not the order. */
    expect([...filters].sort()).toEqual(
      [
        ['booking_id', 'booking-1'],
        ['user_id', 'user-1'],
        ['status', 'pending'],
        ['trigger', 'manual'],
      ].sort()
    );
  });
});

describe('a package session', () => {
  beforeEach(() => {
    stageRows = [{ id: 'stage-3', installment_number: 3, amount: 500, label: 'Meeting 3', meeting_id: null }];
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

describe('a package that is ONE booking with many meetings', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUG THIS EXISTS FOR
   *
   * A package used to be a container plus one child booking per date, so the
   * booking said which session unambiguously. It is now one booking with N
   * meetings, which means N stages share one `booking_id`.
   *
   * Keyed on the booking, the lookup takes the lowest `installment_number`. So
   * marking session FOUR as held raises session ONE's invoice, and the sixth
   * press bills a stage the first press already settled. On a path that sends
   * real invoices to real clients.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const sixSessions = [
    { id: 'stage-1', installment_number: 1, amount: 500, label: 'Session 1', meeting_id: 'meeting-1' },
    { id: 'stage-4', installment_number: 4, amount: 500, label: 'Session 4', meeting_id: 'meeting-4' },
  ];

  it('bills the session that happened, not the first one on the job', async () => {
    /* The lookup is keyed on the meeting, so the row it returns IS session 4. */
    stageRows = [sixSessions[1]];

    const result = await billSessionOnCompletion('package-container', 'user-1', 'meeting-4');

    expect(result).toEqual({ stageId: 'stage-4', invoiceId: 'inv-7', amount: 500 });
    expect(mockBillStage).toHaveBeenCalledWith('stage-4', 'user-1', {
      expectTrigger: 'manual',
      auditAction: 'PAYMENT_SESSION_BILLED',
    });
  });

  it('keys on the meeting and not on the booking', async () => {
    stageRows = [sixSessions[1]];

    await billSessionOnCompletion('package-container', 'user-1', 'meeting-4');

    expect(filters).toContainEqual(['meeting_id', 'meeting-4']);
    expect(filters).not.toContainEqual(['booking_id', 'package-container']);
  });

  it('asks for one row when the meeting is named, because it is exact', async () => {
    stageRows = [sixSessions[1]];

    await billSessionOnCompletion('package-container', 'user-1', 'meeting-4');

    expect(limitAsked).toBe(1);
  });

  it('bills NOTHING when several sessions share the booking and none was named', async () => {
    /*
     * The dangerous call: the container completed with no meeting. Guessing
     * would raise session 1's invoice for a session nobody said happened.
     * Unbilled is recoverable — the stage sits pending in the drawer. An
     * invoice already sent is not.
     */
    stageRows = sixSessions;

    expect(await billSessionOnCompletion('package-container', 'user-1')).toBeNull();
    expect(mockBillStage).not.toHaveBeenCalled();
  });

  it('selects meeting_id, or it cannot tell that case apart', async () => {
    /* A column absent from a select is `undefined`, not null, and the check
       above would read every package as unambiguous. */
    stageRows = sixSessions;

    await billSessionOnCompletion('package-container', 'user-1');

    expect(selected).toContain('meeting_id');
  });
});

describe('a milestone plan, which also has several pending manual stages', () => {
  /*
   * This shape must keep working EXACTLY as before. Several manual stages on
   * one consultation booking is ordinary — a deposit then two milestones — and
   * billing the lowest-numbered one is right, because they are a sequence of
   * payments against one job rather than against separate appointments.
   *
   * The thing that separates it from a package is that no stage is bound to a
   * meeting.
   */
  it('bills the lowest-numbered stage, as it always did', async () => {
    stageRows = [
      { id: 'stage-2', installment_number: 2, amount: 300, label: 'On delivery', meeting_id: null },
      { id: 'stage-3', installment_number: 3, amount: 300, label: 'On sign-off', meeting_id: null },
    ];

    const result = await billSessionOnCompletion('consultation-1', 'user-1');

    /* `amount` is the invoice's, which `billStage` decides — not the stage row's. */
    expect(result).toEqual({ stageId: 'stage-2', invoiceId: 'inv-7', amount: 500 });
  });

  it('and a legacy package session still bills off its own child booking', async () => {
    /*
     * Stages written before this change are bound to a child booking and many
     * also carry a backfilled `meeting_id` (45 of 95). One stage per child
     * booking, so the lookup returns one row and there is nothing ambiguous
     * about it — the meeting_id on that row must not make this refuse.
     */
    stageRows = [
      { id: 'stage-legacy', installment_number: 2, amount: 400, label: 'Session 2', meeting_id: 'meeting-old' },
    ];

    const result = await billSessionOnCompletion('legacy-child-booking', 'user-1');

    expect(result).toEqual({ stageId: 'stage-legacy', invoiceId: 'inv-7', amount: 500 });
  });
});

describe('a session that was moved still bills', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * A stage is bound to a MEETING, and moving a session writes a NEW meeting —
   * the old attempt keeps the hour it was for, which is the whole point of
   * recording attempts.
   *
   * So the stage has to come with it. Left behind it names an attempt that no
   * longer happens: `billSessionOnCompletion` is handed the new meeting, finds
   * nothing bound to it, and marking the rebooked session held bills NOTHING.
   * The client sits through a session nobody charges for, and the stage sits
   * pending against an hour that was superseded — visible to no one looking
   * for a problem.
   *
   * The carry happens in `moveMeeting`; this is the behaviour it protects.
   * ───────────────────────────────────────────────────────────────────────────
   */
  it('bills against the attempt that actually happened', async () => {
    stageRows = [
      { id: 'stage-2', installment_number: 2, amount: 500, label: 'Session 2', meeting_id: 'attempt-2' },
    ];

    const result = await billSessionOnCompletion('package-container', 'user-1', 'attempt-2');

    expect(result).toEqual({ stageId: 'stage-2', invoiceId: 'inv-7', amount: 500 });
    expect(filters).toContainEqual(['meeting_id', 'attempt-2']);
  });

  it('and finds nothing when the stage was left on the old one', async () => {
    /*
     * The failure this exists to prevent, stated as a fact about the lookup:
     * keyed on the new attempt, a stage still naming the old one is simply not
     * there — and the whole path reports success by billing nothing.
     */
    stageRows = [];

    expect(await billSessionOnCompletion('package-container', 'user-1', 'attempt-2')).toBeNull();
    expect(mockBillStage).not.toHaveBeenCalled();
  });
});
