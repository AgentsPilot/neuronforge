/**
 * Paying for a package turns its meetings on.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A package sold up front holds its hours from the moment the client accepts —
 * `pending` is a slot-holding status — and tells them nothing until the money
 * arrives. This is the arrival.
 *
 * The three rules worth guarding, each of which fails quietly if it is wrong:
 *
 *   1. ONLY `pending` MOVES. That is what makes a redelivered webhook harmless,
 *      and what stops a payment arriving late from resurrecting a meeting the
 *      owner has since cancelled.
 *
 *   2. SCOPED BY OWNER as well as by parent. A container id is a guess away
 *      from another business's package (CLAUDE.md rule 4).
 *
 *   3. AN ORDINARY INVOICE COSTS ONE QUERY. Almost every payment in the
 *      product is not a package, and this runs on all of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

/*
 * The email and the calendar are mocked, not left real.
 *
 * They are reached by dynamic import inside the function, so without this the
 * suite loaded the whole mail stack and the plugin layer and tried to talk to
 * them — one run took 5.8 seconds and the assertions depended on a network.
 * What belongs here is WHAT it asks them for: one email carrying every date,
 * and one calendar event per meeting.
 */
const mockSendConfirmation = jest.fn().mockResolvedValue({ sent: true });
jest.mock('@/lib/services/BookingEmailService', () => ({
  BookingEmailService: {
    sendBookingConfirmation: (...args: unknown[]) => mockSendConfirmation(...args),
  },
}));

const mockSyncToCalendar = jest.fn().mockResolvedValue({ success: true });
jest.mock('@/lib/services/CalendarSyncService', () => ({
  CalendarSyncService: {
    syncBookingToCalendar: (...args: unknown[]) => mockSyncToCalendar(...args),
  },
}));

const mockFindBooking = jest.fn();
jest.mock('@/lib/repositories/SchedulingRepository', () => ({
  schedulingBookingRepository: { findById: (...args: unknown[]) => mockFindBooking(...args) },
  schedulingServiceRepository: {
    findById: jest.fn().mockResolvedValue({ data: { id: 'service-1', service_name: 'Coaching' }, error: null }),
  },
}));

import { confirmPackageOnPayment } from '../confirmPackageOnPayment';
import type { SupabaseClient } from '@supabase/supabase-js';

const PAID_AT = '2026-10-02T09:00:00.000Z';

/** Every filter and payload the fake client was given, for the assertions. */
interface Recorded {
  tables: string[];
  proposalFilters: Array<[string, unknown]>;
  updates: Array<{ table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> }>;
}

function fakeClient(options: {
  proposal?: Record<string, unknown> | null;
  proposalError?: Error | null;
  children?: Array<Record<string, unknown>> | null;
  childrenError?: Error | null;
  containerError?: Error | null;
}): { client: SupabaseClient; recorded: Recorded } {
  const recorded: Recorded = { tables: [], proposalFilters: [], updates: [] };

  const client = {
    from(table: string) {
      recorded.tables.push(table);

      return {
        // ── the proposal lookup ────────────────────────────────────────────
        select() {
          const chain = {
            eq(column: string, value: unknown) {
              recorded.proposalFilters.push([column, value]);
              return chain;
            },
            not(column: string, op: string, value: unknown) {
              recorded.proposalFilters.push([`${column} ${op}`, value]);
              return chain;
            },
            maybeSingle: async () => ({
              data: options.proposal ?? null,
              error: options.proposalError ?? null,
            }),
          };
          return chain;
        },

        // ── the two updates ───────────────────────────────────────────────
        update(payload: Record<string, unknown>) {
          const filters: Array<[string, unknown]> = [];
          recorded.updates.push({ table, payload, filters });

          const chain = {
            eq(column: string, value: unknown) {
              filters.push([column, value]);
              return chain;
            },
            // The children update ends in `.select(...)`; the container one does
            // not, so this has to be awaitable AND chainable — which is what a
            // PostgREST builder is.
            select: async () => ({ data: options.children ?? [], error: options.childrenError ?? null }),
            then: (resolve: (value: { error: Error | null }) => unknown) =>
              resolve({ error: options.containerError ?? null }),
          };
          return chain;
        },
      };
    },
  } as unknown as SupabaseClient;

  return { client, recorded };
}

const PACKAGE_PROPOSAL = {
  id: 'prop-1',
  user_id: 'user-1',
  contact_id: 'contact-1',
  package_booking_id: 'container-1',
  sessions: { dates: ['2026-10-07T09:00:00.000Z'], duration_minutes: 50 },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSendConfirmation.mockResolvedValue({ sent: true });
  mockSyncToCalendar.mockResolvedValue({ success: true });
  mockFindBooking.mockImplementation(async (id: string) => ({
    data: { id, service_id: 'service-1', start_time: '2026-10-07T09:00:00.000Z' },
    error: null,
  }));
});

/*
 * Both times on every row, as the update's own `select` returns them — a
 * meeting with no end is not a meeting, and the email's date list skips one.
 */
const CHILDREN = [
  { id: 'meeting-1', start_time: '2026-10-07T09:00:00.000Z', end_time: '2026-10-07T09:50:00.000Z', occurrence_number: 1 },
  { id: 'meeting-2', start_time: '2026-10-14T09:00:00.000Z', end_time: '2026-10-14T09:50:00.000Z', occurrence_number: 2 },
  { id: 'meeting-3', start_time: '2026-10-21T09:00:00.000Z', end_time: '2026-10-21T09:50:00.000Z', occurrence_number: 3 },
];

