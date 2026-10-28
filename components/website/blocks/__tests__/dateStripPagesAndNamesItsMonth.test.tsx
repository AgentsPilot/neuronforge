/**
 * @jest-environment jsdom
 *
 * What the smart-link booking dialog's date strip actually renders.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A RENDER TEST AND NOT ANOTHER SOURCE GUARD
 *
 * Three changes landed in this one component — a paged window bounded by the
 * service's own limit, a month label, and closed days greyed out — and only the
 * greying was visible when it was tried. Reading the source cannot tell the
 * difference between "the code is wrong" and "the page was not rebuilt", so
 * this renders the component and looks.
 *
 * `DateTimeStep` is exported, and the smart link reaches it through
 * /c/[userCode]/book → PublicBookingPage → StandaloneBookingWidget →
 * BookingModal → ProcessFlowSection, so this is the same element a client sees.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

import { DateTimeStep, LABELS, type Service } from '../ProcessFlowSection';

const service = {
  id: 'svc-1',
  name: 'Renovation quote',
  description: null,
  duration_minutes: 60,
  price: 500,
  currency: 'ILS',
} as unknown as Service;

function open(overrides: Record<string, unknown> = {}) {
  return render(
    <DateTimeStep
      service={service}
      selectedDate=""
      selectedSlot={null}
      slots={[]}
      loadingSlots={false}
      primaryColor="#8B5CF6"
      onDateSelect={() => {}}
      onSlotSelect={() => {}}
      isRTL={false}
      labels={LABELS.en}
      businessTimezone="Asia/Jerusalem"
      {...overrides}
    />
  );
}

describe('the window', () => {
  it('shows a page of days, not the whole window at once', () => {
    /*
     * Counted by what the buttons DO rather than by their text: the first
     * version of this test matched on the last two characters of a label and
     * failed on a weekday abbreviation, which told me nothing about the
     * component and cost a round of debugging.
     */
    open();

    const dayButtons = screen
      .getAllByRole('button')
      .filter(b => !b.getAttribute('aria-label'));

    expect(dayButtons.length).toBeGreaterThan(7);
    expect(dayButtons.length).toBeLessThanOrEqual(14);
  });

  it('offers a way forward when the service allows more than one page', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT WAS REPORTED MISSING.
     *
     * With no `advance_booking_days` on the service the shared default is
     * ninety, so a forward arrow must exist from the first render.
     * ─────────────────────────────────────────────────────────────────────
     */
    open();

    expect(screen.getByRole('button', { name: LABELS.en.laterDates })).toBeEnabled();
  });

  it('cannot go back from the first page', () => {
    // Today is the floor; there is nothing earlier to offer.
    open();

    expect(screen.getByRole('button', { name: LABELS.en.earlierDates })).toBeDisabled();
  });

  it('moves the window when the arrow is pressed', () => {
    open();

    const before = screen.getAllByRole('button').map(b => b.textContent).join('|');
    fireEvent.click(screen.getByRole('button', { name: LABELS.en.laterDates }));
    const after = screen.getAllByRole('button').map(b => b.textContent).join('|');

    expect(after).not.toBe(before);
    expect(screen.getByRole('button', { name: LABELS.en.earlierDates })).toBeEnabled();
  });

  it('stops at a service that only books a week ahead', () => {
    // The business's own setting still wins over the default.
    open({ advanceBookingDays: 7 });

    expect(screen.queryByRole('button', { name: LABELS.en.laterDates })).toBeNull();
  });
});

describe('the month', () => {
  it('is named, so a day number is not the only clue', () => {
    /*
     * "31, 1, 2, 3" with no month is the complaint this answers: across ninety
     * days a client could book a date and learn the month from the
     * confirmation.
     */
    open();

    const month = new Date().toLocaleDateString('en-US', { month: 'long' });
    expect(screen.getByText(new RegExp(month))).toBeInTheDocument();
  });
});

describe('days the business does not work', () => {
  it('are shown and unclickable, not removed', () => {
    const today = new Date();
    const key = (offset: number) => {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      return d.toISOString().slice(0, 10);
    };

    open({ closedDates: new Set([key(1), key(2)]) });

    const disabled = screen.getAllByRole('button').filter(b => b.hasAttribute('disabled'));

    // The two closed days, plus the earlier arrow which is disabled on page 1.
    expect(disabled.length).toBeGreaterThanOrEqual(3);
  });
});
