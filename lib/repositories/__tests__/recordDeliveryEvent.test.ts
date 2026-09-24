/**
 * What happened to the mail after we handed it over.
 *
 * `email_sends` has carried `delivered_at`, `opened_at`, `clicked_at`,
 * `open_count` and `click_count` since it was created, and every one was null
 * on all 63 rows — because the transport discarded Resend's response body, so
 * no row had a `provider_message_id` and nothing could match an event back to
 * a send. Sixty emails out, zero known to have been read.
 *
 * These pin the two things a delivery webhook gets wrong if nobody thinks about
 * it: providers RETRY, and they deliver OUT OF ORDER.
 */

import { EmailSendRepository } from '../EmailAutomationRepository';

jest.mock('@/lib/logger', () => ({
  createLogger: () => ({ warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

/*
 * `EmailSendRepository` holds a module-level `supabaseServer` rather than
 * taking one in its constructor, so the client has to be replaced at the module
 * boundary. A constructor argument is silently ignored — which is how the first
 * version of this test appeared to pass its negative cases and fail every
 * positive one.
 */
const state: { existing: Row | null; patches: Record<string, unknown>[] } = {
  existing: null,
  patches: [],
};

jest.mock('@/lib/supabaseServer', () => ({
  supabaseServer: {
    from() {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: state.existing, error: null }),
        single: async () => ({ data: state.existing, error: null }),
        update: (patch: Record<string, unknown>) => {
          state.patches.push(patch);
          return chain;
        },
      };
      return chain;
    },
  },
}));

interface Row {
  id: string;
  status: string;
  delivered_at: string | null;
  opened_at: string | null;
  clicked_at: string | null;
  open_count: number;
  click_count: number;
}

const row = (overrides: Partial<Row> = {}): Row => ({
  id: 'e1',
  status: 'sent',
  delivered_at: null,
  opened_at: null,
  clicked_at: null,
  open_count: 0,
  click_count: 0,
  ...overrides,
});

function repo(existing: Row | null) {
  state.existing = existing;
  state.patches = [];
  return { repository: new EmailSendRepository(), patches: state.patches };
}

describe('recordDeliveryEvent', () => {
  it('records the first open and counts it', async () => {
    const { repository, patches } = repo(row());

    await repository.recordDeliveryEvent('msg_1', { openedAt: '2026-09-23T10:00:00Z' });

    expect(patches[0]).toMatchObject({ opened_at: '2026-09-23T10:00:00Z', open_count: 1 });
  });

  it('ignores a redelivered open older than the one already recorded', async () => {
    /*
     * The retry case. A provider that redelivers an hour-old event must not
     * overwrite the open that has happened since, nor inflate the count.
     */
    const { repository, patches } = repo(row({ opened_at: '2026-09-23T12:00:00Z', open_count: 2 }));

    await repository.recordDeliveryEvent('msg_1', { openedAt: '2026-09-23T10:00:00Z' });

    expect(patches).toEqual([]);
  });

  it('counts a genuinely later open', async () => {
    const { repository, patches } = repo(row({ opened_at: '2026-09-23T10:00:00Z', open_count: 1 }));

    await repository.recordDeliveryEvent('msg_1', { openedAt: '2026-09-23T14:00:00Z' });

    expect(patches[0]).toMatchObject({ opened_at: '2026-09-23T14:00:00Z', open_count: 2 });
  });

  it('does not move a delivery timestamp once it is set', async () => {
    // Delivered happens once. A second one is a redelivery of the event.
    const { repository, patches } = repo(row({ delivered_at: '2026-09-23T09:00:00Z' }));

    await repository.recordDeliveryEvent('msg_1', { deliveredAt: '2026-09-23T08:00:00Z' });

    expect(patches).toEqual([]);
  });

  it('lets a bounce override the sent status', async () => {
    const { repository, patches } = repo(row({ status: 'sent' }));

    await repository.recordDeliveryEvent('msg_1', { status: 'bounced', errorMessage: 'no such address' });

    expect(patches[0]).toMatchObject({ status: 'bounced', error_message: 'no such address' });
  });

  it('never lets an event set the status back to sent', async () => {
    /*
     * The row already says the mail went. An open cannot un-bounce it, and a
     * late `sent` event arriving after a bounce must not erase the bounce.
     */
    const { repository, patches } = repo(row({ status: 'bounced' }));

    await repository.recordDeliveryEvent('msg_1', { status: 'sent', openedAt: '2026-09-23T10:00:00Z' });

    expect(patches[0]).not.toHaveProperty('status');
    expect(patches[0]).toMatchObject({ opened_at: '2026-09-23T10:00:00Z' });
  });

  it('does nothing, and reports no error, for a message it never sent', async () => {
    /*
     * Events arrive for mail this platform did not record. A 404 would make
     * the provider retry forever something that can never match.
     */
    const { repository, patches } = repo(null);

    const result = await repository.recordDeliveryEvent('msg_unknown', { openedAt: '2026-09-23T10:00:00Z' });

    expect(result.error).toBeNull();
    expect(patches).toEqual([]);
    // And says WHICH nothing. `data: null, error: null` alone was also what a
    // successful write and a no-op duplicate returned, so the caller could not
    // tell a miss from a hit and reported all three as recorded.
    expect(result.outcome).toBe('unmatched');
  });

  it('writes nothing when the event changes nothing', async () => {
    const { repository, patches } = repo(row({ clicked_at: '2026-09-23T12:00:00Z', click_count: 1 }));

    const result = await repository.recordDeliveryEvent('msg_1', { clickedAt: '2026-09-23T11:00:00Z' });

    expect(patches).toEqual([]);
    expect(result.outcome).toBe('duplicate');
  });

  it('reports a real write as recorded, distinctly from the two no-ops', async () => {
    const { repository, patches } = repo(row());

    const result = await repository.recordDeliveryEvent('msg_1', { openedAt: '2026-09-23T10:00:00Z' });

    expect(patches).toHaveLength(1);
    expect(result.outcome).toBe('recorded');
  });
});