describe('an invoice that did not bill a package', () => {
  it('reports nothing and writes nothing', async () => {
    const { client, recorded } = fakeClient({ proposal: null });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result).toEqual({ containerId: null, confirmed: [] });
    expect(recorded.updates).toHaveLength(0);
  });

  it('costs one query, because almost every payment is this one', async () => {
    const { client, recorded } = fakeClient({ proposal: null });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(recorded.tables).toEqual(['proposals']);
  });

  it('asks only about quotes that created a package', async () => {
    const { client, recorded } = fakeClient({ proposal: null });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(recorded.proposalFilters).toEqual([
      ['created_invoice_id', 'inv-1'],
      ['package_booking_id is', null],
    ]);
  });
});

describe('an invoice that paid for a package', () => {
  it('confirms every pending meeting', async () => {
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result).toEqual({
      containerId: 'container-1',
      confirmed: ['meeting-1', 'meeting-2', 'meeting-3'],
    });
  });

  it('moves ONLY the pending ones, and only this owner\'s', async () => {
    const { client, recorded } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    const meetings = recorded.updates[0];
    expect(meetings.payload).toMatchObject({ status: 'confirmed' });
    expect(meetings.filters).toEqual([
      ['parent_booking_id', 'container-1'],
      ['user_id', 'user-1'],
      ['status', 'pending'],
    ]);
  });

  it('marks the purchase itself confirmed and paid', async () => {
    const { client, recorded } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    const container = recorded.updates[1];
    expect(container.payload).toMatchObject({ status: 'confirmed', payment_status: 'paid' });
    expect(container.filters).toEqual([
      ['id', 'container-1'],
      ['user_id', 'user-1'],
    ]);
  });

  it('is harmless the second time, because nothing is pending any more', async () => {
    // A redelivered webhook, or a retry: the `status = pending` filter matches
    // nothing and the result is an empty list rather than a second confirmation.
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: [] });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result).toEqual({ containerId: 'container-1', confirmed: [] });
  });
});

describe('when something fails', () => {
  it('reports nothing rather than guessing, if the quote cannot be read', async () => {
    const { client, recorded } = fakeClient({ proposalError: new Error('db down') });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result).toEqual({ containerId: null, confirmed: [] });
    expect(recorded.updates).toHaveLength(0);
  });

  it('names the package it could not confirm', async () => {
    const { client } = fakeClient({
      proposal: PACKAGE_PROPOSAL,
      childrenError: new Error('update refused'),
    });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    // The container is still reported: the caller logs it, and the meetings are
    // left pending with their slots held rather than lost.
    expect(result).toEqual({ containerId: 'container-1', confirmed: [] });
  });

  it('still reports the meetings when only the purchase row fails', async () => {
    const { client } = fakeClient({
      proposal: PACKAGE_PROPOSAL,
      children: CHILDREN,
      containerError: new Error('update refused'),
    });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result.confirmed).toHaveLength(3);
  });
});

describe('what the client and the calendar are told', () => {
  it('sends ONE email, carrying every date', async () => {
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(mockSendConfirmation).toHaveBeenCalledTimes(1);
    const [bookingId, userId, options] = mockSendConfirmation.mock.calls[0];
    // Addressed to the FIRST meeting, with the whole block attached.
    expect(bookingId).toBe('meeting-1');
    expect(userId).toBe('user-1');
    expect(options.sessions).toHaveLength(3);
    expect(options.sessions[0].start.toISOString()).toBe('2026-10-07T09:00:00.000Z');
  });

  it('puts the meetings in order, whatever order the database returned them in', async () => {
    const shuffled = [CHILDREN[2], CHILDREN[0], CHILDREN[1]];
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: shuffled });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    const [bookingId, , options] = mockSendConfirmation.mock.calls[0];
    expect(bookingId).toBe('meeting-1');
    expect(options.sessions.map((s: { start: Date }) => s.start.toISOString())).toEqual([
      '2026-10-07T09:00:00.000Z',
      '2026-10-14T09:00:00.000Z',
      '2026-10-21T09:00:00.000Z',
    ]);
  });

  it('creates a calendar event for each meeting', async () => {
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(mockSyncToCalendar).toHaveBeenCalledTimes(3);
  });

  it('still reports the meetings as confirmed when the email fails', async () => {
    // The appointments exist; an email that did not go out is re-sendable, and
    // failing here would leave a settled payment the caller retries.
    mockSendConfirmation.mockRejectedValue(new Error('smtp down'));
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: CHILDREN });

    const result = await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(result.confirmed).toHaveLength(3);
    expect(mockSyncToCalendar).toHaveBeenCalledTimes(3);
  });

  it('says nothing to anyone when nothing was pending', async () => {
    const { client } = fakeClient({ proposal: PACKAGE_PROPOSAL, children: [] });

    await confirmPackageOnPayment(client, 'inv-1', PAID_AT);

    expect(mockSendConfirmation).not.toHaveBeenCalled();
    expect(mockSyncToCalendar).not.toHaveBeenCalled();
  });
});
