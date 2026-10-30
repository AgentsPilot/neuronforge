/**
 * What "walked away" counts, and the two things that would inflate it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The figure sits beside activeClients, activeLeads and totalContacts, which
 * all count PEOPLE. So this counts people too, and an owner reading "3" should
 * be able to go and find three of them.
 *
 * Both inflations were measured on live data 2026-10-29: 6 abandoned rows
 * belonging to 3 people, and all 3 of those had since booked. Counting rows
 * would have said 6; counting people without the booking check would have said
 * 3; the honest answer was 0.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { abandonedContactCount } from '@/lib/business-os/reports/abandonedContacts';

type Rows = { data: unknown[] | null; error: unknown };

function fakeClient(responses: {
  abandoned_bookings?: Rows;
  crm_contacts?: Rows;
  scheduling_bookings?: Rows;
}) {
  return {
    from(table: keyof typeof responses) {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        then(resolve: (value: Rows) => unknown) {
          return Promise.resolve(responses[table] ?? { data: [], error: null }).then(resolve);
        },
      };
      return chain;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- stand-in for SupabaseClient
  } as any;
}

describe('it counts people, not attempts', () => {
  it('a client who retried five times is one person', async () => {
    const client = fakeClient({
      abandoned_bookings: {
        data: [
          { email: 'sam@example.com' },
          { email: 'sam@example.com' },
          { email: 'Sam@Example.com ' },
          { email: 'sam@example.com' },
          { email: 'sam@example.com' },
        ],
        error: null,
      },
      crm_contacts: { data: [], error: null },
    });

    /* Case and stray whitespace are the same person; an address typed into a
       booking form arrives however the client typed it. */
    expect(await abandonedContactCount(client, 'owner-1')).toBe(1);
  });
});

describe('somebody who came back is not lost business', () => {
  it('is excluded once they have a booking', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: 'came-back@example.com' }], error: null },
      crm_contacts: { data: [{ id: 'contact-1', email: 'came-back@example.com' }], error: null },
      scheduling_bookings: { data: [{ contact_id: 'contact-1' }], error: null },
    });

    expect(await abandonedContactCount(client, 'owner-1')).toBe(0);
  });

  it('but is still counted while they have no booking', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: 'still-gone@example.com' }], error: null },
      crm_contacts: { data: [{ id: 'contact-1', email: 'still-gone@example.com' }], error: null },
      scheduling_bookings: { data: [], error: null },
    });

    expect(await abandonedContactCount(client, 'owner-1')).toBe(1);
  });

  it('counts a booking under any contact row sharing the address', async () => {
    /* A duplicate contact is a CRM artefact, not a second person. */
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: 'dupe@example.com' }], error: null },
      crm_contacts: {
        data: [
          { id: 'contact-a', email: 'dupe@example.com' },
          { id: 'contact-b', email: 'dupe@example.com' },
        ],
        error: null,
      },
      scheduling_bookings: { data: [{ contact_id: 'contact-b' }], error: null },
    });

    expect(await abandonedContactCount(client, 'owner-1')).toBe(0);
  });
});

describe('somebody who never became a contact never booked', () => {
  it('is counted', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: 'ghost@example.com' }], error: null },
      crm_contacts: { data: [], error: null },
    });

    /* The common shape: they filled the booking form, left before finishing,
       and no contact row was ever made. Defaulting them to "has booked" would
       hide the only people this figure exists to surface. */
    expect(await abandonedContactCount(client, 'owner-1')).toBe(1);
  });
});

describe('it says nothing rather than something wrong', () => {
  it('reports zero when the attempts cannot be read', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: null, error: { message: 'boom' } },
    });

    expect(await abandonedContactCount(client, 'owner-1')).toBe(0);
  });

  it('reports zero when the booking check fails', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: 'someone@example.com' }], error: null },
      crm_contacts: { data: [{ id: 'contact-1', email: 'someone@example.com' }], error: null },
      scheduling_bookings: { data: null, error: { message: 'boom' } },
    });

    /* A card showing nothing is a quiet state an owner can ignore. One showing
       a wrong number is work they will go and do. */
    expect(await abandonedContactCount(client, 'owner-1')).toBe(0);
  });

  it('skips attempts with no email at all', async () => {
    const client = fakeClient({
      abandoned_bookings: { data: [{ email: null }, { email: '' }], error: null },
    });

    expect(await abandonedContactCount(client, 'owner-1')).toBe(0);
  });
});
