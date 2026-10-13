/**
 * @jest-environment jsdom
 *
 * What a stage row offers once the money has gone back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG
 *
 * On a fully refunded job the row's menu still offered "Send receipt". Pressing
 * it could only fail: `sendInvoice` refuses a refunded invoice outright — the
 * document it would build carries a live pay button and asks for money the
 * client was just given back — so the owner got an error for using a control
 * the product had drawn for them.
 *
 * The client is not left without paperwork either way. The refund confirmation
 * email goes out when the refund is recorded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE HOLD
 *
 * That the menu reflects what is actually possible — in both directions. A
 * version of this file that hides the receipt on every paid stage would pass
 * the first test and break the common case, so the ordinary paid stage is
 * asserted here too.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';

import { StageRowActions } from '../StageRowActions';

const COPY: Record<string, string> = {
  'crm.invoice.send_receipt': 'Send receipt',
  'crm.invoice.resend': 'Resend invoice',
  'payments.refund': 'Refund',
  'common.actions': 'Actions',
};

const t = (key: string) => COPY[key] ?? key;

/** Open the menu, or report that there is no menu to open. */
function openMenu(): boolean {
  const trigger = screen.queryByRole('button', { name: 'Actions' });
  if (!trigger) return false;
  fireEvent.click(trigger);
  return true;
}

const BASE = {
  invoiceId: 'inv-1',
  paid: true,
  onSendDocument: jest.fn(),
  onRefund: jest.fn(),
  t,
};

describe('a stage that was paid and kept', () => {
  it('offers the receipt and a refund', () => {
    // The common case, asserted so the fix cannot be "hide it always".
    render(<StageRowActions {...BASE} remaining={400} refunded={0} />);

    expect(openMenu()).toBe(true);
    expect(screen.getByText('Send receipt')).toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();
  });
});

describe('a stage that was fully refunded', () => {
  it('offers neither, so the whole menu goes away', () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * Receipt is refused by the send route; there is nothing left to refund.
     * With no item left the control removes itself, which also takes three
     * dots off a row that had nothing behind them.
     * ─────────────────────────────────────────────────────────────────────
     */
    render(<StageRowActions {...BASE} remaining={0} refunded={400} />);

    expect(openMenu()).toBe(false);
    expect(screen.queryByText('Send receipt')).not.toBeInTheDocument();
  });
});

describe('a stage that was partly refunded', () => {
  it('still offers the remaining refund but not the receipt', () => {
    /*
     * `sendInvoice` refuses `partially_refunded` too — the invoice is not a
     * debt again and sending it asks for the whole amount a second time — so
     * the receipt goes, while the ₪150 still with the business can be returned.
     */
    render(<StageRowActions {...BASE} remaining={150} refunded={250} />);

    expect(openMenu()).toBe(true);
    expect(screen.queryByText('Send receipt')).not.toBeInTheDocument();
    expect(screen.getByText('Refund')).toBeInTheDocument();
  });
});

describe('a stage still waiting to be paid', () => {
  it('offers the invoice, and nothing about refunds', () => {
    // Unaffected by any of this: nothing has been returned, so the new gate is
    // open and the old one about `paid` still closes the refund item.
    render(<StageRowActions {...BASE} paid={false} remaining={400} refunded={0} />);

    expect(openMenu()).toBe(true);
    expect(screen.getByText('Resend invoice')).toBeInTheDocument();
    expect(screen.queryByText('Refund')).not.toBeInTheDocument();
  });
});

describe('the refund figure is optional', () => {
  it('behaves as before when no caller passes it', () => {
    // The prop defaults to 0, so a call site that has not been updated keeps
    // the old behaviour rather than silently losing its receipt action.
    render(<StageRowActions invoiceId="inv-1" paid remaining={400} onSendDocument={jest.fn()} t={t} />);

    expect(openMenu()).toBe(true);
    expect(screen.getByText('Send receipt')).toBeInTheDocument();
  });
});
