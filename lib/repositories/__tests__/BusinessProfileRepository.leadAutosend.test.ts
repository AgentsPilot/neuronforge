/**
 * `getLeadAutosendEnabled`: one column, and the three-way answer it keeps.
 *
 * The caller is deciding whether to warn an owner that enquiries are being
 * filed and nobody is being answered — the failure that looks like success from
 * every angle except the client's. So `null` (no profile row) must not collapse
 * into `false` (replies deliberately off): a business that has never been set
 * up has not chosen anything, and warning it would be noise.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BusinessProfileRepository } from '@/lib/repositories/BusinessProfileRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  maybeSingle: boolean;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], maybeSingle: false };
  const resolved = { data: result.data ?? null, error: result.error ?? null };

  const builder: any = {
    select: jest.fn((cols: string) => {
      calls.select = cols;
      return builder;
    }),
    eq: jest.fn((col: string, val: unknown) => {
      calls.eqs.push([col, val]);
      return builder;
    }),
    maybeSingle: jest.fn(() => {
      calls.maybeSingle = true;
      return Promise.resolve(resolved);
    }),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

describe('BusinessProfileRepository.getLeadAutosendEnabled', () => {
  it('reads one column for this owner', async () => {
    const { client, calls } = mockSupabase({ data: { lead_autosend_enabled: true } });

    await new BusinessProfileRepository(client).getLeadAutosendEnabled('u1');

    expect(calls.table).toBe('business_profiles');
    expect(calls.select).toBe('lead_autosend_enabled');
    // Rule 4. Dropping it reads whichever profile row comes back first.
    expect(calls.eqs).toContainEqual(['user_id', 'u1']);
  });

  it('treats a missing profile as a quiet answer, not an error', async () => {
    const { client, calls } = mockSupabase({ data: null });

    const { data, error } = await new BusinessProfileRepository(client).getLeadAutosendEnabled(
      'u1'
    );

    expect(calls.maybeSingle).toBe(true);
    expect(data).toBeNull();
    expect(error).toBeNull();
  });

  it('keeps "never asked" apart from "chose off"', async () => {
    /*
     * The distinction the caller depends on: it warns on `false` and stays
     * quiet on `null`. Defaulting a missing row to `false` would warn every
     * business that has not finished setting up.
     */
    const noRow = mockSupabase({ data: null });
    const choseOff = mockSupabase({ data: { lead_autosend_enabled: false } });

    const absent = await new BusinessProfileRepository(noRow.client).getLeadAutosendEnabled('u1');
    const off = await new BusinessProfileRepository(choseOff.client).getLeadAutosendEnabled('u1');

    expect(absent.data).toBeNull();
    expect(off.data).toBe(false);
  });

  it('reports a failed read as an error', async () => {
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await new BusinessProfileRepository(client).getLeadAutosendEnabled(
      'u1'
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
