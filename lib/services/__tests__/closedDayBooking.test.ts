/**
 * The owner cannot book a client into a day they closed by accident.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Reported: 7 October was closed for the whole day, and a booking made from the
 * owner's own calendar went straight through — no warning on any screen, a
 * confirmation email naming a day the business is shut, and a reminder on the
 * morning of it. Time off had reached every surface that PUBLISHES an hour and
 * none that TAKES a booking.
 *
 * It is a question, not a law: `allowClosedDay` is the owner answering it, and
 * the dialog's "Book anyway" is what sends it. Both halves are tested, because
 * either one alone is a bug — refusing with no way through would stop a business
 * seeing one client during a holiday, and admitting it silently is what was
 * wrong.
 *
 * NOTHING IS CREATED BY THE REFUSAL, which is asserted directly: the original
 * fault was a row that existed and a client who had been told about it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const mockCheckOverlap = jest.fn();
const mockCreate = jest.fn();
const mockFindById = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: {
    checkOverlap: (...args: unknown[]) => mockCheckOverlap(...args),
    create: (...args: unknown[]) => mockCreate(...args),
    findById: (...args: unknown[]) => mockFindById(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

const mockListTimeOff = jest.fn();
jest.mock('@/lib/repositories/SchedulingTimeOffRepository', () => ({
  schedulingTimeOffRepository: { list: (...args: unknown[]) => mockListTimeOff(...args) },
}));

jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: { isSlotBlockedByExternalEvent: jest.fn().mockResolvedValue(false) },
}));

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

import { createBooking, rescheduleBooking, BookingOnClosedDayError } from '../BookingLifecycleService';

/*
 * Jerusalem, deliberately. The whole class of bug around this feature is a date
 * read on the wrong clock, and a business ahead of UTC is where a 21:00 booking
 * belongs to tomorrow in UTC terms and today in the owner's.
 */
const ZONE = 'Asia/Jerusalem';

const SUKKOT = {
  exception_type: 'unavailable',
  start_date: '2026-10-06',
  end_date: '2026-10-14',
  reason: 'Sukkot',
};

const SHORT_FRIDAY = {
  exception_type: 'custom_hours',
  start_date: '2026-10-23',
  end_date: '2026-10-23',
  custom_hours: { start: '09:00', end: '13:00' },
  reason: 'Early finish',
};

/** 10:00–11:00 Jerusalem on the given date. */
const at = (date: string, from = '07:00', to = '08:00') => ({
  startTime: `${date}T${from}:00.000Z`,
  endTime: `${date}T${to}:00.000Z`,
});

function book(over: Record<string, unknown> = {}) {
  return createBooking({
    userId: 'user-1',
    serviceId: 'service-1',
    contactId: 'contact-1',
    timezone: ZONE,
    ...at('2026-10-07'),
    ...over,
  } as Parameters<typeof createBooking>[0]);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckOverlap.mockResolvedValue({ data: [], error: null });
  mockListTimeOff.mockResolvedValue({ data: [SUKKOT], error: null });
  /*
   * The insert fails on purpose, so reaching it is provable without mocking the
   * invoice, the calendar and the client's email — none of which run when it
   * does. What these tests care about is whether the gate opened.
   */
  mockCreate.mockResolvedValue({ data: null, error: new Error('reached the insert') });

  // An existing 10:00–11:00 Jerusalem appointment on an open day, carrying the
  // business's zone the way every row does.
  mockFindById.mockResolvedValue({
    data: {
      id: 'booking-1',
      start_time: '2026-10-20T07:00:00.000Z',
      end_time: '2026-10-20T08:00:00.000Z',
      timezone: ZONE,
    },
    error: null,
  });
  mockUpdate.mockResolvedValue({ data: null, error: new Error('reached the update') });
});

