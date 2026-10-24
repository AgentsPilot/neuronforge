/**
 * The Subscribers list answers "who may I email", not "who used one form".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS PINS
 *
 * The route listed `business_subscribers` and nothing else. That table has a
 * narrow, deliberate scope — newsletter signups who were not already contacts
 * — and only the two newsletter forms write to it.
 *
 * Consent is given in four other places: a tickbox inside the booking flow,
 * the same tickbox on the contact form, the owner entering it in the CRM
 * drawer, and the double opt-in link. None of them touch the roster, which is
 * correct; those people are contacts.
 *
 * So the screen answered a question nobody asks. On a live account nine people
 * were consented, every one mailable, and the tab showed zero: seven had never
 * been near a newsletter form, one was already a contact so the roster insert
 * skipped them by design, and one predated the roster feature by minutes.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS ASSERTED HERE
 *
 * The merge, not the HTTP. `buildAudience` is the pure half — two lists in, one
 * row per person out — so the cases that actually went wrong can be stated
 * directly: a person in both tables, a consent row with no contact behind it, a
 * contact that has since been deleted, and the toggle that has to mean the same
 * thing on both halves or it appears to do nothing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { buildAudience } from '@/app/api/crm/subscribers/buildAudience';

/** A roster row, with only the fields the merge reads. */
const rosterRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'r1',
    email: 'Signup@Example.com',
    email_normalized: 'signup@example.com',
    name: 'A Signup',
    status: 'pending',
    source: 'newsletter',
    subscribed_at: '2026-10-01T00:00:00Z',
    confirmed_at: null,
    promoted_contact_id: null,
    ...over,
  }) as never;

const consentRow = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    email_normalized: 'client@example.com',
    contact_id: 'c1',
    decided_at: '2026-10-05T00:00:00Z',
    ...over,
  }) as never;

const contact = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    id: 'c1',
    first_name: 'Dana',
    last_name: 'Levi',
    email: 'client@example.com',
    source: 'booking',
    ...over,
  }) as never;

