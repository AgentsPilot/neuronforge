/**
 * `findLeadsByVia`, and the filter that must never come back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS METHOD EXISTS BECAUSE THE READ IT REPLACED RETURNED NOTHING, ALWAYS.
 *
 * `inboxChannel.ts` counted a channel's leads with a query carrying
 * `.is('deleted_at', null)`. `crm_contacts` has no `deleted_at` column —
 * deletes there are hard — and PostgREST rejects the WHOLE query for one
 * unknown column name (42703, confirmed against the live schema). The caller
 * destructured only `data`, discarded the error, and tallied the null result,
 * so every inbox channel reported zero leads for thirty days on all four
 * surfaces that ask: the Channels card, the onboarding build page, My Day and
 * the readiness gate.
 *
 * Nothing threw, nothing was logged, and the number it printed was a perfectly
 * plausible one for a quiet mailbox. The same mistake had already emptied
 * `findAttributedContacts` once before.
 *
 * So the first test here asserts an ABSENCE. It is the only kind of assertion
 * that fails when a reader, tidying up and reasonably expecting a soft-delete
 * filter on a contacts table, puts it back.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { ChannelAttributionRepository } from '@/lib/repositories/ChannelAttributionRepository';

interface Calls {
  table?: string;
  select?: string;
  eqs: Array<[string, unknown]>;
  gtes: Array<[string, unknown]>;
  contains: Array<[string, unknown]>;
  is: Array<[string, unknown]>;
}

function mockSupabase(result: { data?: unknown; error?: unknown } = {}) {
  const calls: Calls = { eqs: [], gtes: [], contains: [], is: [] };
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
    gte: jest.fn((col: string, val: unknown) => {
      calls.gtes.push([col, val]);
      return builder;
    }),
    contains: jest.fn((col: string, val: unknown) => {
      calls.contains.push([col, val]);
      return builder;
    }),
    /* Recorded although the method must not use it — that is the point. */
    is: jest.fn((col: string, val: unknown) => {
      calls.is.push([col, val]);
      return builder;
    }),
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
      Promise.resolve(resolved).then(res, rej),
  };

  const client = {
    from: jest.fn((table: string) => {
      calls.table = table;
      return builder;
    }),
  } as unknown as SupabaseClient;

  return { client, calls };
}

const VIA = 'inbox-channel';

describe('ChannelAttributionRepository.findLeadsByVia', () => {
  it('filters on NO column that crm_contacts does not have', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new ChannelAttributionRepository(client).findLeadsByVia('u1', '2026-01-01T00:00:00Z', VIA);

    /*
     * `crm_contacts` has no `deleted_at`. One unknown name in a filter and
     * PostgREST refuses the whole read, which is how this count sat at zero
     * while leads were arriving.
     */
    expect(calls.is).toEqual([]);
  });

  it('scopes to the owner, the window and the channel marker', async () => {
    const { client, calls } = mockSupabase({ data: [] });

    await new ChannelAttributionRepository(client).findLeadsByVia('u1', '2026-01-01T00:00:00Z', VIA);

    expect(calls.table).toBe('crm_contacts');
    // Rule 4. Without it, one business's card counts another's leads.
    expect(calls.eqs).toContainEqual(['user_id', 'u1']);
    expect(calls.gtes).toContainEqual(['created_at', '2026-01-01T00:00:00Z']);
    /* The marker, not a referrer or a utm: an enquiry arrived as an email and
       has neither, which is why these leads resolve to `direct` without it. */
    expect(calls.contains).toContainEqual(['source_metadata', { via: VIA }]);
  });

  it('asks for the marker column and nothing else', async () => {
    /* Which provider each lead came through is the caller's tally, not the
       repository's, so this stays one column wide. */
    const { client, calls } = mockSupabase({ data: [] });

    await new ChannelAttributionRepository(client).findLeadsByVia('u1', '2026-01-01T00:00:00Z', VIA);

    expect(calls.select).toBe('source_metadata');
  });

  it('returns the rows for the caller to tally per provider', async () => {
    const rows = [
      { source_metadata: { via: VIA, provider: 'google-mail' } },
      { source_metadata: { via: VIA, provider: 'outlook' } },
    ];
    const { client } = mockSupabase({ data: rows });

    const { data } = await new ChannelAttributionRepository(client).findLeadsByVia(
      'u1',
      '2026-01-01T00:00:00Z',
      VIA
    );

    expect(data).toEqual(rows);
  });

  it('reports a failed read as an error, not as no leads', async () => {
    /*
     * The distinction the old inline read threw away. Zero leads and an
     * unreadable table look identical on the card unless the error survives
     * to the caller.
     */
    const { client } = mockSupabase({ error: new Error('db down') });

    const { data, error } = await new ChannelAttributionRepository(client).findLeadsByVia(
      'u1',
      '2026-01-01T00:00:00Z',
      VIA
    );

    expect(data).toBeNull();
    expect(error).toBeInstanceOf(Error);
  });
});
