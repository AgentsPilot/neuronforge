/**
 * The settlement gap check's production wiring.
 *
 * The ONE file that hands the real Stripe client and repositories to
 * `runSettlementGapCheck`, so the check itself stays a pure comparison and can
 * be tested against a Stripe that never existed.
 *
 * `payment_invoices` is reached only through `PaymentInvoiceRepository` and
 * `stripe_connect_accounts` only through `StripeConnectRepository` (CLAUDE.md
 * rule 1). Server-only: both repositories hold the service-role client, and the
 * single caller is the fail-closed cron.
 *
 * ── THREE OF THESE READ. TWO WRITE. ─────────────────────────────────────────
 *
 * This file was once reads only, and that was the defect: the check ran thirty
 * nights reporting `gapsFound: 0` while Stripe held money and bills the
 * platform had no record of. A finding that is only logged is a finding that
 * stays.
 *
 * `repairGap` records money Stripe already took. `mirrorBill` records a debt
 * Stripe is holding. NEITHER has its own copy of the insert — both delegate to
 * the single writer in `lib/payments/`, which is also what the webhook calls,
 * so a row written by a 05:17 sweep is the row the webhook would have written.
 * `lib/payments/__tests__/oneWriterPerMoneyFact.guard.test.ts` pins that.
 *
 * @module lib/payments/settlementGapCheckDeps
 */

import Stripe from 'stripe';

import { createLogger } from '@/lib/logger';
import { paymentInvoiceRepository, stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { getStripeService } from '@/lib/stripe/StripeService';
import { isSettledInvoice } from '@/lib/payments/invoiceSettlement';
import { subscriptionIdFromInvoice } from '@/lib/payments/invoiceSubscription';
import { mirrorPlanBill } from '@/lib/payments/mirrorPlanBill';
import { recordPlanPeriodPaid } from '@/lib/payments/recordPlanPeriod';
import { resolveAccountOwner, stripeRequestOptions } from '@/lib/payments/stripeAccountContext';
import { supabaseServer } from '@/lib/supabaseServer';
import type { OpenBillFact, PaidInvoiceFact, SettlementGapCheckDeps } from './settlementGapCheck';

const repairLogger = createLogger({ module: 'SettlementGapRepair' });


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

/**
 * Stripe's invoice, reduced to the three things a visibility check needs.
 *
 * `amount_due`, not `amount_paid`: nothing has been collected, and the figure
 * that matters is what the client still owes. `amount_remaining` would be the
 * same for an untouched invoice and smaller for a part-paid one; `amount_due`
 * is the bill as issued, which is what an owner is looking for when they ask
 * what this client owes.
 */
function toBill(invoice: Stripe.Invoice): OpenBillFact | null {
  if (!invoice.id) return null;
  return {
    stripeInvoiceId: invoice.id,
    amountDueMinor: invoice.amount_due ?? 0,
    currency: invoice.currency ?? '',
    createdAt: invoice.created ? new Date(invoice.created * 1000).toISOString() : null,
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

    /*
     * ── THE OTHER LISTING ─────────────────────────────────────────────────────
     *
     * Not "what did Stripe collect that we missed" but "what is Stripe owed
     * that we cannot see". Same accounts, same paging, same refusal rule: a
     * thrown listing reaches the check as an error, because an empty page here
     * reads as "this account is owed nothing", which is the false clean bill
     * the whole job exists to prevent.
     */
    listOpenInvoices: async (target, createdSince, startingAfter, pageSize) => {
      try {
        const page = await getStripeService().listOpenInvoices({
          accountId: target.accountId,
          createdSince,
          limit: pageSize,
          ...(startingAfter ? { startingAfter } : {}),
        });
        const invoices = page.invoices.map(toBill).filter((bill): bill is OpenBillFact => bill !== null);
        return { data: { invoices, hasMore: page.hasMore }, error: null };
      } catch (error) {
        return { data: null, error: error as Error };
      }
    },

    /*
     * ── THE MIRROR ────────────────────────────────────────────────────────────
     *
     * Hands the invoice to the SAME function the webhook uses. Not a copy of
     * it: `mirrorPlanBill` lives in `@/lib/payments/mirrorPlanBill` precisely so
     * this can call it, and so a row written at 05:17 by a sweep is the row the
     * webhook would have written when the invoice was raised.
     *
     * Returns false for a bill that is not a plan's. Those are an owner's own
     * Stripe subscriptions, which are none of our business — they are counted
     * and not mirrored, and `checkBill` logs them at warn rather than error for
     * exactly that reason.
     */
    mirrorBill: async bill => {
      if (!bill.accountId) return false;

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

      /* The account goes in the THIRD argument. In the second it is Stripe's
         params bag, and the invoice 404s on the platform account. */
      const invoice = await stripe.invoices.retrieve(
        bill.stripeInvoiceId,
        undefined,
        stripeRequestOptions(bill.accountId)
      );

      return mirrorPlanBill(invoice, bill.accountId, {
        ownsAccount: async (accountId, ownerId) =>
          Boolean(ownerId) && (await resolveAccountOwner(supabaseServer, accountId)) === ownerId,
        log: repairLogger,
      });
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

    /*
     * ── THE REPAIR ────────────────────────────────────────────────────────────
     *
     * Fetches the invoice Stripe says it collected and hands it to the SAME
     * function the webhook uses. Not a copy of it: `recordPlanPeriodPaid` lives
     * in `@/lib/payments/recordPlanPeriod` precisely so this can call it, and so
     * the row written at 05:17 by a sweep is byte-for-byte the row the webhook
     * would have written at the time.
     *
     * Idempotent, which is what makes a nightly sweep safe: the writer checks
     * `findInstallmentIdByStripeInvoiceId` before touching anything, and a
     * unique index enforces it underneath.
     *
     * Returns false — not an error — for an invoice that is not a plan period.
     * Those are ordinary invoices, a different shape of repair, and reporting
     * them is still the honest answer until that half is built.
     */
    repairGap: async gap => {
      if (!gap.accountId) return false;

      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

      /*
         The account goes in the THIRD argument, not the second. The second is
         Stripe's params bag, so passing it there retrieves from the PLATFORM
         account, where a connected account's invoice does not exist — a silent
         404 that would have made every repair look unrepairable.
      */
      const invoice = await stripe.invoices.retrieve(
        gap.stripeInvoiceId,
        undefined,
        stripeRequestOptions(gap.accountId)
      );

      /* The SAME reader the webhook uses. A hand-rolled copy here is how one
         caller survives a Stripe API shape change and the other does not. */
      const subscriptionId = subscriptionIdFromInvoice(invoice);
      if (!subscriptionId) return false;

      return recordPlanPeriodPaid(invoice, subscriptionId, gap.accountId, {
        /*
         * No cache here, unlike the webhook's: a sweep sees each account once
         * per run, so a map would hold entries nothing asks for twice.
         */
        ownsAccount: async (accountId, ownerId) =>
          Boolean(ownerId) && (await resolveAccountOwner(supabaseServer, accountId)) === ownerId,
        stripe: () => stripe,
        log: repairLogger,
      });
    },

    now: () => new Date(),
  };
}