describe('a day the owner closed', () => {
  it('is refused, and says which day and why', async () => {
    const result = await book();

    expect(result.error).toBeInstanceOf(BookingOnClosedDayError);
    const error = result.error as BookingOnClosedDayError;
    expect(error.kind).toBe('all_day');
    expect(error.dateKey).toBe('2026-10-07');
    expect(error.closedReason).toBe('Sukkot');
  });

  it('creates nothing', async () => {
    await book();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('asks only about the day being booked', async () => {
    await book();
    expect(mockListTimeOff).toHaveBeenCalledWith('user-1', { from: '2026-10-07', to: '2026-10-07' });
  });

  it('is booked when the owner says book it anyway', async () => {
    const result = await book({ allowClosedDay: true });

    expect(result.error?.message).toBe('reached the insert');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    // And the question was not even asked — the answer is already in.
    expect(mockListTimeOff).not.toHaveBeenCalled();
  });
});

describe('a day with nothing recorded against it', () => {
  it('goes through untouched', async () => {
    const result = await book(at('2026-10-20'));

    expect(result.error).not.toBeInstanceOf(BookingOnClosedDayError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('a short day', () => {
  beforeEach(() => mockListTimeOff.mockResolvedValue({ data: [SHORT_FRIDAY], error: null }));

  it('admits an hour inside the hours it is open', async () => {
    // 07:00Z is 10:00 in Jerusalem, inside 09:00–13:00.
    await book(at('2026-10-23', '07:00', '08:00'));
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it('refuses one past closing, and names the hours', async () => {
    // 11:00Z is 14:00 in Jerusalem, an hour after it shut.
    const result = await book(at('2026-10-23', '11:00', '12:00'));

    const error = result.error as BookingOnClosedDayError;
    expect(error).toBeInstanceOf(BookingOnClosedDayError);
    expect(error.kind).toBe('short_day');
    expect(error.hours).toEqual({ start: '09:00', end: '13:00' });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('the clock it reads the date on', () => {
  it("is the business's, not UTC", async () => {
    /*
     * 2026-10-05T21:30Z is 00:30 on the 6th in Jerusalem — the first day of the
     * closure. Read as a UTC date this is the 5th, which is open, and the
     * booking would go through on a day the business is shut.
     */
    const result = await book({
      startTime: '2026-10-05T21:30:00.000Z',
      endTime: '2026-10-05T22:30:00.000Z',
    });

    expect(result.error).toBeInstanceOf(BookingOnClosedDayError);
    expect((result.error as BookingOnClosedDayError).dateKey).toBe('2026-10-06');
  });
});

describe('when the list cannot be read', () => {
  it('allows the booking rather than blocking the owner', async () => {
    // A database hiccup must not become "you cannot book anyone today" with a
    // client on the phone. The worst case is what happened before this check
    // existed; the best case is the owner being stopped from working.
    mockListTimeOff.mockResolvedValue({ data: null, error: new Error('db down') });

    const result = await book();

    expect(result.error).not.toBeInstanceOf(BookingOnClosedDayError);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe('a service with no time at all', () => {
  it('is never asked about a closed day', async () => {
    // A course or a product is bought, not booked into an hour, so it has no
    // date to be closed on.
    await book({ startTime: undefined, endTime: undefined });

    expect(mockListTimeOff).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * MOVING ONE, which is the likelier of the two mistakes: a reschedule is
 * usually "some time next week" rather than a date anybody has thought about.
 * ─────────────────────────────────────────────────────────────────────────── */

function move(startTime: string, over: Record<string, unknown> = {}) {
  return rescheduleBooking({
    bookingId: 'booking-1',
    userId: 'user-1',
    startTime,
    ...over,
  } as Parameters<typeof rescheduleBooking>[0]);
}

describe('rescheduling onto a closed day', () => {
  it('is refused, and nothing is written', async () => {
    const result = await move('2026-10-07T07:00:00.000Z');

    expect(result.error).toBeInstanceOf(BookingOnClosedDayError);
    expect((result.error as BookingOnClosedDayError).closedReason).toBe('Sukkot');
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('moves when the owner says move it anyway', async () => {
    const result = await move('2026-10-07T07:00:00.000Z', { allowClosedDay: true });

    expect(result.error?.message).toBe('reached the update');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('reads the day on the BOOKING\'s own clock', async () => {
    /*
     * The booking carries the business's zone; the caller passes none. Read as
     * UTC, 21:30 on the 5th is an open day — in Jerusalem it is already the 6th,
     * the first day of the closure.
     */
    const result = await move('2026-10-05T21:30:00.000Z');

    expect((result.error as BookingOnClosedDayError).dateKey).toBe('2026-10-06');
  });

  it('leaves a move to an open day alone', async () => {
    const result = await move('2026-10-21T07:00:00.000Z');

    expect(result.error).not.toBeInstanceOf(BookingOnClosedDayError);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('keeps the appointment\'s length, so the hours it checks are the real ones', async () => {
    mockListTimeOff.mockResolvedValue({ data: [SHORT_FRIDAY], error: null });

    // 09:30 Jerusalem for an hour, inside 09:00-13:00 — and the hour comes from
    // the booking being moved, because the caller gave no end.
    const result = await move('2026-10-23T06:30:00.000Z');

    expect(result.error).not.toBeInstanceOf(BookingOnClosedDayError);
  });

  it('refuses a move that would run past a short day\'s closing', async () => {
    mockListTimeOff.mockResolvedValue({ data: [SHORT_FRIDAY], error: null });

    // 12:30 Jerusalem for an hour ends at 13:30, half an hour after closing.
    const result = await move('2026-10-23T09:30:00.000Z');

    expect(result.error).toBeInstanceOf(BookingOnClosedDayError);
    expect((result.error as BookingOnClosedDayError).kind).toBe('short_day');
  });
});
