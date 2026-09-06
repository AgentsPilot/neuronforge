import { isSettledInvoice } from '../invoiceSettlement';

describe('[smoke] isSettledInvoice', () => {
  it('is settled when the invoice is marked paid', () => {
    expect(isSettledInvoice({ status: 'paid', paid_at: null })).toBe(true);
  });

  it('is settled when a payment date landed, whatever the status says', () => {
    // A processor webhook can stamp paid_at before the status transition. In
    // that window the invoice reads as 'sent' but the money has arrived, and
    // deleting it would erase a real payment.
    expect(isSettledInvoice({ status: 'sent', paid_at: '2026-08-20T10:00:00Z' })).toBe(true);
    expect(isSettledInvoice({ status: 'overdue', paid_at: '2026-08-20T10:00:00Z' })).toBe(true);
  });

  it('is not settled for anything still owed', () => {
    for (const status of ['draft', 'sent', 'overdue']) {
      expect(isSettledInvoice({ status, paid_at: null })).toBe(false);
    }
  });

  it('is not settled for an invoice that was voided', () => {
    // Cancelled means nobody owes anything and nobody paid. It stays deletable.
    expect(isSettledInvoice({ status: 'cancelled', paid_at: null })).toBe(false);
  });

  it('treats a missing invoice as unsettled rather than throwing', () => {
    // The callers load before they check; a null here means "not found", which
    // its own branch handles.
    expect(isSettledInvoice(null)).toBe(false);
    expect(isSettledInvoice(undefined)).toBe(false);
  });

  it('ignores an absent paid_at field entirely', () => {
    // Not every caller selects the column.
    expect(isSettledInvoice({ status: 'sent' })).toBe(false);
    expect(isSettledInvoice({ status: 'paid' })).toBe(true);
  });

  it('does not treat an empty payment date as a payment', () => {
    // An empty string is what a cleared field looks like coming back from the
    // database, and it means no payment — not one at the epoch.
    expect(isSettledInvoice({ status: 'sent', paid_at: '' })).toBe(false);
  });
});
