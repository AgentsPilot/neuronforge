/**
 * Adding a meeting to a package that is already running.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A block of six is agreed, approved and under way, and then a seventh date is
 * needed: the client missed one, or the course ran long. What has to be true:
 *
 *   · it joins the PURCHASE — the drawer groups by `parent_booking_id`, and a
 *     meeting with none is a separate job again;
 *   · it is NUMBERED after the last one, not by counting: a package whose third
 *     meeting was deleted still has a sixth, and reusing that number would put
 *     two meetings in the same place in the series;
 *   · it raises no invoice of its own — a package's money is the purchase's;
 *   · the MONEY is the owner's answer. Billed like the others only where the
 *     client is already paying session by session, and refused outright on a
 *     package paid up front, where charging more is selling something else.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockGetUser = jest.fn();
jest.mock('@/lib/auth', () => ({ getUser: () => mockGetUser() }));

const mockFindById = jest.fn();
const mockFindChildren = jest.fn();
const mockCreateMeeting = jest.fn();
const mockFindService = jest.fn();
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    findById: (...args: unknown[]) => mockFindById(...args),
    findChildren: (...args: unknown[]) => mockFindChildren(...args),
    createMeeting: (...args: unknown[]) => mockCreateMeeting(...args),
  },
  schedulingServiceRepository: { findById: (...args: unknown[]) => mockFindService(...args) },
}));

const mockClosedDayCheck = jest.fn();

const mockCreateBooking = jest.fn();
class BookingSlotUnavailableError extends Error {}
class BookingOnClosedDayError extends Error {
  constructor(
    readonly kind: string,
    readonly dateKey: string,
    readonly closedReason: string | null,
    readonly hours?: { start: string; end: string }
  ) {
    super('closed');
  }
}
jest.mock('@/lib/services/BookingLifecycleService', () => ({
  createBooking: (...args: unknown[]) => mockCreateBooking(...args),
  closedDayCheck: (...args: unknown[]) => mockClosedDayCheck(...args),
  BookingSlotUnavailableError,
  BookingOnClosedDayError,
}));

const mockSendConfirmation = jest.fn();
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendBookingConfirmation: (...args: unknown[]) => mockSendConfirmation(...args),
  },
}));

const mockSyncCalendar = jest.fn();
jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: { syncBookingToCalendar: (...args: unknown[]) => mockSyncCalendar(...args) },
}));

const mockCreateInstallments = jest.fn();
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: { createInstallments: (...args: unknown[]) => mockCreateInstallments(...args) },
}));

/** Rows per table, set by each test. */
const tables: Record<string, Record<string, unknown> | null> = {};
const planUpdates: Array<Record<string, unknown>> = [];

/**
 * The sessions a container holds as MEETINGS.
 *
 * Empty by default: these suites were written for the old shape, where a
 * package was a container plus one child BOOKING per date, and that is still a
 * shape the route has to serve — a package sold before the split can have a
 * seventh session added today.
 */
let sessionMeetings: Array<Record<string, unknown>> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: () => chain,
          /* The sessions read asks for rows that HAVE a session number. */
          not: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: tables[table] ?? null, error: null }),
          /*
           * Awaited directly, the way the sessions lookup ends. These suites
           * describe the OLD shape — a container with child bookings — so the
           * default is no session meetings, which is what makes the route take
           * the child-booking path they assert on.
           */
          then: (resolve: (value: { data: unknown; error: null }) => unknown) =>
            resolve({ data: table === 'scheduling_meetings' ? sessionMeetings : [], error: null }),
        };
        return chain;
      },
      update: (payload: Record<string, unknown>) => {
        if (table === 'payment_plans') planUpdates.push(payload);
        const chain: Record<string, unknown> = { eq: () => chain, then: (r: (v: unknown) => unknown) => r({ error: null }) };
        return chain;
      },
    }),
  },
}));

jest.mock('@/lib/services/AuditTrailService', () => ({
  AuditTrailService: { getInstance: () => ({ log: jest.fn().mockResolvedValue(undefined) }) },
}));

import { POST } from '../route';

const CONTAINER = {
  id: 'container-1',
  user_id: 'user-1',
  service_id: 'service-1',
  contact_id: 'contact-1',
  timezone: 'America/New_York',
  status: 'confirmed',
  parent_booking_id: null,
  start_time: null,
};

/** Six meetings, the third of which was deleted — so the last number is 6. */
const SIBLINGS = [1, 2, 4, 5, 6].map(n => ({ id: `m${n}`, occurrence_number: n }));

