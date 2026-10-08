/**
 * A package's meeting is not a job waiting for a quote.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THE OWNER SAW
 *
 * A client accepted a six-session package. The drawer then drew SIX client
 * journeys, one per meeting, each with a quote step reading "the quote will be
 * sent after the meeting" — about meetings that quote had already created, sold
 * and billed. Six jobs where there was one.
 *
 * THE CAUSE is that `sale_mode: 'proposal'` is a fact about the SERVICE, and a
 * package is sold through exactly such a service. Every reader that asked the
 * service "is this quoted?" got yes for each session.
 *
 * The right question is about the BOOKING: a session has a parent, and what a
 * quote produced is not something a quote is still owed for. `isQuotedJob`
 * asks it in one place, and this reads the source to keep it that way — the
 * drawer builds its cards twice, in two code paths, and the first version of
 * this fix only corrected one of them.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const drawer = readFileSync(
  join(process.cwd(), 'components', 'crm', 'contact-drawer', 'CRMContactDrawerV2.tsx'),
  'utf8'
);

describe('the predicate', () => {
  it('asks the booking, not only the service', () => {
    expect(drawer).toContain('function isQuotedJob');
    expect(drawer).toContain("booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id");
  });

  it('is what the journey builder uses', () => {
    expect(drawer).toContain('const isQuotedBooking = isQuotedJob(booking);');
  });
});

describe('every place a quote is attached to a booking', () => {
  /*
   * The bare service test, which is the bug. One remaining occurrence is the
   * predicate's own body; anything beyond that is a reader that will hand a
   * package session a quote step again.
   */
  it('goes through the predicate', () => {
    const bare = drawer.split("service?.sale_mode === 'proposal'").length - 1;
    expect(bare).toBe(1);
  });

  it('covers both of the drawer’s card-building paths', () => {
    // `proposalsList` is the first pass, `freshProposals` the refetch. The fix
    // landed on one of them first, which is exactly how half a bug survives.
    expect(drawer).toContain('isQuotedJob(bookingWithService)');
    expect(drawer).toContain('isQuotedJob(booking as BookingWithService)');
  });
});

describe('the card itself', () => {
  const tab = readFileSync(
    join(process.cwd(), 'components', 'crm', 'contact-drawer', 'BookingsTab.tsx'),
    'utf8'
  );

  it('does not label a package session with the quoting vocabulary', () => {
    // The drawer's fix did not reach here: this component asks the same
    // question again for the status badge and the action strip's wording.
    expect(tab).toContain("booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id");
  });

  it('renders the meetings as a STEP of the journey', () => {
    /*
     * Not a panel beside it: every booking with a parent belongs to the quote
     * that sold it, so its meetings are a stage on that client's journey. A
     * card of their own is what made one package look like two jobs, the
     * second asking for a quote the first had already agreed.
     */
    expect(tab).toContain("step.key === 'package' && session.meetings");
  });

  it('gives each meeting its own actions, against its own id', () => {
    /*
     * One journey, but six real appointments: each can be held, missed, moved
     * or called off alone, and for a per-session package marking one held is
     * what invoices it.
     *
     * The three outcomes used to be three literal calls here. They now go
     * through `MeetingRowActions`, which decides WHICH are possible from the
     * status and the clock — a meeting still ahead cannot have been held or
     * missed. What this guard still has to hold is the part that moving them
     * could have broken: every call carries `row.id`, the meeting's own, and
     * never the container's.
     */
    expect(tab).toContain('onSetBookingStatus(row.id, next)');
    expect(tab).toContain('onEditSession(row.id)');

    // Nothing in the list acts on the parent booking by mistake.
    const start = tab.indexOf('ONE LIST, NOT A STACK OF CARDS');
    const list = tab.slice(start, tab.indexOf('AddPackageMeeting', start));

    expect(start).toBeGreaterThan(-1);
    expect(list).not.toMatch(/onSetBookingStatus\(booking\.id/);
    expect(list).not.toMatch(/onEditSession\(booking\.id\)/);
  });
});

describe('the folding itself', () => {
  it('keeps a meeting whose purchase is not in the list', () => {
    // Mid-refetch the container can be absent, and a meeting that vanished
    // would be worse than one shown on its own.
    expect(drawer).toContain('!byId.has(card.booking.parent_booking_id)');
  });

  it('moves the meetings to the booking the QUOTE came out of', () => {
    /*
     * The container carries no quote of its own, so left as a card it drew a
     * second journey asking for one — "waiting for a quote", on the thing a
     * quote had just created. The journey that sold the block is the one the
     * meetings belong on.
     */
    expect(drawer).toContain('proposal.package_booking_id === containerId');
    expect(drawer).toContain('sold?.booking_id && byId.has(sold.booking_id)');
  });

  it('leaves a cold-sold package as its own card, having nowhere else to go', () => {
    // The fallback half of the same line: nowhere better to put it.
    expect(drawer).toContain('? sold.booking_id : containerId');
  });

  it('inserts that step straight after the quote', () => {
    expect(drawer).toContain("steps.findIndex(step => step.key === 'proposal')");
  });

  it('orders them as they were sold', () => {
    expect(drawer).toContain('(a.booking.occurrence_number ?? 0) - (b.booking.occurrence_number ?? 0)');
  });

  it('is applied on both the first load and the refetch', () => {
    // Each path with its OWN proposals list: the fold needs the same quotes the
    // cards were built from.
    expect(drawer).toContain('foldPackageMeetings(sessionCards, proposalsList)');
    expect(drawer).toContain('foldPackageMeetings(sessionCards, freshProposals)');
  });
});

describe('the parent reaches the journey at all', () => {
  it('is copied onto the appointment the journey reads', () => {
    // `toAppointment` copies field by field on purpose, so a column that is not
    // named here does not exist for any of this.
    expect(drawer).toContain('parent_booking_id: booking.parent_booking_id ?? null');
    expect(drawer).toContain('occurrence_number: booking.occurrence_number ?? null');
  });
});

/* ───────────────────────────────────────────────────────────────────────────
 * ACTIONS AGAINST A MEETING THAT IS NOT A CARD.
 *
 * Once a package's meetings became a step inside their quote's journey they
 * left the CARD list — and every lookup by booking id quietly found nothing.
 * Reschedule on a meeting row did nothing at all; the cancel dialog could not
 * tell whether the thing being cancelled had an hour; the drawer's count of
 * upcoming appointments dropped by six.
 *
 * Nothing about that fails loudly, which is why it is pinned here.
 * ─────────────────────────────────────────────────────────────────────────── */

describe('looking a booking up by id', () => {
  it('searches the meetings as well as the cards', () => {
    expect(drawer).toContain('sessions.flatMap(card => [card, ...(card.meetings ?? [])])');
  });

  it('is what reschedule uses', () => {
    expect(drawer).toContain('const session = findSession(bookingId);');
  });

  it('is what the cancel dialog uses to tell an appointment from a purchase', () => {
    expect(drawer).toContain("findSession(pendingCancelBookingId ?? '')");
  });

  it('is what the upcoming count counts', () => {
    // Six meetings that no longer appear in the count is a number the owner
    // reads as bookings disappearing.
    expect(drawer).toContain('everyBooking().filter(s =>');
  });
});
