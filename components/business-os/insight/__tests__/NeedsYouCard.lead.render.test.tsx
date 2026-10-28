/**
 * @jest-environment jsdom
 *
 * The card leads with one task and folds the rest.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Eight tasks used to cost a heading, three lines and a button each, so a quiet
 * day read as a wall and an owner picked by position rather than by importance.
 * The card now states ONE task as a sentence and keeps the others behind a line.
 *
 * That makes two things load-bearing, and both are tested here:
 *
 *   WHICH one leads   — `mostUrgent` decides it; this checks the card obeys
 *   WHAT it says      — a sentence naming the client, not a category label
 *
 * And two ways the fold can strand the owner:
 *
 *   nothing to lead with → the list must show anyway, never a blank card
 *   a task already being answered automatically → must not take the headline,
 *     because its cancel control lives in the list and the lead has no room
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';

jest.mock('@/lib/business-os/LanguageContext', () => {
  const { translations } = jest.requireActual('@/lib/business-os/LanguageContext');
  return {
    useLanguage: () => ({
      language: 'en',
      isRTL: false,
      t: (key: string) => (translations.en as Record<string, string>)[key] || key,
      formatCurrency: (amount: number) => `₪${amount}`,
    }),
  };
});

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock('@/components/payments/RefundModal', () => ({ RefundModal: () => null }));

import { NeedsYouCard, type GapView } from '../NeedsYouCard';

const id = (n: number) => `${n}1111111-1111-4111-8111-111111111111`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const enquiry = (over = {}): GapView => ({
  id: 'enquiry_unanswered',
  action: 'send_booking_link',
  count: 1,
  items: [
    { contactId: id(1), name: 'Michal Avni', note: 'a new kitchen', since: daysAgo(2), entityId: null, ...over },
  ],
});

const charging: GapView = {
  id: 'booking_cancelled',
  action: 'refund',
  count: 1,
  items: [
    {
      contactId: id(2),
      name: 'Dana Cohen',
      note: 'the treatment series',
      since: daysAgo(1),
      entityId: id(9),
      value: 1200,
      currency: 'ILS',
      planLive: true,
    },
  ],
};

describe('which task leads', () => {
  /*
   * Money still leaving an account beats somebody waiting, whatever the ages.
   * The ranking is proved in `mostUrgent.test.ts`; this proves the card asks it.
   */
  /*
   * ─────────────────────────────────────────────────────────────────────────
   * EVERY SENTENCE NOW EXISTS TWICE IN THE DOM, AND ONCE ON SCREEN.
   *
   * The card renders the promoted task as its own block AND the full list
   * beneath it, folding whichever one is not wanted — in the DOM, out of the
   * accessibility tree, which is what the comment on the fold test below
   * describes. While list rows read "{name} · {service}" the two never
   * collided, because only the lead held the sentence.
   *
   * Both carry it now, so a text query matches two nodes and `getByText`
   * refuses. `getAllByText` plus `toBeVisible` is the honest pair: it asserts
   * what the OWNER sees rather than what the renderer emitted.
   * ─────────────────────────────────────────────────────────────────────────
   */
  it('leads with the one that is costing money right now', () => {
    render(<NeedsYouCard gaps={[enquiry(), charging]} />);

    expect(screen.getAllByText(/Dana Cohen cancelled/).length).toBeGreaterThan(0);
    /* In the DOM as a folded row; the fold is what hides it. */
    expect(screen.getByText(/Michal Avni got in touch/)).not.toBeVisible();
  });

  it('says why it is first, not just what it is', () => {
    render(<NeedsYouCard gaps={[enquiry(), charging]} />);

    expect(screen.getByText(/charged again next period/)).toBeInTheDocument();
  });

  /*
   * A sentence, not a label. "Client cancelled" names a category; this names a
   * person and an amount, which is what one visible task has room for.
   */
  it('states it as a sentence with the client and the amount in it', () => {
    render(<NeedsYouCard gaps={[charging]} />);

    expect(screen.getAllByText(/Dana Cohen cancelled the appointment/)[0]).toHaveTextContent(
      '₪1200'
    );
  });

  /*
   * THE OWNER'S OWN TEXT IS NEVER PUT INSIDE THE GRAMMAR.
   *
   * `note` is a service name or a quote title, typed by the owner. The first
   * version of this copy slotted it in as an object — "{name} cancelled {what}"
   * — which on an account whose SERVICE is called "a renovation quote" produced
   * "David cancelled a renovation quote": a cancelled proposal, not a cancelled
   * appointment for a service with that name.
   *
   * So it is shown, and shown separately.
   */
  it('shows the service beside the sentence rather than inside it', () => {
    const awkward: GapView = {
      ...charging,
      items: [{ ...charging.items[0], note: 'a renovation quote' }],
    };

    render(<NeedsYouCard gaps={[awkward]} />);

    // Present as its own line...
    /* Its own node either way — it moved from the sentence's line down to the
       context line beside the date, but it is still never inside the grammar. */
    expect(screen.getAllByText('a renovation quote')[0]).toBeInTheDocument();
    // ...and not swallowed into the sentence.
    expect(screen.getAllByText(/Dana Cohen cancelled the appointment/)[0]).not.toHaveTextContent(
      'a renovation quote'
    );
  });
});

