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
  it('leads with the one that is costing money right now', () => {
    render(<NeedsYouCard gaps={[enquiry(), charging]} />);

    expect(screen.getByText(/Dana Cohen cancelled/)).toBeInTheDocument();
    expect(screen.queryByText(/Michal Avni got in touch/)).not.toBeInTheDocument();
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

    expect(screen.getByText(/Dana Cohen cancelled the appointment/)).toHaveTextContent('₪1200');
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
    expect(screen.getByText('a renovation quote')).toBeVisible();
    // ...and not swallowed into the sentence.
    expect(screen.getByText(/Dana Cohen cancelled the appointment/)).not.toHaveTextContent(
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

    expect(screen.getByText('Michal Avni')).not.toBeVisible();
    fireEvent.click(screen.getByText(/and 1 more waiting/));
    expect(screen.getByText('Michal Avni')).toBeVisible();
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

    expect(screen.getByText(/Dana Cohen cancelled/)).toBeInTheDocument();
  });

  /*
   * And when it is the ONLY task there is no headline at all — so the list has
   * to show itself. A card with work in it must never render blank.
   */
  it('leaves the list open when it is all there is', () => {
    const queuedEnquiry = enquiry({ queued: { label: 'Booking link', chosenBy: null, dueAt: null } });

    render(<NeedsYouCard gaps={[queuedEnquiry]} />);

    expect(screen.getByText('Michal Avni')).toBeInTheDocument();
  });
});
