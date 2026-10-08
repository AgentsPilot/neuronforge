/**
 * Which day the cancellations land on — and the traps in asking.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The reason analysis in this detector loads ONLY cancelled bookings, which is
 * correct for its question (which reason dominates among those who gave one)
 * and useless for this one. A rate needs the bookings that were NOT called
 * off, so the comparison runs its own query. Three things have to hold:
 *
 *   - the comparison NAMES the day, or it is dropped. "One group is four times
 *     worse" drew the reply "which link?" on the dead-link card;
 *   - a weekday is read in the BUSINESS's zone, and dropped entirely when
 *     nobody has set one — a 01:00 Jerusalem booking is the previous day UTC;
 *   - the comparison is a decoration. Nothing it does may take down the reason
 *     card underneath it.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { RetCancelPatternDetector } from '../RetCancelPatternDetector';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

const DAY = 86_400_000;

/** An ISO timestamp for a given weekday at midday UTC, `weeksAgo` back. */
function onDay(weekday: number, weeksAgo: number, hourUtc = 12): string {
  // 2026-01-05 was a Monday. Walk forward to the weekday, then back by weeks.
  const monday = Date.UTC(2026, 0, 5, hourUtc);
  return new Date(monday + weekday * DAY - weeksAgo * 7 * DAY).toISOString();
}

interface Row {
  [k: string]: unknown;
}

/**
 * Honours `.eq('status', …)`, because the detector issues TWO queries against
 * `scheduling_bookings` — the cancelled-only one for reasons and the settled
 * one for the rate. A mock that ignored the filter would feed the reason
 * analysis every booking and prove nothing.
 */
function mockSupabase(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const rows = tables[table] ?? [];
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {
        then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
          const out = rows.filter(r =>
            Object.entries(filters).every(([k, v]) => k === 'user_id' || r[k] === v)
          );
          return resolve({ data: out, error: null });
        },
      };
      for (const m of ['select', 'in', 'gte', 'lt', 'order', 'limit', 'neq']) chain[m] = () => chain;
      chain.eq = (col: string, val: unknown) => {
        filters[col] = val;
        return chain;
      };
      chain.maybeSingle = () => Promise.resolve({ data: tables.__prefs?.[0] ?? null, error: null });
      return chain;
    },
  };
}

/** A cancelled booking, carrying a reason so the reason analysis still fires. */
function cancelled(weekday: number, weeksAgo: number, i: number): Row {
  return {
    id: `cx-${weekday}-${weeksAgo}-${i}`,
    status: 'cancelled',
    contact_id: `c${i}`,
    service_id: 'svc-1',
    start_time: onDay(weekday, weeksAgo),
    updated_at: onDay(weekday, weeksAgo),
    cancelled_by: 'client',
    cancel_reason: 'client_cost',
    cancellation_reason: 'client_cost',
  };
}

function completed(weekday: number, weeksAgo: number, i: number): Row {
  return {
    id: `ok-${weekday}-${weeksAgo}-${i}`,
    status: 'completed',
    contact_id: `c${i}`,
    service_id: 'svc-1',
    start_time: onDay(weekday, weeksAgo),
    updated_at: onDay(weekday, weeksAgo),
    cancelled_by: null,
    cancel_reason: null,
    cancellation_reason: null,
  };
}

