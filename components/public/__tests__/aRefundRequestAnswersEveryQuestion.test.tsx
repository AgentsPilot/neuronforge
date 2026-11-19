/**
 * @jest-environment jsdom
 *
 * Every field on the refund form is the client's to fill.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WAS WRONG WITH THE DEFAULTS
 *
 * Two of the three answers used to be supplied by the form itself:
 *
 *   · `reason` arrived pre-selected as "I cancelled". That is a claim about why
 *     somebody wants their money back, made on their behalf before they had
 *     said anything, and the owner read it as the client's own words.
 *   · the amount fell back to the whole refundable sum when the box was left
 *     empty, with the maximum shown as a greyed placeholder — so a client who
 *     never typed a figure still asked for all of it, and the request looked
 *     deliberate.
 *
 * A refund is a dispute about money. A guessed answer is the worst kind of
 * default here, because it looks like an answer rather than an omission.
 *
 * So the form now asks for all three, says `required` beside each one, and
 * keeps the button inert until they are answered.
 */

import fs from 'fs';
import path from 'path';

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

import { RefundPanel, type RefundableBooking } from '@/components/public/RefundPanel';

/** The copy keys this form uses, echoed so assertions read as English. */
const COPY: Record<string, string> = {
  'refund.required': 'required',
  'refund.how_much': 'How much?',
  'refund.why': 'Why?',
  'refund.note': 'Tell us a bit more',
  'refund.submit': 'Send the request',
  'refund.up_to': 'up to {amount}',
  'refund.reason.cancelled_by_client': 'I cancelled',
  'refund.reason.service_not_delivered': 'I did not get the service',
  'refund.reason.duplicate_payment': 'I was charged twice',
  'refund.reason.no_show': 'I did not attend',
  'refund.reason.goodwill': 'Something else',
};

const t = (key: string) => COPY[key] ?? key;

/* One booking, so the panel auto-selects it and the fields render at once. */
const booking: RefundableBooking = {
  bookingId: 'bk-1',
  title: 'Coaching session',
  startTime: '2026-11-20T09:00:00Z',
  refundable: 400,
  currency: 'USD',
  paid: 400,
  paidAt: '2026-11-10T09:00:00Z',
  requestedAt: null,
  invoiceNumber: 'INV-00042',
};

const panel = () =>
  render(<RefundPanel token="tok" bookings={[booking]} locale="en" t={t} />);

const sendButton = () => screen.getByRole('button', { name: 'Send the request' });
const amountBox = () => document.querySelector('input[type="number"]') as HTMLInputElement;
const noteBox = () => document.querySelector('textarea') as HTMLTextAreaElement;

const fillAmount = (value: string) => fireEvent.change(amountBox(), { target: { value } });
const fillNote = (value: string) => fireEvent.change(noteBox(), { target: { value } });
const pickReason = () => fireEvent.click(screen.getByRole('button', { name: 'I cancelled' }));

describe('nothing is answered for the client', () => {
  it('pre-selects no reason', () => {
    panel();

    const pressed = screen
      .getAllByRole('button')
      .filter(b => b.getAttribute('aria-pressed') === 'true');

    expect(pressed).toHaveLength(0);
  });

  it('puts no figure, and no placeholder figure, in the amount box', () => {
    panel();

    expect(amountBox().value).toBe('');
    /* A greyed "400" reads as a value already there, which is exactly how the
       silent fallback to the full amount went unnoticed. */
    expect(amountBox().getAttribute('placeholder')).toBeNull();
  });

  it('starts with the request unsendable', () => {
    panel();
    expect(sendButton()).toBeDisabled();
  });
});

describe('the form says which fields it needs', () => {
  it('shows an asterisk on all three', () => {
    panel();

    const stars = Array.from(document.querySelectorAll('span[aria-hidden="true"]')).filter(
      el => el.textContent?.trim() === '*'
    );

    expect(stars).toHaveLength(3);
  });

  it('paints it with the danger token, not a literal red', () => {
    /*
     * Asserted against the SOURCE, because jsdom discards `var(--ap-danger)`
     * when React sets it on the style property: the colour never reaches the
     * DOM at all, so a rendered assertion would pass on no colour whatsoever.
     *
     * The token rather than a hex so the mark follows the portal's theme, the
     * way every other red on this panel already does.
     */
    const source = fs.readFileSync(
      path.join(process.cwd(), 'components/public/RefundPanel.tsx'),
      'utf8'
    );
    const marker = source.slice(source.indexOf('function Required('));

    expect(marker.slice(0, 600)).toContain("color: 'var(--ap-danger)'");
  });

  it('hides the asterisk from screen readers and gives them the word instead', () => {
    panel();

    /* An asterisk alone is a shape with no name: read aloud it is "star", or
       nothing, and the field sounds optional. */
    expect(screen.getAllByText('required')).toHaveLength(3);
    screen
      .getAllByText('required')
      .forEach(word => expect(word).toHaveClass('sr-only'));
  });

  it('marks the amount and the note required to assistive tech too', () => {
    panel();

    expect(amountBox()).toBeRequired();
    expect(noteBox()).toBeRequired();
  });

  it('marks the reason group required, since buttons carry no required state', () => {
    panel();

    const group = screen.getByText('Why?').closest('fieldset');
    expect(group).toHaveAttribute('aria-required', 'true');
  });
});

describe('the button opens only when every question is answered', () => {
  it.each([
    ['only the amount', () => fillAmount('100')],
    ['only the reason', () => pickReason()],
    ['only the note', () => fillNote('The session never happened.')],
    ['amount and reason, no note', () => { fillAmount('100'); pickReason(); }],
    ['amount and note, no reason', () => { fillAmount('100'); fillNote('Because.'); }],
    ['reason and note, no amount', () => { pickReason(); fillNote('Because.'); }],
  ])('stays disabled with %s', (_label, fill) => {
    panel();
    fill();

    expect(sendButton()).toBeDisabled();
  });

  it('enables once all three are answered', () => {
    panel();

    fillAmount('100');
    pickReason();
    fillNote('The session never happened.');

    expect(sendButton()).toBeEnabled();
  });
});

describe('the amount is still bounded by what is refundable', () => {
  it('refuses more than was paid, even with everything else answered', () => {
    panel();

    fillAmount('401');
    pickReason();
    fillNote('Because.');

    expect(sendButton()).toBeDisabled();
  });

  it('refuses zero', () => {
    panel();

    fillAmount('0');
    pickReason();
    fillNote('Because.');

    expect(sendButton()).toBeDisabled();
  });

  it('moves by whole units on the arrows, while still taking a part unit typed', () => {
    panel();

    /* `0.01` made the up/down arrows change the figure by a CENT, so going
       from 50 to 20 took thirty presses. `any` leaves the arrows on their
       default step of one and lifts the step constraint, so 49.50 is still a
       valid amount — which `step="1"` would have rejected. */
    expect(amountBox()).toHaveAttribute('step', 'any');

    fillAmount('49.50');
    pickReason();
    fillNote('Half of it.');

    expect(sendButton()).toBeEnabled();
  });

  it('accepts the full refundable amount when it is actually typed', () => {
    panel();

    fillAmount('400');
    pickReason();
    fillNote('Because.');

    expect(sendButton()).toBeEnabled();
  });
});
