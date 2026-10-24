/**
 * The client's own link, when the booking is one meeting of a package.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG
 *
 * The package confirmation carried manage links for the FIRST meeting and for
 * nothing else. Every later meeting's link arrived with its own reminder, 24
 * hours ahead — which, for a service whose notice window is 24 hours, is
 * exactly when the policy stops allowing a change.
 *
 * So a client wanting to cancel session five a month in advance had no way to,
 * and the one time they were handed a link was the time it was refused.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT MUST BE TRUE NOW
 *
 * One link opens the whole block, and each meeting is judged by the SAME rule a
 * single booking is: `min_notice_hours`, read from the service rather than
 * assumed — this page hardcoded 24, so a business asking for 48 told the client
 * they could still cancel and then refused them.
 *
 * Each row carries its own signed token, so Cancel and Reschedule reach the
 * existing routes and are enforced there exactly as before. No new permission
 * is granted: the request has already proved the caller holds a valid token for
 * this client's address.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('@/lib/logger', () => {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn(), child: () => logger };
  return { createLogger: () => logger };
});

const mockVerify = jest.fn();
const mockGenerate = jest.fn((bookingId: string) => `token-for-${bookingId}`);
jest.mock('@/lib/services/bookingToken', () => ({
  verifyBookingToken: (...args: unknown[]) => mockVerify(...args),
  generateBookingToken: (...args: unknown[]) => mockGenerate(...(args as [string])),
}));

jest.mock('@/lib/branding/publicBranding', () => ({
  resolvePublicBranding: jest.fn().mockResolvedValue(null),
}));

/** The booking the token names, and the package rows behind it. */
let booking: Record<string, unknown> | null = null;
let siblings: Array<Record<string, unknown>> = [];
/**
 * The package's sessions in the NEW shape: rows in `scheduling_meetings` on the
 * one booking, rather than child bookings.
 *
 * Empty by default, so the suites below go on describing the old shape — which
 * a client whose package was sold before the split still has, and can still
 * open their link on.
 */
let sessionRows: Array<Record<string, unknown>> = [];
const childFilters: Array<[string, unknown]> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: (table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            childFilters.push([column, value]);
            return chain;
          },
          /* The quote lookup filters out superseded versions. It is unrelated to
             the meetings this file is about, and only has to not break. */
          neq: () => chain,
          /* The money queries address the whole package by id list now, and the
             pay-link lookup filters on a set of statuses. Neither is what this
             file is about; both only have to not break the chain. */
          in: () => chain,
          /* The lookup for the booking a package was SOLD from: the proposal
             link, then the host booking. Empty and null here, so these rows
             report no parent — this file is about the meetings, not the card
             above them. */
          not: () => chain,
          limit: async () => ({ data: [], error: null }),
          maybeSingle: async () => ({ data: null, error: null }),
          /*
           * Thenable AND chainable.
           *
           * The sibling query ends at `.order(...)` and is awaited there; the
           * quote lookup continues `.order(...).limit(1).maybeSingle()`. A bare
           * promise satisfied the first and made the second read `.limit` off a
           * Promise — undefined — which threw inside the route and emptied every
           * assertion in this file.
           */
          /*
           * Thenable, chainable, AND orderable twice.
           *
           * The sessions read orders by `session_number` and then by
           * `occurrence_number` — two calls — because the current attempt at
           * each session is the last one in that order. A single-use `order`
           * made the second call read off a Promise, which is undefined, and
           * the whole helper returned nothing.
           */
          order: function orderable(): unknown {
            const rows = table === 'scheduling_meetings' ? sessionRows : siblings;
            return Object.assign(Promise.resolve({ data: rows, error: null }), {
              order: orderable,
              limit: () => ({
                // No quote on a package meeting; the portal simply finds none.
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            });
          },
          single: async () => ({ data: booking, error: booking ? null : new Error('not found') }),
        };
        return chain;
      },
    }),
  },
}));

