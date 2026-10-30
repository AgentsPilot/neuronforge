/**
 * Accepting a quote that sold several meetings.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Until now an accepted quote could own at most ONE meeting, and `applyAcceptance`
 * created none at all — it raised the money and stopped. A package is the first
 * purchase that owns six, so these tests are about the three things that can go
 * wrong in the wiring rather than about the arithmetic:
 *
 *   1. THE CONTAINER MUST HAVE NO TIME. It is a purchase, not an hour. Every
 *      diary path, the overlap check and the exclusion constraint skip a booking
 *      without one, which is why nothing has to exclude a container anywhere. A
 *      container that acquired a range would block the diary for the length of
 *      the engagement.
 *
 *   2. THE STATUS IS READ OFF THE MONEY, never stored twice. Paid up front →
 *      `pending` until it clears; pay per session → `confirmed`, because there
 *      is nothing to wait for.
 *
 *   3. ONE LOST DATE MUST NOT LOSE THE PACKAGE. A slot can be taken between the
 *      quote being sent and accepted, and the database now refuses that write.
 *      The client has agreed and possibly paid: five of six meetings and a named
 *      sixth is the only answer the owner can act on.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockCreateBooking = jest.fn();
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    create: (...args: unknown[]) => mockCreateBooking(...args),
    createMeeting: (...args: unknown[]) => mockCreateMeeting(...args),
  },
}));

/* A package's sessions are rows in `scheduling_meetings`, not child bookings. */
const mockCreateMeeting = jest.fn();

const mockFindTimezone = jest.fn();
jest.mock('@/lib/repositories/UserPreferencesRepository', () => ({
  userPreferencesRepository: { findTimezone: (...args: unknown[]) => mockFindTimezone(...args) },
}));

const mockCreateInvoice = jest.fn();
const mockNextNumber = jest.fn();
jest.mock('@/lib/repositories/PaymentRepository', () => ({
  paymentInvoiceRepository: {
    create: (...args: unknown[]) => mockCreateInvoice(...args),
    getNextInvoiceNumber: (...args: unknown[]) => mockNextNumber(...args),
  },
}));

const mockCreatePlan = jest.fn();
const mockCreateInstallments = jest.fn();
const mockUpdateInstallment = jest.fn();
jest.mock('@/lib/repositories/PaymentPlanRepository', () => ({
  paymentPlanRepository: {
    create: (...args: unknown[]) => mockCreatePlan(...args),
    createInstallments: (...args: unknown[]) => mockCreateInstallments(...args),
    updateInstallment: (...args: unknown[]) => mockUpdateInstallment(...args),
  },
}));

jest.mock('@/lib/repositories/BusinessProfileRepository', () => ({
  businessProfileRepository: {
    getPaymentTermsDays: jest.fn().mockResolvedValue({ data: 14, error: null }),
  },
}));

jest.mock('@/lib/repositories/CRMContactRepository', () => ({
  crmContactRepository: {
    findById: jest.fn().mockResolvedValue({
      data: { id: 'contact-1', email: 'client@example.com', first_name: 'Dana' },
      error: null,
    }),
  },
}));

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REMINDER SERVICE, WHICH THIS SUITE WAS REACHING FOR REAL.
 *
 * `raiseInvoice` schedules the chase through a deliberately dynamic
 * `await import()` — the reminder service reaches a PDF renderer Jest cannot
 * transform, so a static import would make the module unloadable here. That
 * same dynamic import meant it was never mocked: the real service, holding a
 * client bound to `supabaseServer` at module load, read `business_profiles`
 * twice per invoice raised. Twelve real HTTP calls to a host that does not
 * resolve, every one discarded by the `.catch()` below.
 *
 * `scheduleInvoiceReminders` MUST return a promise. The subject destructures
 * the named export and chains `.catch()` on the result; a mock without this key
 * throws a TypeError inside the enclosing `try`, which returns a null invoice
 * id and quietly breaks the money assertions in this file.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const mockScheduleReminders = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/services/PaymentReminderService', () => ({
  paymentReminderService: {
    scheduleInvoiceReminders: (...args: unknown[]) => mockScheduleReminders(...args),
  },
}));

