/**
 * `SchedulingBookingRepository.countUpcomingBookings` (account deletion
 * DL-2b, BQ-39; workplan BUSINESS_OS_DELETION_DL2_WORKPLAN.md §6.2, D-11,
 * D-12; SA W-16).
 *
 * The chain is recorded on a fake client: no database, no network. Pins the
 * owner scope, the two statuses, the `gte start_time` bound, no `deleted_at`,
 * and that a failure is returned as it came, never as a 0.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));
jest.mock('@/lib/business-os/insight/events/recordEvent', () => ({ recordBusinessEvent: jest.fn() }));

import { SchedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

const USER = '11111111-1111-4111-8111-111111111111';
const FROM = '2026-12-10T22:00:00.000Z';

interface Recorded {
  table: string | null;
  select: { cols: string; options: unknown } | null;
  calls: Array<[string, unknown[]]>;
}

function fakeClient(answer: { count: number | null; error: unknown }) {
  const recorded: Recorded = { table: null, select: null, calls: [] };
  const builder: Record<string, unknown> = {};
  for (const method of ['eq', 'in', 'gte', 'is', 'lte', 'neq', 'not', 'or', 'filter']) {
    builder[method] = jest.fn((...args: unknown[]) => {
      recorded.calls.push([method, args]);
      return builder;
    });
  }
  builder.select = jest.fn((cols: string, options: unknown) => {
    recorded.select = { cols, options };
    return builder;
  });
  // The query is awaited after its last filter.
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: null, count: answer.count, error: answer.error }).then(resolve, reject);
  const from = jest.fn((table: string) => {
    recorded.table = table;
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, from, recorded };
}

describe('countUpcomingBookings', () => {
  it('counts the owner\'s confirmed and pending bookings from the given instant, head only', async () => {
    const { client, recorded } = fakeClient({ count: 3, error: null });
    const result = await new SchedulingBookingRepository(client).countUpcomingBookings(USER, FROM);

    expect(result).toEqual({ data: 3, error: null });
    expect(recorded.table).toBe('scheduling_bookings');
    expect(recorded.select).toEqual({ cols: 'id', options: { count: 'exact', head: true } });
    expect(recorded.calls).toEqual([
      ['eq', ['user_id', USER]],
      ['in', ['status', ['confirmed', 'pending']]],
      ['gte', ['start_time', FROM]],
    ]);
    // D-11: the table has no deleted_at; filtering on it would fail the whole count.
    expect(JSON.stringify(recorded.calls)).not.toContain('deleted_at');
  });

  it('a real zero is 0', async () => {
    const { client } = fakeClient({ count: 0, error: null });
    expect(await new SchedulingBookingRepository(client).countUpcomingBookings(USER, FROM)).toEqual({ data: 0, error: null });
  });

  it('W-16: the bound error comes back unchanged, never a 0', async () => {
    const dbError = Object.assign(new Error('column scheduling_bookings.x does not exist'), { code: '42703' });
    const { client } = fakeClient({ count: null, error: dbError });
    const result = await new SchedulingBookingRepository(client).countUpcomingBookings(USER, FROM);
    expect(result.data).toBeNull();
    expect(result.error).toBe(dbError);
  });

  it('no count and no error is an error, not a 0', async () => {
    const { client } = fakeClient({ count: null, error: null });
    const result = await new SchedulingBookingRepository(client).countUpcomingBookings(USER, FROM);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it.each([
    ['an invalid uuid', 'not-a-uuid', FROM],
    ['an empty uuid', '', FROM],
    ['an invalid ISO instant', USER, 'tomorrow'],
    ['a date with no time', USER, '2026-12-10'],
  ])('W-16: %s → an error with NO database call', async (_label, userId, fromIso) => {
    const { client, from } = fakeClient({ count: 5, error: null });
    const result = await new SchedulingBookingRepository(client).countUpcomingBookings(userId, fromIso);
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(from).not.toHaveBeenCalled();
  });
});
