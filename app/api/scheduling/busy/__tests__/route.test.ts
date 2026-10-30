/**
 * The hours already committed, answered to the owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS FOR
 *
 * The quote builder warned about a date whose hour was already sold by reading
 * `/api/scheduling/bookings`. That was right while a package was a container
 * plus N CHILD BOOKINGS. Once a package became one booking with N MEETINGS its
 * sessions left `scheduling_bookings` and the container kept `start_time:
 * null`, so a date filter dropped it: the warning stayed on screen, kept
 * catching ordinary appointments, and went blind to every package.
 *
 * Measured — a quote offering 8, 15 and 22 November at 08:00, sent and accepted
 * while another package had held 15 and 22 since two hours earlier. One session
 * of three was created; the database refused the rest, after the client had
 * agreed and paid.
 *
 * This route exists so that screen can ask the SAME question the booking page
 * asks. What it must not become is a second opinion, so the tests below pin
 * that it delegates — the range it passes, the tenant it passes, and the
 * exclusion — rather than re-deciding anything itself.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const getUser = jest.fn();
const busyMeetings = jest.fn();

jest.mock('@/lib/auth', () => ({ getUser: () => getUser() }));

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({
    child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
  }),
}));

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: { __brand: 'server' } }));

jest.mock('@/lib/scheduling/busyMeetings', () => ({
  busyMeetings: (...args: unknown[]) => busyMeetings(...args),
}));

import { GET } from '../route';

const FROM = '2026-11-08T00:00:00.000Z';
const TO = '2026-11-23T00:00:00.000Z';

const request = (query: string) =>
  ({ url: `http://localhost/api/scheduling/busy?${query}`, headers: new Headers() }) as never;

const SPANS = [
  { start_time: '2026-11-15T08:00:00.000Z', end_time: '2026-11-15T09:00:00.000Z' },
  { start_time: '2026-11-22T08:00:00.000Z', end_time: '2026-11-22T09:00:00.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  getUser.mockResolvedValue({ id: 'user-1' });
  busyMeetings.mockResolvedValue(SPANS);
});

describe('who may ask', () => {
  it('refuses an unauthenticated caller', async () => {
    getUser.mockResolvedValue(null);

    const response = await GET(request(`from=${FROM}&to=${TO}`));

    expect(response.status).toBe(401);
    expect(busyMeetings).not.toHaveBeenCalled();
  });

  it('answers only about the caller, never an id from the query string', async () => {
    /*
     * CLAUDE.md rule 4, and the reason this route is safe to expose at all: the
     * tenant comes from the session. A `user_id` in the query is simply not a
     * parameter, so there is nothing to smuggle.
     */
    await GET(request(`from=${FROM}&to=${TO}&user_id=someone-else`));

    expect(busyMeetings).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      expect.any(String),
      expect.any(String),
      null
    );
  });
});

describe('the range it is asked about', () => {
  it('returns the committed hours for it', async () => {
    const response = await GET(request(`from=${FROM}&to=${TO}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ success: true, data: { busy: SPANS } });
  });

  it('passes the range through as instants', async () => {
    await GET(request(`from=${FROM}&to=${TO}`));

    expect(busyMeetings).toHaveBeenCalledWith(expect.anything(), 'user-1', FROM, TO, null);
  });

  it('rejects a range that is not a range', async () => {
    /* `to` before `from` reads as an empty window, which would answer "nothing
       is booked" — the one wrong answer this route must never give. */
    const response = await GET(request(`from=${TO}&to=${FROM}`));

    expect(response.status).toBe(400);
    expect(busyMeetings).not.toHaveBeenCalled();
  });

  it('rejects an unparseable date', async () => {
    const response = await GET(request('from=soon&to=later'));

    expect(response.status).toBe(400);
    expect(busyMeetings).not.toHaveBeenCalled();
  });

  it('rejects a missing range rather than reading the whole diary', async () => {
    const response = await GET(request(''));

    expect(response.status).toBe(400);
    expect(busyMeetings).not.toHaveBeenCalled();
  });
});

describe("one booking's own hours", () => {
  it('are left out when the caller names it', async () => {
    /* A quote being revised must not be told its own sessions are a clash. */
    await GET(request(`from=${FROM}&to=${TO}&exclude_booking_id=11111111-2222-3333-4444-555555555555`));

    expect(busyMeetings).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      FROM,
      TO,
      '11111111-2222-3333-4444-555555555555'
    );
  });

  it('refuses an exclusion that is not an id', async () => {
    /* Anything wider than one booking is a way to hide a real clash, which is
       why `busyMeetings` takes an id and not a list. A malformed one must fail
       rather than silently exclude nothing — the caller believes it worked. */
    const response = await GET(request(`from=${FROM}&to=${TO}&exclude_booking_id=all`));

    expect(response.status).toBe(400);
    expect(busyMeetings).not.toHaveBeenCalled();
  });
});

describe('when the read fails underneath', () => {
  it('keeps the empty answer rather than inventing a 500', async () => {
    /*
     * `busyMeetings` returns `[]` on failure and logs — deliberate at that
     * layer, because a failed read must not blank a calendar, and both write
     * paths re-check under the database's overlap constraint. A 500 here would
     * give the caller nothing better to do and lose the rest of the screen.
     */
    busyMeetings.mockResolvedValue([]);

    const response = await GET(request(`from=${FROM}&to=${TO}`));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.busy).toEqual([]);
  });
});