import { applyAcceptance } from '../ProposalAcceptanceService';
import type { Proposal } from '@/lib/repositories/ProposalRepository';

const DATES = ['2026-10-07T09:00:00.000Z', '2026-10-14T09:00:00.000Z', '2026-10-21T09:00:00.000Z'];

function quote(over: Partial<Proposal> & { sessions?: unknown } = {}): Proposal {
  return {
    id: 'prop-1',
    user_id: 'user-1',
    contact_id: 'contact-1',
    service_id: 'service-1',
    booking_id: 'booking-0',
    title: 'Six coaching sessions',
    total: 3000,
    currency: 'ILS',
    payment_shape: { kind: 'single' },
    sessions: { dates: DATES, duration_minutes: 50 },
    ...over,
  } as unknown as Proposal;
}

/** Every `create` succeeds, each row getting its own id. */
function bookingsSucceed() {
  mockCreateBooking.mockImplementation(async () => ({ data: { id: 'container-1' }, error: null }));

  let n = 0;
  mockCreateMeeting.mockImplementation(async () => {
    n += 1;
    return { data: { id: `meeting-${n}` }, error: null };
  });
}

/** The bookings written. For a package that is exactly one: the purchase. */
const createdRows = () => mockCreateBooking.mock.calls.map(call => call[0]);
/** The sessions written, in the order sold. */
const createdMeetings = () => mockCreateMeeting.mock.calls.map(call => call[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockFindTimezone.mockResolvedValue({ data: 'Asia/Jerusalem', error: null });
  mockNextNumber.mockResolvedValue({ data: 'INV-0001', error: null });
  mockCreateInvoice.mockResolvedValue({ data: { id: 'inv-1' }, error: null });
  mockCreatePlan.mockResolvedValue({ data: { id: 'plan-1' }, error: null });
  mockCreateInstallments.mockResolvedValue({ data: [{ id: 'stage-1', installment_number: 1 }], error: null });
  mockUpdateInstallment.mockResolvedValue({ data: null, error: null });
  /* Set here as well as at the factory: a reminder mock that does not return a
     promise breaks the money path, not just the reminder assertions. */
  mockScheduleReminders.mockResolvedValue(undefined);
  bookingsSucceed();
});

describe('a quote that is not a package', () => {
  it('creates no bookings at all', async () => {
    const result = await applyAcceptance(quote({ sessions: null }));

    // The behaviour every quote written before this feature existed must keep.
    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(result.package).toBeNull();
    expect(result.invoiceId).toBe('inv-1');
  });

  it('is not a package because it has an empty date list either', async () => {
    await applyAcceptance(quote({ sessions: { dates: [], duration_minutes: 50 } }));
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });

  it('or because its dates are not dates', async () => {
    await applyAcceptance(quote({ sessions: { dates: ['next Tuesday'], duration_minutes: 50 } }));
    expect(mockCreateBooking).not.toHaveBeenCalled();
  });
});

describe('the container', () => {
  it('has no time of its own', async () => {
    await applyAcceptance(quote());

    // The whole reason nothing needs excluding anywhere: the availability
    // paths and the exclusion constraint both skip a booking with no times.
    expect(createdRows()[0]).toMatchObject({ start_time: null, end_time: null });
  });

  it('is not itself a meeting of the package', async () => {
    await applyAcceptance(quote());

    const container = createdRows()[0];
    expect(container.parent_booking_id).toBeUndefined();
    expect(container.occurrence_number).toBeUndefined();
  });

  it('is the ONLY booking written, however many sessions were sold', async () => {
    /*
     * Three dates used to be three more bookings, pointed at the container by
     * `parent_booking_id`. Seven rows for one purchase made every reader that
     * asks "what has this client bought" count wrong unless it knew to filter.
     */
    await applyAcceptance(quote());

    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(createdMeetings()).toHaveLength(3);
  });

  it('owns every session, in the order the owner chose', async () => {
    const result = await applyAcceptance(quote());

    const sessions = createdMeetings();
    expect(sessions.map(m => m.booking_id)).toEqual(['container-1', 'container-1', 'container-1']);
    /*
     * The SESSION number counts which of the three this is. `occurrence_number`
     * stays 1 on all of them: it counts ATTEMPTS at one appointment, and
     * numbering the sessions with it would make session 2 read as session 1
     * moved — which the slot rules then treat as session 1 giving its hour
     * back (20261085, 20261086).
     */
    expect(sessions.map(m => m.session_number)).toEqual([1, 2, 3]);
    expect(sessions.map(m => m.occurrence_number)).toEqual([1, 1, 1]);
    expect(result.package).toEqual({
      container: 'container-1',
      created: 3,
      // In the order sold, because the per-session money binds stage i to
      // meeting i by position.
      meetings: ['meeting-1', 'meeting-2', 'meeting-3'],
      clashed: [],
    });
  });
});

