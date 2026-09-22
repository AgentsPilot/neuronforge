import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

/*
 * Publishing a service is a request about a DESIRED STATE.
 *
 * It used to filter on `status = 'draft'` and read with `.single()`, so
 * publishing something already published matched zero rows and threw PGRST116
 * — which the route returned as a 400 and the owner saw as a failed save.
 *
 * Reaching that takes no misuse: listing services has been seen taking nearly
 * nine seconds, so a second click, a retry, a stale list or a second tab all
 * arrive at a service that is already active.
 */

const USER = 'user-1';
const SERVICE = 'service-1';

/**
 * A Supabase double that answers the UPDATE and the follow-up SELECT
 * differently, which is the whole point: the method's behaviour depends on what
 * it finds after the update matches nothing.
 */
function mockSupabase(updateResult: any, selectResult?: any) {
  const updates: any[] = [];

  const makeBuilder = (result: () => any, isUpdate: boolean) => {
    const builder: any = {
      update: jest.fn((payload: any) => { updates.push(payload); return builder; }),
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      maybeSingle: jest.fn(() => Promise.resolve(result())),
      single: jest.fn(() => Promise.resolve(result())),
      then: (onF: any, onR: any) => Promise.resolve(result()).then(onF, onR),
    };
    return builder;
  };

  let call = 0;
  const client = {
    from: jest.fn(() => {
      call += 1;
      // First touch is the conditional UPDATE; anything after is the read-back.
      return call === 1
        ? makeBuilder(() => updateResult, true)
        : makeBuilder(() => selectResult ?? updateResult, false);
    }),
  } as unknown as SupabaseClient;

  return { client, updates };
}

const ACTIVE = { id: SERVICE, user_id: USER, status: 'active', is_active: true };

describe('publishing a service', () => {
  it('publishes a draft', async () => {
    const { client } = mockSupabase({ data: ACTIVE, error: null });
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.publish(SERVICE, USER);

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe('active');
  });

  it('succeeds when it was already published', async () => {
    // The reported bug: update matches nothing, read-back finds it active.
    const { client } = mockSupabase({ data: null, error: null }, { data: ACTIVE, error: null });
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.publish(SERVICE, USER);

    expect(result.error).toBeNull();
    expect(result.data?.status).toBe('active');
  });

  it('re-enables a service that is active but not bookable', async () => {
    // `status` and `is_active` together decide whether a client can book, so
    // an active-but-disabled row is repaired rather than reported as fine.
    const stuck = { ...ACTIVE, is_active: false };
    const { client, updates } = mockSupabase({ data: null, error: null }, { data: stuck, error: null });
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.publish(SERVICE, USER);

    expect(result.error).toBeNull();
    expect(updates).toContainEqual({ is_active: true });
  });

  it('refuses a service that does not exist for this user', async () => {
    const { client } = mockSupabase({ data: null, error: null }, { data: null, error: null });
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.publish(SERVICE, USER);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/not found/i);
  });

  it('refuses to un-pause an inactive service', async () => {
    /*
     * `inactive` is a deliberate pause. Quietly re-activating it here would be
     * a different operation wearing this one's name — idempotence covers
     * "already done", not "do something else as well".
     */
    const paused = { ...ACTIVE, status: 'inactive', is_active: false };
    const { client } = mockSupabase({ data: null, error: null }, { data: paused, error: null });
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.publish(SERVICE, USER);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/inactive/);
  });
});