import { GET } from '../route';

const EMAIL = 'client@example.test';

/** Hours from now, as an instant. */
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();

function request() {
  return [
    new Request('http://localhost/api/book/manage/tok') as unknown as Parameters<typeof GET>[0],
    { params: Promise.resolve({ token: 'tok' }) },
  ] as const;
}

beforeEach(() => {
  jest.clearAllMocks();
  childFilters.length = 0;
  sessionRows = [];
  mockVerify.mockReturnValue({ bookingId: 'm1', email: EMAIL });

  booking = {
    id: 'm1',
    user_id: 'user-1',
    start_time: inHours(72),
    end_time: inHours(73),
    timezone: 'America/New_York',
    status: 'confirmed',
    payment_status: 'pending',
    notes: null,
    parent_booking_id: 'container-1',
    occurrence_number: 1,
    contact: [{ email: EMAIL, first_name: 'Dana' }],
    service: [{ id: 'service-1', service_name: 'Coaching', min_notice_hours: 24 }],
  };

  siblings = [
    { id: 'm1', start_time: inHours(72), end_time: inHours(73), status: 'confirmed', occurrence_number: 1 },
    { id: 'm2', start_time: inHours(6), end_time: inHours(7), status: 'confirmed', occurrence_number: 2 },
    { id: 'm3', start_time: inHours(240), end_time: inHours(241), status: 'confirmed', occurrence_number: 3 },
    { id: 'm4', start_time: inHours(-48), end_time: inHours(-47), status: 'completed', occurrence_number: 4 },
  ];
});