describe('each meeting', () => {
  it('starts when it was sold and runs for the agreed length', async () => {
    await applyAcceptance(quote());

    expect(createdMeetings()[0]).toMatchObject({
      start_time: '2026-10-07T09:00:00.000Z',
      end_time: '2026-10-07T09:50:00.000Z',
    });
  });

  it('carries the business clock, not the repository default', async () => {
    await applyAcceptance(quote());

    // `'UTC'` here would print an hour nobody chose in the confirmation email.
    expect(createdRows().every(row => row.timezone === 'Asia/Jerusalem')).toBe(true);
    expect(createdMeetings().every(row => row.timezone === 'Asia/Jerusalem')).toBe(true);
  });

  it('falls back to a usable zone when none is stored', async () => {
    mockFindTimezone.mockResolvedValue({ data: null, error: null });

    await applyAcceptance(quote());

    expect(createdMeetings()[0].timezone).toBeTruthy();
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(mockCreateMeeting).toHaveBeenCalledTimes(3);
  });

  it('reads the clock through a method the real repository actually has (F-13)', () => {
    // The mock above supplies its own `findTimezone`, so this suite stayed
    // green while the real method was missing and every package acceptance
    // threw in production. Pin the mock to the real class.
    const actual = jest.requireActual<typeof import('@/lib/repositories/UserPreferencesRepository')>(
      '@/lib/repositories/UserPreferencesRepository'
    );
    expect(typeof actual.UserPreferencesRepository.prototype.findTimezone).toBe('function');
  });
});

describe('the status, read off how the package is paid for', () => {
  it('is pending when the client pays up front', async () => {
    await applyAcceptance(quote({ payment_shape: { kind: 'single' } } as Partial<Proposal>));

    /*
     * The slots are held so nobody else takes them; `settleInvoicePaid`
     * confirms them and sends the one email when the money lands.
     *
     * One status now, on the purchase. A session is a meeting, and a meeting's
     * row records what HAPPENED at it rather than whether the job is paid for
     * — which is also why confirming a paid package is a single-row update.
     */
    expect(createdRows().every(row => row.status === 'pending')).toBe(true);
    expect(createdMeetings().every(row => 'status' in row)).toBe(false);
  });

  it('is confirmed when the client pays per session', async () => {
    await applyAcceptance(
      quote({
        payment_shape: {
          kind: 'milestones',
          stages: [
            { label: 'Session 1', percent: 50 },
            { label: 'Session 2', percent: 50 },
          ],
        },
      } as Partial<Proposal>)
    );

    // Nothing to wait for: leaving these pending would chase money that is not
    // due until the meeting happens.
    expect(createdRows().every(row => row.status === 'confirmed')).toBe(true);
  });
});

