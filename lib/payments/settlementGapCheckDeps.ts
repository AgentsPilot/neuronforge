/**
 * The settlement gap check's production wiring.
 *
 * The ONE file that hands the real Stripe client and repositories to
 * `runSettlementGapCheck`, so the check itself stays a pure comparison and can
 * be tested against a Stripe that never existed.
 *
 * Every method here is a read. `payment_invoices` is reached only through
 * `PaymentInvoiceRepository` and `stripe_connect_accounts` only through
 * `StripeConnectRepository` (CLAUDE.md rule 1). Server-only: both repositories
 * hold the service-role client, and the single caller is the fail-closed cron.
 *
 * @module lib/payments/settlementGapCheckDeps
 */

import type Stripe from 'stripe';

import { paymentInvoiceRepository, stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeService } from '@/lib/stripe/StripeService';
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';
import type { PaidInvoiceFact, SettlementGapCheckDeps } from './settlementGapCheck';

/**
 * Stripe's invoice, reduced to the four things an audit needs.
 *
 * `status_transitions.paid_at` is the moment of payment and is what the window
 * is applied to. `paid_at` is seconds since the epoch, so it is converted here
 * rather than in the comparison, where a unit mix-up would silently exclude
 * everything.
 */
function toFact(invoice: Stripe.Invoice): PaidInvoiceFact | null {
  if (!invoice.id) return null;
  const paidAtSeconds = invoice.status_transitions?.paid_at ?? null;
  return {
    stripeInvoiceId: invoice.id,
    amountPaidMinor: invoice.amount_paid ?? 0,
    currency: invoice.currency ?? '',
    paidAt: paidAtSeconds ? new Date(paidAtSeconds * 1000).toISOString() : null,
  };
}

export function settlementGapCheckDeps(): SettlementGapCheckDeps {
  return {
    pageConnectAccounts: (afterUserId, limit) => stripeConnectRepository.pageAccounts({ afterUserId, limit }),

    listPaidInvoices: async (target, createdSince, startingAfter, pageSize) => {
      try {
        const page = await getStripeService().listPaidInvoices({
          accountId: target.accountId,
          createdSince,
          limit: pageSize,
          ...(startingAfter ? { startingAfter } : {}),
        });
        const invoices = page.invoices.map(toFact).filter((fact): fact is PaidInvoiceFact => fact !== null);
        return { data: { invoices, hasMore: page.hasMore }, error: null };
      } catch (error) {
        // A refused listing must reach the check as an error, never as an empty
        // page: an empty page reads as "this account owes nothing", which is
        // precisely the false clean bill this whole job exists to prevent.
        return { data: null, error: error as Error };
      }
    },

    findLocalSettlement: async (stripeInvoiceId) => {
      const { data, error } = await paymentInvoiceRepository.findSettlementStateByStripeInvoiceId(stripeInvoiceId);
      if (error) return { data: null, error };

      // No row is an ANSWER here, and the loudest one: Stripe took money we
      // have no invoice for at all.
      if (!data) return { data: { found: false, settled: false, invoiceId: null, status: null }, error: null };

      return {
        data: {
          found: true,
          settled: isSettledInvoice(data),
          invoiceId: data.id,
          status: data.status,
        },
        error: null,
      };
    },

    now: () => new Date(),
  };
}
