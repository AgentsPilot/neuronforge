/**
 * Unit tests for SchedulingBookingRepository.linkIntakeContact — the write that the
 * public intake route uses to attach a contact to a booking.
 *
 * This is the regression lock for phantom column P4: the old inline route code wrote
 * `intake_completed: true`, which does not exist (the real column is
 * `intake_completed_at`). The route-level tests mock this repository, so the column
 * literals are only reachable here.
 *
 * Also verifies both `.eq()` scopes — `contact_id` is deliberately NOT on the generic
 * `SchedulingBookingUpdate` surface, so this method is the only path that writes it and
 * it must stay `user_id`-scoped.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';

/** Mocks .from(t).update(payload).eq('id',..).eq('user_id',..).select().maybeSingle() */
function mockSupabase(record: any, error: any = null) {
  const calls: { table?: string; update?: any; eqs: Array<[string, any]> } = { eqs: [] };
  const builder: any = {
    update: jest.fn((payload: any) => { calls.update = payload; return builder; }),
    eq: jest.fn((col: string, val: any) => { calls.eqs.push([col, val]); return builder; }),
    select: jest.fn().mockReturnThis(),
    maybeSingle: jest.fn().mockResolvedValue({ data: record, error }),
  };
  const client = {
    from: jest.fn((table: string) => { calls.table = table; return builder; }),
  } as unknown as SupabaseClient;
  return { client, calls };
}

const BOOKING_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const CONTACT_ID = '22222222-2222-4222-8222-222222222222';

describe('SchedulingBookingRepository.linkIntakeContact', () => {
  it('writes contact_id + intake_completed_at, scoped by id and user_id', async () => {
    const { client, calls } = mockSupabase({ id: BOOKING_ID, contact_id: CONTACT_ID });
    const repo = new SchedulingBookingRepository(client);

    const { data, error } = await repo.linkIntakeContact(BOOKING_ID, USER_ID, CONTACT_ID);

    expect(error).toBeNull();
    expect(data).toMatchObject({ id: BOOKING_ID, contact_id: CONTACT_ID });

    expect(calls.table).toBe('scheduling_bookings');
    expect(calls.update.contact_id).toBe(CONTACT_ID);
    expect(typeof calls.update.intake_completed_at).toBe('string');
    expect(Number.isNaN(Date.parse(calls.update.intake_completed_at))).toBe(false);
    expect(calls.eqs).toEqual([['id', BOOKING_ID], ['user_id', USER_ID]]);
  });

  it('writes no phantom columns (P4 regression lock)', async () => {
    const { client, calls } = mockSupabase({ id: BOOKING_ID });
    const repo = new SchedulingBookingRepository(client);

    await repo.linkIntakeContact(BOOKING_ID, USER_ID, CONTACT_ID);

    // `intake_completed` does not exist on scheduling_bookings — writing it would make
    // PostgREST reject the whole statement (the original bug).
    expect(calls.update).not.toHaveProperty('intake_completed');
    // `updated_at` is owned by a BEFORE UPDATE trigger; the repository must not set it.
    expect(calls.update).not.toHaveProperty('updated_at');
    expect(Object.keys(calls.update).sort()).toEqual(['contact_id', 'intake_completed_at']);
  });

  it('treats a foreign or absent booking as a clean miss, not an error', async () => {
    const { client } = mockSupabase(null);
    const repo = new SchedulingBookingRepository(client);

    const { data, error } = await repo.linkIntakeContact(BOOKING_ID, USER_ID, CONTACT_ID);

    // The user_id scope means another tenant's booking matches no row. Callers on public
    // endpoints treat this as non-blocking rather than a failure.
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('propagates a real database error through the result shape', async () => {
    const { client } = mockSupabase(null, new Error('connection reset'));
    const repo = new SchedulingBookingRepository(client);

    const { data, error } = await repo.linkIntakeContact(BOOKING_ID, USER_ID, CONTACT_ID);

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('connection reset');
  });
});