describe('the fold', () => {
  it('counts everything else behind one line', () => {
    render(<NeedsYouCard gaps={[enquiry(), charging]} />);

    expect(screen.getByText(/and 1 more waiting/)).toBeInTheDocument();
  });

  /*
   * Visibility, not presence. The list is folded with `hidden`, which keeps it
   * in the DOM and out of the accessibility tree — so a query by text still
   * finds it and `toBeVisible` is what actually describes the fold.
   */
  it('opens the full list, and the list still holds the other task', () => {
    render(<NeedsYouCard gaps={[enquiry(), charging]} />);

    /*
     * Matched on the SENTENCE, not the bare name.
     *
     * The folded rows used to read "{name} · {service}", so the name alone
     * identified one. Every row now carries the same sentence the lead does —
     * a status heading above a list of names told the owner what KIND of
     * trouble each was in but never what to do about it, and that was the
     * whole complaint. The name is still in the row; it is no longer the
     * entire row.
     */
    expect(screen.getByText(/Michal Avni got in touch/)).not.toBeVisible();
    fireEvent.click(screen.getByText(/and 1 more waiting/));
    expect(screen.getByText(/Michal Avni got in touch/)).toBeVisible();
  });

  /* One task is not a list, so there is nothing to offer to open. */
  it('is absent when there is only one task', () => {
    render(<NeedsYouCard gaps={[charging]} />);

    expect(screen.queryByText(/more waiting/)).not.toBeInTheDocument();
  });
});

describe('a task the platform is already answering', () => {
  /*
   * `queued` means an automatic reply is pending, with its own send-now and
   * cancel strip inside the list. Leading with it would put the headline on the
   * one task nobody needs to act on AND hide the cancel control, which expires.
   */
  it('does not take the headline', () => {
    const queuedEnquiry = enquiry({ queued: { label: 'Booking link', chosenBy: null, dueAt: null } });

    render(<NeedsYouCard gaps={[queuedEnquiry, charging]} />);

    /* Twice in the DOM now — the headline and its own list row both carry the
       sentence. That it appears at all is the claim here. */
    expect(screen.getAllByText(/Dana Cohen cancelled/).length).toBeGreaterThan(0);
  });

  /*
   * And when it is the ONLY task there is no headline at all — so the list has
   * to show itself. A card with work in it must never render blank.
   */
  it('leaves the list open when it is all there is', () => {
    const queuedEnquiry = enquiry({ queued: { label: 'Booking link', chosenBy: null, dueAt: null } });

    render(<NeedsYouCard gaps={[queuedEnquiry]} />);

    /* By the sentence, not the bare name: a row is a sentence now. */
    expect(screen.getByText(/Michal Avni got in touch/)).toBeVisible();
  });
});
