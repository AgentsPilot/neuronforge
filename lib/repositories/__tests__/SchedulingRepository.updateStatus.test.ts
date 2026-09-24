import type { SupabaseClient } from '@supabase/supabase-js';
import { SchedulingServiceRepository } from '@/lib/repositories/SchedulingRepository';

/*
 * A general update may not publish.
 *
 * `publish()` is guarded by `.eq('status', 'draft')`, and its callers add a
 * description check and the journey-readiness gate on top. Writing
 * `status: 'active'` through `update()` reached none of that.
 *
 * This was live, not theoretical. The Settings pause switch wrote
 * `status: newActiveState ? 'active' : 'inactive'` on every flip, so switching
 * a draft off and on again made it bookable by clients with nobody reviewing
 * it. The reported symptom was stranger still: saving an edit returns a live
 * service to `draft` while leaving `is_active` true, so the switch still read
 * "on" — one press wrote `inactive`, and `publish()` deliberately refuses to
 * un-pause an inactive service, so the edited service could not be published at
 * all. The only way out was pressing the switch again, which published it.
 *
 * The call site is fixed, but it is one of four writers — the chat executor and
 * the plugin executor update services too. This guards the layer they share.
 */

const USER = 'user-1';
const SERVICE = 'service-1';

/**
 * A Supabase double whose FIRST `from()` answers the pre-flight status read and
 * whose second answers the UPDATE, mirroring the order `update()` issues them.
 */
function mockSupabase(currentStatus: string | null, updateResult?: any) {
  const updates: any[] = [];

  const makeBuilder = (result: () => any) => {
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
      return call === 1
        ? makeBuilder(() => ({ data: currentStatus ? { status: currentStatus } : null, error: null }))
        : makeBuilder(() => updateResult ?? { data: { id: SERVICE }, error: null });
    }),
  } as unknown as SupabaseClient;

  return { client, updates };
}

describe('update() and the publish boundary', () => {
  it('refuses to activate a draft', async () => {
    const { client, updates } = mockSupabase('draft');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(SERVICE, USER, { status: 'active' } as any);

    expect(result.data).toBeNull();
    expect(result.error?.message).toMatch(/publish/i);
    // The point is not the error — it is that nothing was written.
    expect(updates).toHaveLength(0);
  });

  it('refuses even when the activation rides along with other fields', async () => {
    // The pause switch sent `is_active` and `status` together; a guard that
    // only looked at lone status writes would have missed exactly this shape.
    const { client, updates } = mockSupabase('draft');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(
      SERVICE,
      USER,
      { is_active: true, status: 'active', price: 300 } as any
    );

    expect(result.data).toBeNull();
    expect(updates).toHaveLength(0);
  });

  it('allows un-pausing a service that was published before', async () => {
    // `inactive` → `active` is the ONLY way back from a pause: `publish()`
    // deliberately refuses an inactive service. Blocking this would strand it.
    const { client, updates } = mockSupabase('inactive');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(SERVICE, USER, { is_active: true, status: 'active' } as any);

    expect(result.error).toBeNull();
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ status: 'active' });
  });

  it('allows pausing a live service', async () => {
    const { client, updates } = mockSupabase('active');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(SERVICE, USER, { is_active: false, status: 'inactive' } as any);

    expect(result.error).toBeNull();
    expect(updates[0]).toMatchObject({ status: 'inactive' });
  });

  it('allows an edit to return a live service to draft', async () => {
    // How a service comes back for review. Refusing it would make every edit
    // to a published service silently keep the old copy live.
    const { client, updates } = mockSupabase('active');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(SERVICE, USER, { status: 'draft', price: 450 } as any);

    expect(result.error).toBeNull();
    expect(updates[0]).toMatchObject({ status: 'draft' });
  });

  it('leaves updates that say nothing about status alone', async () => {
    // No pre-flight read should even be issued for the ordinary case.
    const { client, updates } = mockSupabase('draft');
    const repo = new SchedulingServiceRepository(client);

    const result = await repo.update(SERVICE, USER, { price: 300 } as any);

    expect(result.error).toBeNull();
    expect(updates).toHaveLength(1);
    expect((client.from as jest.Mock)).toHaveBeenCalledTimes(1);
  });
});