function post(body: unknown, id = 'container-1') {
  return [
    new Request(`http://localhost/api/scheduling/bookings/${id}/meetings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }) as unknown as Parameters<typeof POST>[0],
    { params: { id } },
  ] as const;
}

const WHEN = '2026-12-31T14:30:00.000Z';

beforeEach(() => {
  jest.clearAllMocks();
  planUpdates.length = 0;
  mockGetUser.mockResolvedValue({ id: 'user-1' });
  mockFindById.mockResolvedValue({ data: CONTAINER, error: null });
  mockFindChildren.mockResolvedValue({ data: SIBLINGS, error: null });
  mockCreateBooking.mockResolvedValue({
    data: { booking: { id: 'm7' }, clientNotified: true },
    error: null,
  });
  mockCreateInstallments.mockResolvedValue({ data: [{ id: 'stage-7' }], error: null });
  mockCreateMeeting.mockResolvedValue({ data: { id: 'meeting-7' }, error: null });
  mockFindService.mockResolvedValue({ data: { id: 'service-1', service_name: 'Coaching' }, error: null });
  mockClosedDayCheck.mockResolvedValue(null);
  mockSendConfirmation.mockResolvedValue({ sent: true });
  mockSyncCalendar.mockResolvedValue({ success: true });
  sessionMeetings = [];

  tables.proposals = {
    id: 'prop-1',
    title: 'Six coaching sessions',
    currency: 'ILS',
    created_plan_id: 'plan-1',
    contact_id: 'contact-1',
    sessions: { dates: [], duration_minutes: 50, bill_per_session: true },
  };
  tables.payment_plan_installments = { amount: 83.33, currency: 'ILS', installment_number: 6 };
  tables.payment_plans = { total_amount: 500, installment_count: 6 };
});

describe('the meeting itself', () => {
  it('joins the purchase, numbered after the last one', async () => {
    const response = await POST(...post({ start_time: WHEN }));

    expect(response.status).toBe(200);
    const [params] = mockCreateBooking.mock.calls[0];
    expect(params.parentBookingId).toBe('container-1');
    // Six is the highest, even though only five meetings exist.
    expect(params.occurrenceNumber).toBe(7);
  });

  it('raises no invoice of its own', async () => {
    await POST(...post({ start_time: WHEN }));

    expect(mockCreateBooking.mock.calls[0][0].createInvoice).toBe(false);
  });

  it('runs for the length the package was sold at', async () => {
    await POST(...post({ start_time: WHEN }));

    const { startTime, endTime } = mockCreateBooking.mock.calls[0][0];
    expect(new Date(endTime).getTime() - new Date(startTime).getTime()).toBe(50 * 60_000);
  });

  it('follows the purchase into pending while it is unpaid', async () => {
    mockFindById.mockResolvedValue({ data: { ...CONTAINER, status: 'pending' }, error: null });

    await POST(...post({ start_time: WHEN }));

    expect(mockCreateBooking.mock.calls[0][0].status).toBe('pending');
  });
});

describe('the money', () => {
  it('bills nothing unless the owner says so', async () => {
    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(mockCreateInstallments).not.toHaveBeenCalled();
    expect(body.charged).toBe(false);
  });

  it('adds a stage at the rate the client has been paying', async () => {
    const response = await POST(...post({ start_time: WHEN, charge: true }));
    const body = await response.json();

    const [[rows]] = mockCreateInstallments.mock.calls;
    expect(rows[0]).toMatchObject({
      booking_id: 'm7',
      amount: 83.33,
      trigger: 'manual',
      due_date: null,
      status: 'pending',
      installment_number: 7,
    });
    expect(body.charged).toBe(true);
  });

  it('grows the plan with it, so the total and the stages agree', async () => {
    await POST(...post({ start_time: WHEN, charge: true }));

    expect(planUpdates[0]).toMatchObject({ total_amount: 583.33, installment_count: 7 });
  });

  it('refuses to charge for a package that was paid up front', async () => {
    tables.proposals = { ...tables.proposals, sessions: { dates: [], duration_minutes: 50 } };

    const response = await POST(...post({ start_time: WHEN, charge: true }));
    const body = await response.json();

    // The client paid one agreed sum. Billing more is selling them something
    // else, which is a quote and not a button.
    expect(response.status).toBe(400);
    expect(body.code).toBe('cannot_charge_upfront_package');
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it('still adds the meeting to an up-front package, free', async () => {
    tables.proposals = { ...tables.proposals, sessions: { dates: [], duration_minutes: 50 } };

    const response = await POST(...post({ start_time: WHEN }));

    expect(response.status).toBe(200);
    expect(mockCreateInstallments).not.toHaveBeenCalled();
  });
});

describe('what it refuses', () => {
  it('a caller with no session', async () => {
    mockGetUser.mockResolvedValue(null);
    const response = await POST(...post({ start_time: WHEN }));
    expect(response.status).toBe(401);
  });

  it('a booking that is itself a meeting', async () => {
    mockFindById.mockResolvedValue({
      data: { ...CONTAINER, parent_booking_id: 'container-1' },
      error: null,
    });

    const response = await POST(...post({ start_time: WHEN }));
    expect((await response.json()).code).toBe('not_a_package');
  });

  it('an ordinary booking that owns no meetings', async () => {
    mockFindChildren.mockResolvedValue({ data: [], error: null });

    const response = await POST(...post({ start_time: WHEN }));
    expect((await response.json()).code).toBe('not_a_package');
  });

  it('a date that is not a date', async () => {
    const response = await POST(...post({ start_time: 'next Tuesday' }));
    expect(response.status).toBe(400);
  });
});

describe('when the hour cannot be had', () => {
  it('reports a clash as one', async () => {
    mockCreateBooking.mockResolvedValue({
      data: null,
      error: new BookingSlotUnavailableError('taken'),
    });

    const response = await POST(...post({ start_time: WHEN }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('slot_taken');
  });

  it('reports a closed day with its reason, so the owner can insist', async () => {
    mockCreateBooking.mockResolvedValue({
      data: null,
      error: new BookingOnClosedDayError('all_day', '2026-12-31', 'New Year'),
    });

    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('closed_day');
    expect(body.closed).toMatchObject({ date: '2026-12-31', reason: 'New Year' });
  });

  it('passes the owner’s answer through when they do', async () => {
    await POST(...post({ start_time: WHEN, allow_closed_day: true }));

    expect(mockCreateBooking.mock.calls[0][0].allowClosedDay).toBe(true);
  });
});

describe('a package whose sessions are MEETINGS', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * WHY THIS SHAPE NEEDS ITS OWN PATH, AND WHY GETTING IT WRONG IS WORSE THAN
   * AN ERROR
   *
   * A package is now ONE booking with N rows in `scheduling_meetings`, so
   * `findChildren` returns nothing. Carrying on regardless would add a CHILD
   * BOOKING to a package made of meetings — and because the readers prefer
   * children wherever they exist, that single row would become the entire
   * package on screen and hide the six sessions the client is holding.
   *
   * So the route has to notice, and then give the added session the four
   * things `createBooking` would have given it.
   * ───────────────────────────────────────────────────────────────────────────
   */
  beforeEach(() => {
    mockFindChildren.mockResolvedValue({ data: [], error: null });
    sessionMeetings = [
      { id: 'meeting-6', session_number: 6, meeting_status: null },
      { id: 'meeting-5', session_number: 5, meeting_status: 'held' },
    ];
  });

  it('adds a MEETING, never a child booking', async () => {
    const response = await POST(...post({ start_time: WHEN }));

    expect(response.status).toBe(200);
    expect(mockCreateMeeting).toHaveBeenCalledTimes(1);
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it('numbers it after the last session, and as a first attempt at that session', async () => {
    await POST(...post({ start_time: WHEN }));

    expect(mockCreateMeeting).toHaveBeenCalledWith(
      expect.objectContaining({
        booking_id: 'container-1',
        session_number: 7,
        /* Not 7. That column counts ATTEMPTS at one appointment, and numbering
           sessions with it would read as session 6 having been moved — which
           frees the hour the client still holds. */
        occurrence_number: 1,
      })
    );
  });

  it('refuses the hour the database refuses', async () => {
    /* `scheduling_meetings_no_overlap` is the only constraint that can refuse
       a session: the purchase carries no time, so the bookings constraint
       skips it. */
    mockCreateMeeting.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('conflicting key value'), { code: '23P01' }),
    });

    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('slot_taken');
  });

  it('asks the closed-day question, as the booking path does', async () => {
    mockClosedDayCheck.mockResolvedValue({
      kind: 'all_day',
      error: new BookingOnClosedDayError('all_day', '2026-12-31', 'holiday'),
    });

    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('closed_day');
    expect(mockCreateMeeting).not.toHaveBeenCalled();
  });

  it('and adds it anyway when the owner has said so', async () => {
    await POST(...post({ start_time: WHEN, allow_closed_day: true }));

    expect(mockClosedDayCheck).not.toHaveBeenCalled();
    expect(mockCreateMeeting).toHaveBeenCalledTimes(1);
  });

  it('tells the client, naming the session rather than the purchase', async () => {
    /*
     * The purchase has no clock of its own, so without the session's hour the
     * confirmation announces an Invalid Date to the client.
     */
    await POST(...post({ start_time: WHEN }));

    expect(mockSendConfirmation).toHaveBeenCalledWith(
      'container-1',
      'user-1',
      expect.objectContaining({ sessions: [expect.objectContaining({ start: new Date(WHEN) })] })
    );
  });

  it('records the calendar event on the SESSION', async () => {
    /*
     * Six sessions writing to the purchase's one `external_calendar_event_id`
     * would keep the last and re-create the other five on the next sync.
     */
    await POST(...post({ start_time: WHEN }));

    expect(mockSyncCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ external_calendar_event_id: null }),
      expect.anything(),
      'user-1',
      'meeting-7'
    );
  });

  it('binds a charged session to the meeting, and the job to the purchase', async () => {
    /*
     * The whole point of the split in the money: six stages share the
     * container's `booking_id`, so only `meeting_id` can say which session is
     * owed for. Keyed on the booking, marking session seven held would bill
     * session one.
     */
    await POST(...post({ start_time: WHEN, charge: true }));

    expect(mockCreateInstallments).toHaveBeenCalledWith([
      expect.objectContaining({ booking_id: 'container-1', meeting_id: 'meeting-7' }),
    ]);
  });

  it('is still refused on a package paid up front', async () => {
    tables.proposals = {
      ...(tables.proposals as Record<string, unknown>),
      sessions: { dates: [], duration_minutes: 50, bill_per_session: false },
    };

    const response = await POST(...post({ start_time: WHEN, charge: true }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('cannot_charge_upfront_package');
  });

  it('refuses a booking that is no package in either shape', async () => {
    sessionMeetings = [];

    const response = await POST(...post({ start_time: WHEN }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('not_a_package');
  });
});

describe('what the client reads when a session is added', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * It reused the plain booking confirmation — "הפגישה שלך אושרה" — which is
   * accurate about the hour and silent about everything that makes it
   * different. A client holding six sessions received a mail indistinguishable
   * from one confirming a standalone appointment.
   *
   * And when the owner adds it CHARGED, a stage of its own is created. The
   * client was told nothing about that, so the invoice arrived as a surprise
   * against a package they had already paid for by instalment.
   * ───────────────────────────────────────────────────────────────────────────
   */
  beforeEach(() => {
    mockFindChildren.mockResolvedValue({ data: [], error: null });
    sessionMeetings = [{ id: 'meeting-6', session_number: 6, meeting_status: null }];
  });

  it('says it was added to the package', async () => {
    await POST(...post({ start_time: WHEN }));

    expect(mockSendConfirmation).toHaveBeenCalledWith(
      'container-1',
      'user-1',
      expect.objectContaining({ addedSession: expect.anything() })
    );
  });

  it('and says nothing about money when nothing is charged', async () => {
    await POST(...post({ start_time: WHEN }));

    const options = mockSendConfirmation.mock.calls[0][2] as { addedSession: { chargedAmount: string | null } };
    expect(options.addedSession.chargedAmount).toBeNull();
  });

  it('names the amount when the owner charged for it', async () => {
    /* The one thing the mail has to say that the date does not. */
    await POST(...post({ start_time: WHEN, charge: true }));

    const options = mockSendConfirmation.mock.calls[0][2] as { addedSession: { chargedAmount: string | null } };
    expect(options.addedSession.chargedAmount).toContain('83.33');
  });

  it('and promises no charge the stage failed to create', async () => {
    /*
     * Announcing one would leave the client expecting an invoice nobody can
     * raise, with the owner unaware the two disagreed.
     */
    mockCreateInstallments.mockResolvedValue({ data: null, error: new Error('nope') });

    await POST(...post({ start_time: WHEN, charge: true }));

    const options = mockSendConfirmation.mock.calls[0][2] as { addedSession: { chargedAmount: string | null } };
    expect(options.addedSession.chargedAmount).toBeNull();
  });

  it('tells them after the money is settled, not before', async () => {
    /* The mail has to know whether a stage exists, so it cannot be sent while
       the session is still being written. */
    await POST(...post({ start_time: WHEN, charge: true }));

    expect(mockCreateInstallments).toHaveBeenCalled();
    expect(mockSendConfirmation).toHaveBeenCalled();
    const stageAt = mockCreateInstallments.mock.invocationCallOrder[0];
    const mailAt = mockSendConfirmation.mock.invocationCallOrder[0];
    expect(mailAt).toBeGreaterThan(stageAt);
  });
});