describe('the token minter', () => {
  it('is actually exported by the module the route imports', () => {
    /*
     * The mock above declares `generateBookingToken` as a named export, so this
     * suite passed green while the real module kept it module-private — and the
     * route failed to import it at runtime, in dev with a warning and a 404 on
     * every client link. A mocked export proves nothing about the real one, so
     * this reads the source.
     *
     * It moved: the token now lives in `lib/services/bookingToken`, a leaf over
     * `jsonwebtoken`, because reaching it through `BookingEmailService` pulled
     * 27,600 lines of email machinery onto every public page. Mocking the old
     * path left the real one unmocked, which is the same class of mistake this
     * test was written for, caught by this test.
     */
    const source = readFileSync(
      join(process.cwd(), 'lib', 'services', 'bookingToken.ts'),
      'utf8'
    );

    expect(source).toMatch(/export function generateBookingToken\(/);
  });

  /*
   * And that the route takes it from there. A correct export in the leaf plus a
   * route still importing from the email service would pass the line above and
   * reintroduce the weight.
   */
  it('is imported by the route from the leaf, not the email service', () => {
    const route = readFileSync(
      join(process.cwd(), 'app', 'api', 'book', 'manage', '[token]', 'route.ts'),
      'utf8'
    );

    expect(route).toMatch(/from '@\/lib\/services\/bookingToken'/);
    expect(route).not.toMatch(/from '@\/lib\/services\/BookingEmailService'/);
  });
});

describe('the select string', () => {
  it('carries nothing but column names', () => {
    /*
     * PostgREST is sent this string verbatim. A JS comment inside it is not
     * stripped by anything: the server rejects the WHOLE select with PGRST100
     * and the page 404s for every client, whether or not their booking is a
     * package. One comment did exactly that.
     */
    const route = readFileSync(
      join(process.cwd(), 'app', 'api', 'book', 'manage', '[token]', 'route.ts'),
      'utf8'
    );

    const selects = [...route.matchAll(/\.select\(\s*`([^`]*)`/g)].map(m => m[1]);

    expect(selects.length).toBeGreaterThan(0);
    for (const select of selects) {
      expect(select).not.toContain('/*');
      expect(select).not.toContain('//');
    }
  });
});

describe('a meeting of a package', () => {
  it('returns the whole block, in the order it was sold', async () => {
    const body = await (await GET(...request())).json();

    expect(body.meetings.map((m: { id: string }) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('asks for the siblings of its PURCHASE, scoped to the owner', async () => {
    await GET(...request());

    expect(childFilters).toContainEqual(['parent_booking_id', 'container-1']);
    expect(childFilters).toContainEqual(['user_id', 'user-1']);
  });

  it('gives each one its own link', async () => {
    const body = await (await GET(...request())).json();

    // The routes behind these are untouched: they verify a token and enforce
    // the notice window exactly as they do for a single booking.
    expect(body.meetings.map((m: { token: string }) => m.token)).toEqual([
      'token-for-m1',
      'token-for-m2',
      'token-for-m3',
      'token-for-m4',
    ]);
    expect(mockGenerate).toHaveBeenCalledWith('m3', EMAIL);
  });
});

describe('the policy, applied per meeting', () => {
  it('allows the ones far enough away', async () => {
    const body = await (await GET(...request())).json();

    const byId = Object.fromEntries(
      body.meetings.map((m: { id: string; canModify: boolean }) => [m.id, m.canModify])
    );

    expect(byId.m1).toBe(true); // 72 hours away
    expect(byId.m3).toBe(true); // 10 days away
  });

  it('refuses the one inside the notice window, and says why', async () => {
    const body = await (await GET(...request())).json();
    const soon = body.meetings.find((m: { id: string }) => m.id === 'm2');

    // Six hours away against a 24-hour rule: the action is not offered, and the
    // row can say that rather than going quiet.
    expect(soon.canModify).toBe(false);
    expect(soon.tooSoon).toBe(true);
  });

  it('offers nothing on a meeting that already took place', async () => {
    const body = await (await GET(...request())).json();
    const held = body.meetings.find((m: { id: string }) => m.id === 'm4');

    expect(held.canModify).toBe(false);
    expect(held.tooSoon).toBe(false);
  });

  it("uses the SERVICE's window, not a hardcoded day", async () => {
    // A business asking for 48 hours told the client they could still cancel at
    // 36 and then refused them: the page and the route disagreed.
    booking = {
      ...(booking as Record<string, unknown>),
      service: [{ id: 'service-1', service_name: 'Coaching', min_notice_hours: 96 }],
    };

    const body = await (await GET(...request())).json();
    const byId = Object.fromEntries(
      body.meetings.map((m: { id: string; canModify: boolean }) => [m.id, m.canModify])
    );

    expect(byId.m1).toBe(false); // 72 hours, inside a 96-hour window
    expect(byId.m3).toBe(true); // 10 days, outside it
    expect(body.booking.canCancel).toBe(false);
  });
});

describe('an ordinary booking', () => {
  it('returns no meetings at all', async () => {
    booking = { ...(booking as Record<string, unknown>), parent_booking_id: null };
    siblings = [];

    const body = await (await GET(...request())).json();

    expect(body.meetings).toEqual([]);
    // And its own two actions are untouched.
    expect(body.booking.canCancel).toBe(true);
  });
});

describe('a package whose sessions are MEETINGS', () => {
  /*
   * ───────────────────────────────────────────────────────────────────────────
   * The shape the package moved to: one booking, N rows in
   * `scheduling_meetings`. The child-booking query finds nothing, so without
   * this the client opened their link and saw a purchase with no dates on it
   * at all — the exact shape of "I booked it and it is not there".
   * ───────────────────────────────────────────────────────────────────────────
   */
  beforeEach(() => {
    siblings = [];
    sessionRows = [
      { id: 'sm-1', start_time: inHours(72), end_time: inHours(73), meeting_status: null, session_number: 1, occurrence_number: 1 },
      { id: 'sm-2', start_time: inHours(96), end_time: inHours(97), meeting_status: null, session_number: 2, occurrence_number: 1 },
    ];
  });

  it('lists every session the client holds', async () => {
    const body = await (await GET(...request())).json();

    expect(body.meetings).toHaveLength(2);
    expect(body.meetings.map((m: { occurrenceNumber: number }) => m.occurrenceNumber)).toEqual([1, 2]);
  });

  it('shows the hour the client holds, not one that was given back', async () => {
    /*
     * A moved session leaves its old attempt behind, stamped `moved`. Listing
     * it would tell the client to turn up at a time nobody is expecting them,
     * and ranking it as current would contradict the attempt that replaced it.
     */
    /* Computed ONCE: `inHours` reads the clock, so calling it again in the
       assertion produces a string milliseconds apart from this one. */
    const movedTo = inHours(120);

    sessionRows = [
      { id: 'sm-1a', start_time: inHours(72), end_time: inHours(73), meeting_status: 'moved', session_number: 1, occurrence_number: 1 },
      { id: 'sm-1b', start_time: movedTo, end_time: inHours(121), meeting_status: null, session_number: 1, occurrence_number: 2 },
    ];

    const body = await (await GET(...request())).json();

    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].id).toBe('sm-1b');
    expect(body.meetings[0].startTime).toBe(movedTo);
  });

  it('can be moved, by the same rule as every other row', async () => {
    /*
     * These were all `canModify: false` while a session could not be moved at
     * all — the reschedule route took a BOOKING id and a session has none. It
     * takes `meetingId` now, so the three real conditions apply: standing,
     * dated, and outside the notice window.
     */
    const body = await (await GET(...request())).json();

    expect(body.meetings.every((m: { canModify: boolean }) => m.canModify === true)).toBe(true);
    expect(body.meetings.every((m: { tooSoon: boolean }) => m.tooSoon === false)).toBe(true);
  });

  it('refuses the one inside the notice window, and says why', async () => {
    /* Same window the route enforces, so the page never offers a change that
       is about to be refused. */
    sessionRows = [
      { id: 'sm-soon', start_time: inHours(2), end_time: inHours(3), meeting_status: null, session_number: 1, occurrence_number: 1 },
    ];

    const body = await (await GET(...request())).json();

    expect(body.meetings[0].canModify).toBe(false);
    expect(body.meetings[0].tooSoon).toBe(true);
  });

  it('carries the PURCHASE\'s token and names the session', async () => {
    /*
     * A session has no token of its own, there being no booking behind it. The
     * token names the purchase — which this request has proved the caller
     * holds a link to — and `meetingId` says which hour. The route refuses a
     * meeting that is not that booking's, so one package's link reaches only
     * its own sessions.
     */
    const body = await (await GET(...request())).json();

    /* The CONTAINER's, which `m1` points at — not this row's own id. */
    expect(body.meetings[0].token).toBe('token-for-container-1');
    expect(body.meetings[0].meetingId).toBe('sm-1');
  });

  it('offers nothing on a session that already happened', async () => {
    sessionRows = [
      { id: 'sm-held', start_time: inHours(-48), end_time: inHours(-47), meeting_status: 'held', session_number: 1, occurrence_number: 1 },
    ];

    const body = await (await GET(...request())).json();

    expect(body.meetings[0].canModify).toBe(false);
    expect(body.meetings[0].tooSoon).toBe(false);
  });

  it('says a called-off session is off', async () => {
    sessionRows = [
      { id: 'sm-1', start_time: inHours(72), end_time: inHours(73), meeting_status: 'cancelled', session_number: 1, occurrence_number: 1 },
    ];

    const body = await (await GET(...request())).json();

    expect(body.meetings[0].status).toBe('cancelled');
  });

  it('still lists child bookings where that is the shape', async () => {
    /* A package sold before the split, whose client can open their link today. */
    sessionRows = [];
    siblings = [
      { id: 'm1', start_time: inHours(72), end_time: inHours(73), status: 'confirmed', occurrence_number: 1 },
    ];

    const body = await (await GET(...request())).json();

    expect(body.meetings).toHaveLength(1);
    expect(body.meetings[0].token).toBe('token-for-m1');
  });
});