function detector(tables: Record<string, Row[]>) {
  const d = new RetCancelPatternDetector(mockSupabase(tables) as never);
  (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
  (d as unknown as { logDetection: () => void }).logDetection = () => {};
  return d;
}

/** Thursdays cancel heavily; the rest of the week barely does. */
function lopsidedWeek(): Row[] {
  const rows: Row[] = [];
  for (let w = 0; w < 6; w++) {
    // Thursday (index 3): 2 of 3 cancelled.
    rows.push(cancelled(3, w, 1), cancelled(3, w, 2), completed(3, w, 3));
    // Tuesday (index 1): 0 of 4 cancelled.
    for (let i = 0; i < 4; i++) rows.push(completed(1, w, i));
    // Monday: one cancellation, so the remainder's rate is not zero.
    rows.push(w === 0 ? cancelled(0, w, 9) : completed(0, w, 9));
  }
  return rows;
}

describe('naming the day', () => {
  it('names the day the cancellations concentrate on', async () => {
    const result = await detector({
      scheduling_bookings: lopsidedWeek(),
      __prefs: [{ timezone: 'UTC' }],
    }).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result?.comparison).toBeDefined();
    expect(result?.processParameters?.comparison_dimension).toBe('day_of_week');
    expect(result?.processParameters?.comparison_segment).toBe('Thursday');
    // The model is given the name; the raw key never reaches it.
    expect(result?.narrationSubject).toContain('Thursday');
    expect(result?.narrationSubject).not.toContain('thu:');
  });

  it('drops the day question entirely when nobody has set a timezone', async () => {
    /*
     * Null means "not asked", and a weekday read off a UTC timestamp files
     * late-evening appointments under the wrong day. Every booking here shares
     * one service, so with the day dimension gone there is nothing left to
     * compare and the comparison is absent.
     */
    const result = await detector({
      scheduling_bookings: lopsidedWeek(),
      __prefs: [{ timezone: null }],
    }).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result?.comparison).toBeUndefined();
    expect(result?.narrationSubject).toBeUndefined();
  });
});

describe('the comparison is only a decoration', () => {
  it('still reports the reason pattern when no slice stands out', async () => {
    /*
     * Cancellations spread evenly across the week. The reason card is the
     * detector's actual job and must survive the comparison finding nothing.
     */
    const rows: Row[] = [];
    for (let w = 0; w < 6; w++) {
      rows.push(cancelled(1, w, 1), completed(1, w, 2), completed(1, w, 3));
      rows.push(cancelled(3, w, 1), completed(3, w, 2), completed(3, w, 3));
    }

    const result = await detector({
      scheduling_bookings: rows,
      __prefs: [{ timezone: 'UTC' }],
    }).evaluate('user-1');

    expect(result).not.toBeNull();
    expect(result?.comparison).toBeUndefined();
    expect(result?.processParameters?.client_reason).toBe('client_cost');
  });

  it('survives the denominator query failing outright', async () => {
    const broken = {
      from(table: string) {
        if (table === 'scheduling_bookings') {
          let status: unknown;
          const chain: Record<string, unknown> = {
            then: (resolve: (v: { data: unknown; error: unknown }) => unknown) =>
              status === 'cancelled'
                ? resolve({
                    data: Array.from({ length: 6 }, (_, i) => cancelled(3, i, 1)),
                    error: null,
                  })
                : resolve({ data: null, error: new Error('denominator exploded') }),
          };
          for (const m of ['select', 'in', 'gte', 'lt', 'order', 'limit', 'neq']) {
            chain[m] = () => chain;
          }
          chain.eq = (col: string, val: unknown) => {
            if (col === 'status') status = val;
            return chain;
          };
          return chain;
        }
        const chain: Record<string, unknown> = {
          then: (r: (v: { data: unknown; error: null }) => unknown) =>
            r({ data: [], error: null }),
          maybeSingle: () => Promise.resolve({ data: { timezone: 'UTC' }, error: null }),
        };
        for (const m of ['select', 'eq', 'in', 'gte', 'lt', 'order', 'limit']) chain[m] = () => chain;
        return chain;
      },
    };

    const d = new RetCancelPatternDetector(broken as never);
    (d as unknown as { isOnCooldown: () => Promise<boolean> }).isOnCooldown = async () => false;
    (d as unknown as { logDetection: () => void }).logDetection = () => {};

    const result = await d.evaluate('user-1');

    // The reason card stands; only the decoration is gone.
    expect(result).not.toBeNull();
    expect(result?.comparison).toBeUndefined();
  });
});
