/**
 * A quote that was paid and refunded is not a quote awaiting payment.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS PREVENTS
 *
 * An owner's booking, reported 2026-10-26. A quotation for $80: accepted, the
 * invoice paid, then refunded in full. The database had it exactly right —
 * `payment_invoices.status = 'refunded'`, `refunded_amount = 80`,
 * `refund_status = 'full'`, and the booking's own `payment_status = 'refunded'`.
 *
 * Four screens disagreed with it, all at once:
 *
 *   · Manage payment      "Pending", over a row reading "Refunded $80.00",
 *                         with "Mark as Paid" offered
 *   · the refund chip     "Partially refunded", on a refund of 80 out of 80
 *   · the totals strip    "OUTSTANDING $80"
 *   · the card's banner   "Needs invoicing" → "Next: collect payment"
 *
 * All four came from ONE expression in `quotedPayment`:
 *
 *     paidStages.length > 0 || (stages.length === 0 && invoice.status === 'paid')
 *
 * A fully refunded invoice's status is `refunded`, not `paid`. So a quote with
 * no stages read as money never collected, and from there:
 * `collected` fell to 0 → `fullyRefunded` requires `collected > 0` so it could
 * not be true → `status` fell through both branches to `'pending'`. Every
 * surface above is downstream of that single field.
 *
 * `outstandingInvoiceId`, eight lines below, had already been fixed for the
 * very same misreading — "a refunded invoice is not an outstanding one" — which
 * is why the card could tell the invoice was not owed and still call the
 * payment pending.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The scenarios below are the regression surface, not decoration: the fix
 * widens a test that four refund-shaped cases depend on, and eleven others must
 * answer exactly as they did before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { quotedPayment } from '@/components/crm/contact-drawer/CRMContactDrawerV2';
import { moneyStateFrom } from '@/components/crm/contact-drawer/moneyState';

type AnyProposal = Parameters<typeof quotedPayment>[0];

const invoice = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  amount: 80,
  status: 'paid',
  refunded_amount: 0,
  refunded_at: null,
  due_date: '2026-11-25',
  sent_at: null,
  ...over,
});

const quote = (over: Record<string, unknown> = {}) =>
  ({
    id: 'prop-1',
    status: 'accepted',
    created_invoice_id: 'inv-1',
    stages: [],
    invoice: invoice(),
    ...over,
  }) as unknown as AnyProposal;

const stage = (over: Record<string, unknown> = {}) => ({
  id: 'stage-1',
  amount: 100,
  status: 'pending',
  trigger: 'manual',
  invoice_id: null,
  refunded_amount: 0,
  refunded_at: null,
  ...over,
});

describe('the reported booking', () => {
  const refunded = quotedPayment(
    quote({ invoice: invoice({ status: 'refunded', refunded_amount: 80, refunded_at: '2026-10-26T20:16:00Z' }) }),
    'USD',
  );

  it('is refunded, not pending', () => {
    expect(refunded?.status).toBe('refunded');
  });

  it('knows the money arrived, so the refund reads as FULL and not partial', () => {
    /*
     * The chip renders "Partially refunded" for any status that is not
     * `refunded`, so this assertion is the chip.
     */
    expect(refunded?.refundedAmount).toBe(80);
    expect(refunded?.status).toBe('refunded');
  });

  it('owes nothing: no outstanding invoice to settle', () => {
    expect(refunded?.outstandingInvoiceId).toBeUndefined();
  });

  it('stops the card asking the owner to collect payment', () => {
    // `needs_invoice` is what produced "Needs invoicing" / "Send invoice".
    expect(moneyStateFrom(refunded)).toBe('paid');
  });
});

describe('what must not change', () => {
  const statusOf = (inv: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    quotedPayment(quote({ invoice: invoice(inv), ...over }), 'USD')?.status;

  it('an unpaid quote is still pending', () => {
    expect(statusOf({ status: 'sent' })).toBe('pending');
    expect(statusOf({ status: 'draft' })).toBe('pending');
    expect(statusOf({ status: 'cancelled' })).toBe('pending');
  });

  it('a paid quote is still paid', () => {
    expect(statusOf({ status: 'paid' })).toBe('paid');
  });

  it('a PARTIAL refund still reads paid, with the amount carried separately', () => {
    /*
     * The rule `SessionPayment.refundedAmount` documents: only a full refund
     * moves the status. This is the case the chip exists for.
     */
    const partial = quotedPayment(
      quote({ invoice: invoice({ status: 'paid', refunded_amount: 30 }) }),
      'USD',
    );

    expect(partial?.status).toBe('paid');
    expect(partial?.refundedAmount).toBe(30);
  });

  it('a proposal nobody accepted still has no payment at all', () => {
    expect(quotedPayment(quote({ status: 'draft' }), 'USD')).toBeNull();
  });

  it('a stopped job keeps the money it collected', () => {
    expect(statusOf({ status: 'paid' }, { status: 'stopped' })).toBe('paid');
    // And a stopped job that was refunded now says so, where it said pending.
    expect(statusOf({ status: 'refunded', refunded_amount: 80 }, { status: 'stopped' })).toBe('refunded');
  });
});

describe('staged quotes are read from their stages, untouched by this', () => {
  const staged = (stages: Array<ReturnType<typeof stage>>) =>
    quotedPayment(quote({ invoice: invoice({ amount: 200 }), stages }), 'USD');

  it('a paid deposit with a milestone still owed is paid', () => {
    expect(staged([stage({ status: 'paid', invoice_id: 'a' }), stage()])?.status).toBe('paid');
  });

  it('nothing paid is pending', () => {
    expect(staged([stage(), stage()])?.status).toBe('pending');
  });

  it('a refunded stage already worked, and still does', () => {
    /*
     * The stages path was never broken — `paidStages.length > 0` is true
     * whatever the invoice says. Only the no-stages branch misread a refund,
     * which is why this went unnoticed on quoted jobs billed in milestones.
     */
    expect(staged([stage({ status: 'paid', refunded_amount: 100 }), stage()])?.status).toBe('refunded');
  });
});

describe('the odd shape the fix deliberately admits', () => {
  it('a refund recorded against an invoice never marked paid counts as collected', () => {
    /*
     * Not invented here: `outstandingInvoiceId` reads `refunded_amount` rather
     * than `status` for exactly this reason, citing a live row where a refund
     * landed on an invoice still reading `sent`. Money that went back must have
     * arrived, whatever the status column says.
     */
    const odd = quotedPayment(
      quote({ invoice: invoice({ status: 'sent', refunded_amount: 80 }) }),
      'USD',
    );

    expect(odd?.status).toBe('refunded');
  });
});
