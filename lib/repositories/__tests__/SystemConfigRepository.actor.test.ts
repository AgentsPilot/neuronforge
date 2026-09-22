/**
 * SystemConfigRepository.set — the optional actor (admin screen FR-13, AC-13).
 *
 * Two properties, and the second matters as much as the first:
 *
 *   S1-T9  — with an actor, BOTH branches record it. The insert branch is R-5:
 *            it wrote neither `updated_at` nor `updated_by`, so the first save
 *            of an area whose row had been deleted — the very "running on code
 *            defaults" state the screen renders — would have carried no
 *            attribution at all.
 *   S1-T10 — WITHOUT an actor, the statement is exactly what it was, so the
 *            Step 0 admin route and the operator script are undisturbed. In
 *            particular `updated_by` must be ABSENT, not null: writing null
 *            would erase an attribution a previous save recorded.
 */

jest.mock('@/lib/logger', () => {
  const make = (): Record<string, unknown> => {
    const logger: Record<string, unknown> = {};
    for (const level of ['info', 'warn', 'error', 'debug']) logger[level] = () => undefined;
    logger.child = () => logger;
    return logger;
  };
  return { createLogger: () => make() };
});
jest.mock('@/lib/supabaseServer', () => ({ supabaseServer: {} }));

import type { SupabaseClient } from '@supabase/supabase-js';
import { SystemConfigRepository } from '../SystemConfigRepository';

const ACTOR = '11111111-1111-1111-1111-111111111111';

type Recorded = { kind: 'update' | 'insert'; payload: Record<string, unknown> };

/**
 * A client that records the payload of whichever branch `set` takes.
 * `existing` decides the branch, exactly as the real `getByKey` would.
 */
function fakeClient(existing: boolean) {
  const recorded: Recorded[] = [];
  const result = { data: { key: 'k', value: {} }, error: null };

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve(existing ? result : { data: null, error: { code: 'PGRST116' } }),
        }),
      }),
      update: (payload: Record<string, unknown>) => {
        recorded.push({ kind: 'update', payload });
        return { eq: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }) };
      },
      insert: (payload: Record<string, unknown>) => {
        recorded.push({ kind: 'insert', payload });
        return { select: () => ({ single: () => Promise.resolve(result) }) };
      },
    }),
  };

  return { recorded, repo: new SystemConfigRepository(client as unknown as SupabaseClient) };
}

describe('S1-T9: with an actor, both branches record it', () => {
  it('records the actor on the UPDATE branch, alongside updated_at', async () => {
    const { recorded, repo } = fakeClient(true);

    await repo.set('bos_llm_area_leads', { enabled: false }, 'business_os_llm', undefined, {
      actorId: ACTOR,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].kind).toBe('update');
    expect(recorded[0].payload.updated_by).toBe(ACTOR);
    expect(typeof recorded[0].payload.updated_at).toBe('string');
  });

  it('records the actor on the INSERT branch too (R-5)', async () => {
    const { recorded, repo } = fakeClient(false);

    await repo.set('bos_llm_area_leads', { enabled: false }, 'business_os_llm', undefined, {
      actorId: ACTOR,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].kind).toBe('insert');
    expect(recorded[0].payload.updated_by).toBe(ACTOR);
    // Set explicitly rather than left to the column default, so both branches
    // have one source for this value.
    expect(typeof recorded[0].payload.updated_at).toBe('string');
  });
});

describe('S1-T10: without an actor, nothing changes for existing callers', () => {
  it('omits updated_by from the UPDATE payload rather than writing null', async () => {
    const { recorded, repo } = fakeClient(true);

    await repo.set('some_other_key', { a: 1 }, 'general', 'a description');

    expect(recorded[0].payload).not.toHaveProperty('updated_by');
    expect(Object.keys(recorded[0].payload).sort()).toEqual(['updated_at', 'value']);
  });

  it('omits updated_by from the INSERT payload rather than writing null', async () => {
    const { recorded, repo } = fakeClient(false);

    await repo.set('some_other_key', { a: 1 }, 'general', 'a description');

    expect(recorded[0].payload).not.toHaveProperty('updated_by');
    expect(recorded[0].payload).toMatchObject({
      key: 'some_other_key',
      category: 'general',
      description: 'a description',
    });
  });

  it('treats an explicitly null actor as no actor, not as "erase the actor"', async () => {
    const { recorded, repo } = fakeClient(true);

    await repo.set('some_other_key', { a: 1 }, 'general', undefined, { actorId: null });

    expect(recorded[0].payload).not.toHaveProperty('updated_by');
  });

  it('keeps the actor out of the positional arguments, so it cannot be passed as a description', async () => {
    const { recorded, repo } = fakeClient(false);

    // The shape that would be a bug if the actor were a fifth positional
    // string: a caller passing it where `description` goes.
    await repo.set('some_other_key', { a: 1 }, 'general', ACTOR);

    expect(recorded[0].payload.description).toBe(ACTOR);
    expect(recorded[0].payload).not.toHaveProperty('updated_by');
  });
});
