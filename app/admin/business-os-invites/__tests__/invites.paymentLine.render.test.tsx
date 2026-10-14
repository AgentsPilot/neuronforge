/**
 * @jest-environment jsdom
 *
 * Plan payments P-5b.2 (FR-25, SA Q-7, Q-8, Q-12): the payment line on an
 * accepted invite in the admin Signup Invites list, in the L-6 standard.
 *
 * Pinned here: "Paid" with the date (UTC) and the amount paid in USD from minor
 * units; "Test payment" beside it only for a test-mode payment; "Signed up, not
 * paid" for a held account; "Paid, record not found" with no date or amount;
 * "Payment unknown"; nothing for a row with no payment (an older server) or a
 * non-accepted row; chips are StatusChips with their tones. English only.
 * Invented ids and amounts only.
 */

import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';

import { InviteList } from '../components/InviteList';
import type { InvitePayment, InviteRow } from '../types';

function row(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'invite-1',
    email: 'friend@example.com',
    inviteType: 'fixture-granted',
    grantLabel: 'Fixture Plan',
    accessSummary: 'Monthly',
    inviterDisplayName: 'Dana',
    language: 'en',
    createdAt: '2026-10-01T12:00:00.000Z',
    linkExpiryDays: 30,
    linkExpiresAt: '2026-10-31T12:00:00.000Z',
    state: 'accepted',
    firstViewedAt: null,
    revokedAt: null,
    revokeReason: null,
    redeemedAt: '2026-10-02T09:00:00.000Z',
    openedByExistingAccountAt: null,
    redeemedAccountId: 'acct-friend',
    level: 2,
    redemptionStoppedHalfway: false,
    redemptionFailure: null,
    ...overrides,
  };
}

function renderRow(payment: InvitePayment | null | undefined, overrides: Partial<InviteRow> = {}) {
  render(<InviteList invites={[row({ payment, ...overrides })]} onRevoke={() => undefined} />);
  return screen.getByTestId('invite-row-invite-1');
}

describe('the paid line (P-5b.2)', () => {
  it('paid, live: "Paid", the UTC date and the amount in USD, and no test marker', () => {
    const tr = renderRow({ state: 'paid_recorded', paidAt: '2026-10-12T23:30:00.000Z', amountMinor: 7900, currency: 'usd', livemode: true });
    const chip = within(tr).getByTestId('invite-payment-state');
    expect(chip).toHaveTextContent('Paid');
    expect(chip).toHaveAttribute('data-tone', 'ok');
    expect(within(tr).getByTestId('invite-payment-detail')).toHaveTextContent('2026-10-12 · $79.00 USD');
    expect(within(tr).queryByTestId('invite-payment-test')).not.toBeInTheDocument();
  });

  it('SA Q-12: a test-mode payment says "Test payment" beside it (neutral)', () => {
    const tr = renderRow({ state: 'paid_recorded', paidAt: '2026-10-12T10:00:00.000Z', amountMinor: 123456, currency: 'usd', livemode: false });
    expect(within(tr).getByTestId('invite-payment-detail')).toHaveTextContent('$1,234.56 USD');
    const test = within(tr).getByTestId('invite-payment-test');
    expect(test).toHaveTextContent('Test payment');
    expect(test).toHaveAttribute('data-tone', 'neutral');
  });

  it('a held account: "Signed up, not paid" (warn), no amount', () => {
    const tr = renderRow({ state: 'awaiting_payment' });
    const chip = within(tr).getByTestId('invite-payment-state');
    expect(chip).toHaveTextContent('Signed up, not paid');
    expect(chip).toHaveAttribute('data-tone', 'warn');
    expect(within(tr).queryByTestId('invite-payment-detail')).not.toBeInTheDocument();
  });

  it('SA Q-8: "Paid, record not found" (warn) with no date or amount', () => {
    const tr = renderRow({ state: 'paid_record_missing' });
    expect(within(tr).getByTestId('invite-payment-state')).toHaveTextContent('Paid, record not found');
    expect(within(tr).getByTestId('invite-payment')).not.toHaveTextContent('$');
  });

  it('a failed read: "Payment unknown", never "not paid"', () => {
    const tr = renderRow({ state: 'unknown' });
    expect(within(tr).getByTestId('invite-payment-state')).toHaveTextContent('Payment unknown');
    expect(tr).not.toHaveTextContent('not paid');
  });

  it.each([
    ['no payment from an older server', undefined],
    ['a null payment', null],
  ])('%s: nothing is shown', (_label, payment) => {
    const tr = renderRow(payment);
    expect(within(tr).queryByTestId('invite-payment')).not.toBeInTheDocument();
  });

  it('a non-accepted row never shows a payment line, whatever arrives', () => {
    const tr = renderRow({ state: 'awaiting_payment' }, { state: 'revoked', redeemedAt: null, redeemedAccountId: null });
    expect(within(tr).queryByTestId('invite-payment')).not.toBeInTheDocument();
  });

  it('the line sits in the State cell, under the State chip', () => {
    const tr = renderRow({ state: 'awaiting_payment' });
    const stateCell = within(tr).getByTestId('invite-state').closest('td');
    expect(stateCell).not.toBeNull();
    expect(within(stateCell as HTMLElement).getByTestId('invite-payment')).toBeInTheDocument();
  });
});
