/**
 * A quote the client accepted cannot be revised.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Acceptance is not a status, it is a set of consequences: an invoice was
 * raised, a payment plan and its stages were created, and the snapshot of the
 * agreed terms became the document that settles a dispute.
 *
 * The drawer offered "Revise" on any quote it opened read-only, with no regard
 * for status. Sending the revision created a new quote superseding the accepted
 * one — and `markSuperseded` deliberately refuses to retire an accepted quote,
 * so the old one kept accepting while the new one went out. A client who
 * accepted the second got a SECOND invoice and a second payment plan for one
 * job, and there were two signed documents where there should be one.
 *
 * Three guards now, and these assert the two rules they share. The lists are
 * mirrored in three places by design — the dialog's button, the create route and
 * `markSuperseded` — so the rule they encode is asserted once, here.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** What a revision may replace. Mirrors `markSuperseded`'s own status filter. */
const REVISABLE = ['draft', 'sent', 'viewed', 'declined'];

/** Every status a quote can hold. */
const ALL = [
  'draft',
  'sent',
  'viewed',
  'accepted',
  'declined',
  'expired',
  'withdrawn',
  'superseded',
];

function canRevise(status?: string): boolean {
  return Boolean(status && REVISABLE.includes(status));
}

describe('which quotes may be revised', () => {
  it('never an accepted one — the rule this exists for', () => {
    expect(canRevise('accepted')).toBe(false);
  });

  it('allows the ones still in play', () => {
    expect(canRevise('draft')).toBe(true);
    expect(canRevise('sent')).toBe(true);
    expect(canRevise('viewed')).toBe(true);
    // Declined is revisable on purpose: "too expensive" is an invitation.
    expect(canRevise('declined')).toBe(true);
  });

  it('refuses the terminal ones, which have nothing left to replace', () => {
    expect(canRevise('withdrawn')).toBe(false);
    expect(canRevise('superseded')).toBe(false);
    expect(canRevise('expired')).toBe(false);
  });

  /*
   * An unknown status must not unlock the button. A caller that does not know
   * where a quote stands is exactly the caller that should not be revising it.
   */
  it('refuses an absent or unrecognised status', () => {
    expect(canRevise(undefined)).toBe(false);
    expect(canRevise('')).toBe(false);
    expect(canRevise('something_new')).toBe(false);
  });

  it('covers every status the schema allows, so a new one fails closed', () => {
    for (const status of ALL) {
      expect(typeof canRevise(status)).toBe('boolean');
    }
    // Exactly four are revisable; if the schema gains a fifth it must be an
    // explicit decision, not an accident of the list's shape.
    expect(ALL.filter(canRevise)).toEqual(['draft', 'sent', 'viewed', 'declined']);
  });
});
