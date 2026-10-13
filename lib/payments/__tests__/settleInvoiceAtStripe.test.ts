/**
 * Cash recorded here closes the invoice at Stripe too.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS COVERS
 *
 * An invoice raised through Stripe and then settled in cash stayed OPEN at
 * Stripe. In live mode the client holds Stripe's own emailed link to a working
 * payment page, so they could pay it again — and our ledger would then hide
 * that second charge, because `settleInvoicePaid` finds the manual transaction
 * and reports `alreadySettled`. Money taken twice, recorded once, and
 * unrefundable from our UI because refunds read transactions.
 *
 * `paid_out_of_band` is Stripe's own mechanism for it: the invoice is marked
 * paid and nobody is charged.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THESE PROTECT
 *
 * Mostly the NON-failures. The money is already in our ledger by the time this
 * runs, so every branch here must leave the local settlement standing — a
 * version of this that throws on a Stripe hiccup would tell an owner their
 * settlement failed, and they would record the same money a second time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const markInvoicePaid = jest.fn();
let connectAccountId: string | null = 'acct_live';

jest.mock('@/lib/repositories/PaymentRepository', () => ({
  stripeConnectRepository: {
    findByUserId: async () => ({
      data: connectAccountId ? { stripe_account_id: connectAccountId } : null,
    }),
  },
}));

jest.mock('@/lib/stripe/StripeInvoiceService', () => ({
  getStripeInvoiceService: () => ({ markInvoicePaid }),
}));

import { settleInvoiceAtStripe } from '../settleInvoiceAtStripe';

beforeEach(() => {
  markInvoicePaid.mockReset();
  markInvoicePaid.mockResolvedValue({ invoiceId: 'in_1', status: 'paid' });
  connectAccountId = 'acct_live';
});

const ARGS = { invoiceId: 'inv-1', stripeInvoiceId: 'in_1', userId: 'user-1' };

describe('an invoice Stripe raised', () => {
  it('is marked paid out of band, on the business own account', async () => {
    await expect(settleInvoiceAtStripe(ARGS)).resolves.toBe('settled');

    expect(markInvoicePaid).toHaveBeenCalledWith('in_1', 'acct_live');
  });
});

describe('an invoice Stripe never saw', () => {
  it('is skipped, which is the normal case for a business with no Stripe', async () => {
    /*
     * Recording cash is exactly what this dialog is for on an account with no
     * processor at all. Nothing to reconcile is not a failure, and must not be
     * logged or reported as one.
     */
    await expect(
      settleInvoiceAtStripe({ ...ARGS, stripeInvoiceId: null })
    ).resolves.toBe('skipped');
    await expect(
      settleInvoiceAtStripe({ ...ARGS, stripeInvoiceId: undefined })
    ).resolves.toBe('skipped');

    expect(markInvoicePaid).not.toHaveBeenCalled();
  });
});

describe('when Stripe cannot be reached or refuses', () => {
  it('reports failure rather than throwing, so the recorded money stands', async () => {
    /*
     * ─────────────────────────────────────────────────────────────────────
     * THE ONE THAT MATTERS.
     *
     * The transaction, the invoice and the plan stage are all written before
     * this runs. Throwing here would surface as "could not mark paid" on a
     * settlement that already happened, and the owner would do it again.
     * ─────────────────────────────────────────────────────────────────────
     */
    markInvoicePaid.mockRejectedValue(new Error('Stripe is down'));

    await expect(settleInvoiceAtStripe(ARGS)).resolves.toBe('failed');
  });

  it('treats "already paid" at Stripe as done', async () => {
    /*
     * Two ways to arrive here: a client paying the hosted page at the moment
     * the owner recorded their cash, and a retry of this function. Either way
     * Stripe's copy is closed, which is the entire objective — calling that a
     * failure sends somebody hunting a solved problem.
     */
    markInvoicePaid.mockRejectedValue(new Error('This invoice is already paid.'));

    await expect(settleInvoiceAtStripe(ARGS)).resolves.toBe('settled');
  });

  it('reports failure when the Stripe account is gone', async () => {
    // Disconnected since the invoice was raised. That invoice is still open on
    // an account we can no longer reach, and only a human can close it.
    connectAccountId = null;

    await expect(settleInvoiceAtStripe(ARGS)).resolves.toBe('failed');
    expect(markInvoicePaid).not.toHaveBeenCalled();
  });
});