describe('a date that was taken in the meantime', () => {
  const taken = Object.assign(new Error('conflicting key value violates exclusion constraint'), {
    code: '23P01',
  });

  beforeEach(() => {
    mockCreateBooking.mockImplementation(async () => ({ data: { id: 'container-1' }, error: null }));

    /*
     * The refusal now comes from `scheduling_meetings_no_overlap` (20261085)
     * rather than the bookings constraint — which is the only one that CAN
     * refuse a package session, since the container carries no time and the
     * bookings constraint skips it. Same error code, same handling.
     */
    let n = 0;
    mockCreateMeeting.mockImplementation(async () => {
      n += 1;
      if (n === 2) return { data: null, error: taken };
      return { data: { id: `meeting-${n}` }, error: null };
    });
  });

  it('does not lose the other meetings', async () => {
    const result = await applyAcceptance(quote());

    expect(result.package).toEqual({
      container: 'container-1',
      created: 2,
      // The one that clashed is simply absent — the others keep their order.
      meetings: ['meeting-1', 'meeting-3'],
      clashed: ['2026-10-14T09:00:00.000Z'],
    });
  });

  it('still raises the money, because the client has agreed', async () => {
    const result = await applyAcceptance(quote());

    expect(result.invoiceId).toBe('inv-1');
    expect(result.dueNow).toBe(3000);
  });

  it('names the date, so the owner can offer another time', async () => {
    const result = await applyAcceptance(quote());
    expect(result.package?.clashed).toContain('2026-10-14T09:00:00.000Z');
  });
});

describe('what it refuses to guess', () => {
  it('creates nothing when the quote names no service', async () => {
    // `scheduling_bookings.service_id` is NOT NULL, and the service is what
    // names each meeting in the diary. Inventing one would be worse than the
    // money sitting there visibly unmet.
    const result = await applyAcceptance(quote({ service_id: null } as unknown as Partial<Proposal>));

    expect(mockCreateBooking).not.toHaveBeenCalled();
    expect(result.package).toBeNull();
    expect(result.invoiceId).toBe('inv-1');
  });

  it('creates no meetings when the container itself fails', async () => {
    mockCreateBooking.mockResolvedValueOnce({ data: null, error: new Error('db down') });

    const result = await applyAcceptance(quote());

    // Orphan meetings belonging to no purchase are worse than none: nothing
    // would ever group them, and the drawer counts by the container.
    expect(mockCreateBooking).toHaveBeenCalledTimes(1);
    expect(result.package).toBeNull();
  });
});