describe('the mailable audience', () => {
  it('lists somebody who consented while booking and never saw a newsletter form', () => {
    /* The seven-of-nine case: no roster row exists, and they must still appear. */
    const rows = buildAudience({
      roster: [],
      consented: [consentRow()],
      contacts: [contact()],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      email: 'client@example.com',
      name: 'Dana Levi',
      status: 'contact',
      source: 'booking',
      mailable: true,
    });
  });

  it('still lists a roster signup who has not confirmed', () => {
    /* The thing the consent table cannot know: a signup mid-confirmation. */
    const rows = buildAudience({
      roster: [rosterRow()],
      consented: [],
      contacts: [],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'pending', mailable: false });
  });

  it('lists a person in both tables once, keeping the roster row', () => {
    /*
     * The roster row carries the signup's own history — when they subscribed,
     * what they confirmed. The consent row would flatten that to one date.
     */
    const rows = buildAudience({
      roster: [rosterRow({ email_normalized: 'client@example.com', status: 'confirmed' })],
      consented: [consentRow()],
      contacts: [contact()],
      consentByEmail: new Map([['client@example.com', true]]),
      includePromoted: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'r1', status: 'confirmed', mailable: true });
  });

  it('matches on the normalised address, not the one as typed', () => {
    const rows = buildAudience({
      roster: [rosterRow({ email: 'Client@Example.COM', email_normalized: 'client@example.com' })],
      consented: [consentRow()],
      contacts: [contact()],
      consentByEmail: new Map([['client@example.com', true]]),
      includePromoted: true,
    });

    expect(rows).toHaveLength(1);
  });

  it('lists a consented address with no contact behind it', () => {
    /*
     * Real: somebody who ticked the box on a contact form that never created a
     * contact. They are mailable, so leaving them out would understate the
     * audience the owner is about to write to.
     */
    const rows = buildAudience({
      roster: [],
      consented: [consentRow({ email_normalized: 'just@anaddress.com', contact_id: null })],
      contacts: [],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows[0]).toMatchObject({
      email: 'just@anaddress.com',
      name: null,
      status: 'confirmed',
      source: 'consent',
      promoted_contact_id: null,
      mailable: true,
    });
  });

  it('survives a contact that has since been deleted', () => {
    /*
     * A deleted contact does not un-say what they said, and the suppression has
     * to outlive them. The consent row stands; it is listed by address.
     */
    const rows = buildAudience({
      roster: [],
      consented: [consentRow({ contact_id: 'gone' })],
      contacts: [],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'confirmed', name: null });
  });

  it('never offers to promote somebody already in the CRM', () => {
    /* `promoted_contact_id` is what hides the button. A second contact for the
       same person is the bug it prevents. */
    const rows = buildAudience({
      roster: [],
      consented: [consentRow()],
      contacts: [contact()],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows[0].promoted_contact_id).toBe('c1');
  });

  it('trusts the consent table over the roster status', () => {
    /*
     * They disagree when consent is withdrawn through an unsubscribe link that
     * never touched the roster. The consent record governs sending.
     */
    const rows = buildAudience({
      roster: [rosterRow({ status: 'confirmed', email_normalized: 'signup@example.com' })],
      consented: [],
      contacts: [],
      consentByEmail: new Map([['signup@example.com', false]]),
      includePromoted: true,
    });

    expect(rows[0]).toMatchObject({ status: 'confirmed', mailable: false });
  });

  describe('the "already in the CRM" toggle', () => {
    const both = {
      roster: [
        rosterRow({ id: 'r1', email_normalized: 'moved@example.com', status: 'promoted' }),
        rosterRow({ id: 'r2', email_normalized: 'signup@example.com', status: 'pending' }),
      ],
      consented: [consentRow()],
      contacts: [contact()],
      consentByEmail: new Map<string, boolean>(),
    };

    it('shows everyone when it is on', () => {
      const rows = buildAudience({ ...both, includePromoted: true });

      expect(rows.map((r) => r.status).sort()).toEqual(['contact', 'pending', 'promoted']);
    });

    it('hides BOTH kinds of already-in-the-CRM when it is off', () => {
      /*
       * The failure this exists for. Filtering only the roster would drop the
       * promoted row and let it back in through the consent table as a
       * `contact` — the toggle would appear to do nothing.
       */
      const rows = buildAudience({ ...both, includePromoted: false });

      expect(rows.map((r) => r.status)).toEqual(['pending']);
    });

    it('does not resurrect a hidden roster row through the other door', () => {
      /* Same person, in both tables, promoted. Off means gone, not relabelled. */
      const rows = buildAudience({
        roster: [rosterRow({ email_normalized: 'client@example.com', status: 'promoted' })],
        consented: [consentRow()],
        contacts: [contact()],
        consentByEmail: new Map(),
        includePromoted: false,
      });

      expect(rows).toEqual([]);
    });
  });

  it('orders the whole list newest first, across both sources', () => {
    const rows = buildAudience({
      roster: [rosterRow({ subscribed_at: '2026-10-01T00:00:00Z' })],
      consented: [consentRow({ decided_at: '2026-10-20T00:00:00Z' })],
      contacts: [contact()],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    expect(rows.map((r) => r.subscribed_at)).toEqual([
      '2026-10-20T00:00:00Z',
      '2026-10-01T00:00:00Z',
    ]);
  });

  it('gives every row a distinct key, including the ones with no id of their own', () => {
    /*
     * `marketing_consent_state` is keyed on (user, address, channel) and has no
     * id to borrow, so a contactless row is keyed by its address. Duplicate
     * keys would make React drop rows silently.
     */
    const rows = buildAudience({
      roster: [rosterRow()],
      consented: [
        consentRow({ email_normalized: 'a@x.com', contact_id: null }),
        consentRow({ email_normalized: 'b@x.com', contact_id: null }),
        consentRow(),
      ],
      contacts: [contact()],
      consentByEmail: new Map(),
      includePromoted: true,
    });

    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
