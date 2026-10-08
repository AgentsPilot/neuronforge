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
jest.mock('@/lib/services/BookingEmailService', () => ({
  verifyBookingToken: (...args: unknown[]) => mockVerify(...args),
  generateBookingToken: (...args: unknown[]) => mockGenerate(...(args as [string])),
}));

jest.mock('@/lib/branding/publicBranding', () => ({
  resolvePublicBranding: jest.fn().mockResolvedValue(null),
}));

/** The booking the token names, and the package rows behind it. */
let booking: Record<string, unknown> | null = null;
let siblings: Array<Record<string, unknown>> = [];
const childFilters: Array<[string, unknown]> = [];

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from: () => ({
      select: () => {
        const chain: Record<string, unknown> = {
          eq: (column: string, value: unknown) => {
            childFilters.push([column, value]);
            return chain;
          },
          /* The quote lookup filters out superseded versions. It is unrelated to
             the meetings this file is about, and only has to not break. */
          neq: () => chain,
          /*
           * Thenable AND chainable.
           *
           * The sibling query ends at `.order(...)` and is awaited there; the
           * quote lookup continues `.order(...).limit(1).maybeSingle()`. A bare
           * promise satisfied the first and made the second read `.limit` off a
           * Promise — undefined — which threw inside the route and emptied every
           * assertion in this file.
           */
          order: () =>
            Object.assign(Promise.resolve({ data: siblings, error: null }), {
              limit: () => ({
                // No quote on a package meeting; the portal simply finds none.
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
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
  it('is actually exported by the email service', () => {
    /*
     * The mock above declares `generateBookingToken` as a named export, so this
     * suite passed green while the real module kept it module-private — and the
     * route failed to import it at runtime, in dev with a warning and a 404 on
     * every client link. A mocked export proves nothing about the real one, so
     * this reads the source.
     */
    const source = readFileSync(
      join(process.cwd(), 'lib', 'services', 'BookingEmailService.ts'),
      'utf8'
    );

    expect(source).toMatch(/export function generateBookingToken\(/);
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