describe('the money is untouched by any of this', () => {
  it('raises the single invoice exactly as a non-package quote does', async () => {
    await applyAcceptance(quote());

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    expect(mockCreatePlan).not.toHaveBeenCalled();
  });

  it('asks for the invoice to be chased, for this client and this invoice', async () => {
    await applyAcceptance(quote());

    expect(mockScheduleReminders).toHaveBeenCalledTimes(1);
    expect(mockScheduleReminders).toHaveBeenCalledWith(
      'user-1',
      'inv-1',
      'contact-1',
      expect.any(String)
    );
  });

  it('still accepts the quote when the chase cannot be scheduled', async () => {
    /*
     * Non-blocking by construction: the acceptance is already committed and the
     * client already owes the deposit, so a reminder that could not be
     * scheduled must not undo any of it. This is the assertion the suite was
     * missing while it made the call for real and threw the answer away.
     */
    mockScheduleReminders.mockRejectedValue(new Error('reminder queue down'));

    await applyAcceptance(quote());

    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    expect(createdRows()).toHaveLength(1);
  });

  it('bills a per-session package through its stages, not through the meetings', async () => {
    await applyAcceptance(
      quote({
        payment_shape: {
          kind: 'milestones',
          stages: [
            { label: 'Session 1', percent: 50 },
            { label: 'Session 2', percent: 50 },
          ],
        },
      } as Partial<Proposal>)
    );

    // One invoice for the first stage, never one per meeting — which is also
    // why the meetings are written through the repository rather than through
    // `createBooking`, whose job includes raising one.
    expect(mockCreatePlan).toHaveBeenCalledTimes(1);
    expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * A PACKAGE BILLED AFTER EACH MEETING.
 *
 * The client approves and owes NOTHING: the stages are the meetings, and a
 * meeting that has not happened is not owed for. So every stage is `manual`
 * — including the first, which is the one difference from an ordinary
 * milestone plan — and each is bound to its own meeting, which is what lets
 * marking meeting three as held bill meeting three and nothing else.
 * ─────────────────────────────────────────────────────────────────────────── */

const PER_SESSION = {
  payment_shape: {
    kind: 'milestones',
    stages: [
      { label: 'Meeting 1', percent: 33.3333 },
      { label: 'Meeting 2', percent: 33.3333 },
      { label: 'Meeting 3', percent: 33.3334 },
    ],
  },
  sessions: { dates: DATES, duration_minutes: 50, bill_per_session: true },
} as unknown as Partial<Proposal>;

const stageRows = () => mockCreateInstallments.mock.calls[0][0] as Array<Record<string, unknown>>;

describe('a package billed after each meeting', () => {
  it('raises no invoice on approval', async () => {
    const result = await applyAcceptance(quote(PER_SESSION));

    // Billing the first session before it happens is the opposite of what the
    // client agreed to — and it would be chased while the session sat ahead.
    expect(mockCreateInvoice).not.toHaveBeenCalled();
    expect(result.invoiceId).toBeNull();
    expect(result.dueNow).toBe(0);
    expect(result.planId).toBe('plan-1');
  });

  it('makes every stage wait for the owner, including the first', async () => {
    await applyAcceptance(quote(PER_SESSION));

    expect(stageRows().map(row => row.trigger)).toEqual(['manual', 'manual', 'manual']);
    expect(stageRows().map(row => row.due_date)).toEqual([null, null, null]);
  });

  it('binds each stage to its own meeting', async () => {
    await applyAcceptance(quote(PER_SESSION));

    /*
     * The whole mechanism: marking session 2 held must bill stage 2.
     *
     * This used to be `booking_id`, and could be, while each session was its
     * own child booking. Now that all three share one booking, that column can
     * no longer tell them apart — a lookup keyed on it finds all three and
     * bills the lowest-numbered one whichever session happened. So the binding
     * is `meeting_id`, and `booking_id` goes back to meaning the job the money
     * belongs to.
     */
    expect(stageRows().map(row => row.meeting_id)).toEqual(['meeting-1', 'meeting-2', 'meeting-3']);
    expect(stageRows().map(row => row.booking_id)).toEqual(['container-1', 'container-1', 'container-1']);
  });

  it('still creates the package confirmed, because nothing is being waited for', async () => {
    await applyAcceptance(quote(PER_SESSION));

    expect(createdRows().every(row => row.status === 'confirmed')).toBe(true);
  });

  it('splits the money evenly across the meetings', async () => {
    await applyAcceptance(quote(PER_SESSION));

    const amounts = stageRows().map(row => Number(row.amount));
    expect(amounts.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(amounts).toHaveLength(3);
  });
});

describe('a staged quote that is NOT a package', () => {
  it('keeps billing its deposit on acceptance', async () => {
    // The behaviour every quoted job has: stage 1 dated and billed now, the
    // rest waiting on the owner. Nothing about per-session may leak into it.
    const result = await applyAcceptance(
      quote({
        sessions: null,
        payment_shape: {
          kind: 'milestones',
          stages: [
            { label: 'Deposit', percent: 50 },
            { label: 'On completion', percent: 50 },
          ],
        },
      } as unknown as Partial<Proposal>)
    );

    expect(result.invoiceId).toBe('inv-1');
    expect(result.dueNow).toBe(1500);
    expect(stageRows().map(row => row.trigger)).toEqual(['date', 'manual']);
  });

  it('and a package with phases rather than sessions still bills its deposit', async () => {
    // `bill_per_session` absent: six sessions sold as deposit-and-balance is a
    // legitimate arrangement, and it is the flag alone that distinguishes them.
    const result = await applyAcceptance(
      quote({
        payment_shape: {
          kind: 'milestones',
          stages: [
            { label: 'Deposit', percent: 50 },
            { label: 'On completion', percent: 50 },
          ],
        },
        sessions: { dates: DATES, duration_minutes: 50 },
      } as unknown as Partial<Proposal>)
    );

    expect(result.invoiceId).toBe('inv-1');
    expect(stageRows()[0].trigger).toBe('date');
  });
});
