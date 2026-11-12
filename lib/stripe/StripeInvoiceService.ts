/**
 * StripeInvoiceService
 *
 * Handles Stripe Invoice operations for business users.
 * Creates and manages invoices on user's Stripe Connect account.
 *
 * Features:
 * - Create invoices on Connect accounts
 * - Send invoices via Stripe (professional email + payment page)
 * - Get hosted invoice URL for client payment
 * - Mark invoices as paid (for manual payments)
 * - Void/cancel invoices
 * - Get invoice PDF URL
 */

import Stripe from 'stripe';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ service: 'StripeInvoiceService' });

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_price: number; // In cents
  total: number; // In cents
}

export interface CreateInvoiceParams {
  connectAccountId: string;
  customerEmail: string;
  customerName: string;
  lineItems: InvoiceLineItem[];
  dueDate: Date;
  currency?: string;
  description?: string;
  footer?: string;
  metadata?: Record<string, string>;
  /**
   * Whether Stripe may collect on this invoice by itself.
   *
   * Unset means Stripe's default, which for `send_invoice` is TRUE: once
   * finalised, Stripe emails the customer and runs its own dunning schedule.
   * Right for the invoice-email path, which is asking Stripe to do the sending.
   *
   * Pass `false` when raising an invoice only so it can be paid on our own
   * page. The client is already looking at the bill, and a second copy from
   * Stripe plus a chasing sequence on top of our reminders is noise.
   */
  autoAdvance?: boolean;
  /**
   * Stripe's idempotency key.
   *
   * Two clients opening the same unpaid bill at the same moment must not raise
   * two invoices for one debt. With a key, Stripe returns the first invoice
   * for every repeat within 24 hours instead of creating another.
   */
  idempotencyKey?: string;
}

/** What a bounded card plan's first invoice comes back as. */
export interface StripePlanSubscriptionResult {
  subscriptionId: string;
  /** The Stripe customer, which binding needs to mirror the plan. */
  customerId: string;
  /** The subscription's FIRST invoice, which is the one the client pays now. */
  invoiceId: string;
  hostedInvoiceUrl: string | null;
}

export interface StripeInvoiceResult {
  invoiceId: string;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  status: string;
  amountDue: number;
  currency: string;
}

export class StripeInvoiceService {
  private stripe: Stripe;

  constructor(stripeSecretKey?: string) {
    const secretKey = stripeSecretKey || process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    this.stripe = new Stripe(secretKey, {
      apiVersion: '2024-12-18.acacia'
    });
  }

  /**
   * Create a Stripe Customer on the Connect account (or find existing)
   */
  /**
   * A card plan's first period, raised as a SUBSCRIPTION's invoice.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * WHY NOT `createInvoice`, WHICH ALSO BILLS ONE PERIOD
   *
   * It bills the period and nothing more. A standalone invoice cannot save the
   * client's card: `save_default_payment_method` exists only on a subscription,
   * and an Invoice's `payment_method_options.card` offers only `installments`
   * and `request_three_d_secure` — no `setup_future_usage`. So a plan collected
   * that way takes period one by card and then has no way to take period two,
   * which is what the owner's path has been doing: the client pays ₪400, and a
   * week later gets a second bill to pay by hand on a service sold as a card
   * plan.
   *
   * Raising period one THROUGH a subscription fixes it at the only moment the
   * card is present. The client sees the same invoice and pays it the same way.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * `send_invoice`, NOT `charge_automatically`
   *
   * `charge_automatically` with `default_incomplete` is what the public widget
   * uses, and it is right there: the client is at the checkout and pays within
   * minutes. An owner-created booking is EMAILED, and may be opened three days
   * later — by which time an incomplete subscription has expired and the link
   * is dead. `send_invoice` leaves the invoice open until its due date, exactly
   * as the standalone invoice this replaces did.
   *
   * The subscription is switched to `charge_automatically` once that first
   * invoice is paid and a card is on file. Until then nothing can be charged,
   * which is the correct state for a client who has not paid yet.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * ONE PERIOD'S PRICE, NOT THE TOTAL
   *
   * The caller passes the period amount `planPhases` computed, which carries
   * the remainder on the FINAL period so the plan sums to exactly what was
   * agreed. The bounded schedule the webhook attaches replaces these phases; it
   * only has to be right for period one here.
   *
   * The metadata is what `bindPlanSubscription` reads to bound the plan. Without
   * `plan_count` it cannot tell how many periods were agreed, and an unbounded
   * subscription bills a client for ever.
   */
  async createPlanSubscriptionInvoice(params: {
    connectAccountId: string;
    customerEmail: string;
    customerName: string;
    /** One period, in minor units, from `planPhases`. */
    periodAmountMinor: number;
    currency: string;
    interval: { interval: Stripe.PriceCreateParams.Recurring.Interval; interval_count: number };
    productName: string;
    daysUntilDue: number;
    /**
     * When the plan must stop, as a Unix timestamp: the end of the LAST agreed
     * period. See the note on `cancel_at` below — this is not optional.
     */
    cancelAt: number;
    metadata: Record<string, string>;
  }): Promise<StripePlanSubscriptionResult> {
    const {
      connectAccountId,
      customerEmail,
      customerName,
      periodAmountMinor,
      currency,
      interval,
      productName,
      daysUntilDue,
      cancelAt,
      metadata,
    } = params;

    const accountOptions = { stripeAccount: connectAccountId };

    const customerId = await this.getOrCreateCustomer(connectAccountId, customerEmail, customerName);

    const price = await this.stripe.prices.create(
      {
        currency: currency.toLowerCase(),
        unit_amount: periodAmountMinor,
        /* `interval_count`, not `count`: reading the wrong field yields
           undefined, Stripe defaults it to 1, and a quarterly plan charges
           monthly — three times as often as the client agreed. */
        recurring: { interval: interval.interval, interval_count: interval.interval_count },
        product_data: { name: productName },
      },
      accountOptions
    );

    const subscription = await this.stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: price.id }],
        collection_method: 'send_invoice',
        days_until_due: Math.max(1, daysUntilDue),
        /*
         * ─────────────────────────────────────────────────────────────────
         * BORN WITH AN END DATE. THIS IS THE ONE LINE THAT MUST NOT BE LOST.
         *
         * A subscription with no end bills the client for ever, and that is a
         * legal problem, not a reporting one. `bindPlanSubscription` attaches a
         * Subscription Schedule with `end_behavior: 'cancel'` and is the proper
         * bound — but it runs from a WEBHOOK, and a webhook that never arrives
         * would leave this subscription running with nothing to stop it.
         *
         * `cancel_at` is set in the same call that creates it, so the plan can
         * never exist unbounded, not even for a second. The schedule then
         * refines the periods; this guarantees the ending regardless.
         *
         * Belt and braces, deliberately: the two mechanisms agree on the same
         * last period, and either alone would stop the plan.
         * ─────────────────────────────────────────────────────────────────
         */
        cancel_at: cancelAt,
        payment_settings: {
          /* The whole point: the card the client pays this first invoice with
             becomes the subscription's default, so period two can be charged
             without asking them again. */
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card'],
        },
        metadata,
        expand: ['latest_invoice'],
      },
      accountOptions
    );

    const latest = subscription.latest_invoice;
    const invoice = typeof latest === 'string' ? null : latest;

    if (!invoice?.id) {
      /* Loud: the subscription exists and the client has nothing to pay, which
         is the one state the caller cannot recover from on its own. */
      logger.error(
        { subscriptionId: subscription.id, connectAccountId },
        'Plan subscription created but Stripe raised no first invoice'
      );
      throw new Error('Plan subscription has no first invoice');
    }

    /* Finalised and sent, as the standalone path does: an invoice left in
       `draft` has no hosted page, so the client has nothing to open. */
    const sent = await this.stripe.invoices.sendInvoice(invoice.id, accountOptions);

    return {
      subscriptionId: subscription.id,
      customerId,
      invoiceId: sent.id ?? invoice.id,
      hostedInvoiceUrl: sent.hosted_invoice_url ?? invoice.hosted_invoice_url ?? null,
    };
  }

  private async getOrCreateCustomer(
    connectAccountId: string,
    customerEmail: string,
    customerName: string
  ): Promise<string> {
    try {
      // Search for existing customer by email
      const existingCustomers = await this.stripe.customers.list(
        {
          email: customerEmail,
          limit: 1
        },
        {
          stripeAccount: connectAccountId
        }
      );

      if (existingCustomers.data.length > 0) {
        const customer = existingCustomers.data[0];
        logger.debug({
          connectAccountId,
          customerId: customer.id,
          email: customerEmail
        }, 'Found existing Stripe customer');
        return customer.id;
      }

      // Create new customer
      const customer = await this.stripe.customers.create(
        {
          email: customerEmail,
          name: customerName
        },
        {
          stripeAccount: connectAccountId
        }
      );

      logger.info({
        connectAccountId,
        customerId: customer.id,
        email: customerEmail
      }, 'Created new Stripe customer on Connect account');

      return customer.id;
    } catch (error) {
      logger.error({ err: error, connectAccountId, customerEmail }, 'Failed to get/create customer');
      throw error;
    }
  }

  /**
   * Create an invoice on the user's Stripe Connect account
   */
  async createInvoice(params: CreateInvoiceParams): Promise<StripeInvoiceResult> {
    const {
      connectAccountId,
      customerEmail,
      customerName,
      lineItems,
      dueDate,
      currency = 'usd',
      description,
      footer,
      metadata
    } = params;

    try {
      logger.info({
        connectAccountId,
        customerEmail,
        lineItemCount: lineItems.length,
        dueDate: dueDate.toISOString()
      }, 'Creating Stripe invoice');

      // Get or create customer on Connect account
      const customerId = await this.getOrCreateCustomer(
        connectAccountId,
        customerEmail,
        customerName
      );

      // Create the invoice with the correct currency
      const invoice = await this.stripe.invoices.create(
        {
          customer: customerId,
          collection_method: 'send_invoice',
          ...(params.autoAdvance === undefined ? {} : { auto_advance: params.autoAdvance }),
          days_until_due: Math.max(1, Math.ceil((dueDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))),
          currency, // Set invoice currency to match line items
          description,
          footer,
          metadata: {
            ...metadata,
            created_via: 'neuronforge_invoice_system'
          }
        },
        {
          stripeAccount: connectAccountId,
          ...(params.idempotencyKey ? { idempotencyKey: params.idempotencyKey } : {})
        }
      );

      // Add line items to the invoice
      for (const item of lineItems) {
        await this.stripe.invoiceItems.create(
          {
            customer: customerId,
            invoice: invoice.id,
            description: item.description,
            quantity: item.quantity,
            unit_amount: item.unit_price,
            currency
          },
          {
            stripeAccount: connectAccountId
          }
        );
      }

      // Retrieve the updated invoice with line items
      const updatedInvoice = await this.stripe.invoices.retrieve(
        invoice.id,
        {
          stripeAccount: connectAccountId
        }
      );

      logger.info({
        invoiceId: updatedInvoice.id,
        connectAccountId,
        amountDue: updatedInvoice.amount_due,
        status: updatedInvoice.status
      }, 'Stripe invoice created');

      return {
        invoiceId: updatedInvoice.id,
        hostedInvoiceUrl: updatedInvoice.hosted_invoice_url,
        invoicePdf: updatedInvoice.invoice_pdf,
        status: updatedInvoice.status || 'draft',
        amountDue: updatedInvoice.amount_due,
        currency: updatedInvoice.currency
      };
    } catch (error) {
      logger.error({ err: error, connectAccountId, customerEmail }, 'Failed to create Stripe invoice');
      throw error;
    }
  }

  /**
   * Finalize and send an invoice via Stripe
   * This sends a professional email from Stripe with payment link
   */
  async sendInvoice(
    invoiceId: string,
    connectAccountId: string
  ): Promise<StripeInvoiceResult> {
    try {
      logger.info({ invoiceId, connectAccountId }, 'Sending Stripe invoice');

      // Finalize the invoice (required before sending)
      const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      /*
       * An invoice with nothing left to pay is already finished.
       *
       * Finalizing applies whatever credit the customer holds — a refund taken
       * as customer balance, a credit note, an overpayment. When that covers the
       * total, Stripe settles the invoice on the spot: `amount_due` is 0 and the
       * status is already `paid`. `sendInvoice` then refuses it, with a message
       * that reads like a fault at Stripe's end: "This invoice cannot be sent
       * right now. Please contact us via support.stripe.com".
       *
       * The caller treated that as "Stripe failed" and fell back to a local
       * invoice — so a booking whose invoice Stripe had ALREADY marked paid was
       * recorded as pending, was never linked by `stripe_invoice_id` (leaving
       * the `invoice.paid` webhook unable to find it), got a payment link for
       * money that was not owed, and had a payment reminder scheduled for it.
       *
       * Nothing to send is a success, not an error. It is returned as one.
       */
      if (finalizedInvoice.amount_due === 0 || finalizedInvoice.status === 'paid') {
        logger.info({
          invoiceId: finalizedInvoice.id,
          connectAccountId,
          status: finalizedInvoice.status,
          startingBalance: finalizedInvoice.starting_balance,
          total: finalizedInvoice.total
        }, 'Stripe invoice settled on finalization; nothing to send');

        return {
          invoiceId: finalizedInvoice.id,
          hostedInvoiceUrl: finalizedInvoice.hosted_invoice_url ?? null,
          invoicePdf: finalizedInvoice.invoice_pdf ?? null,
          status: finalizedInvoice.status || 'paid',
          amountDue: finalizedInvoice.amount_due,
          currency: finalizedInvoice.currency
        };
      }

      // Send the invoice
      const sentInvoice = await this.stripe.invoices.sendInvoice(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      logger.info({
        invoiceId: sentInvoice.id,
        connectAccountId,
        hostedUrl: sentInvoice.hosted_invoice_url,
        status: sentInvoice.status
      }, 'Stripe invoice sent');

      return {
        invoiceId: sentInvoice.id,
        hostedInvoiceUrl: sentInvoice.hosted_invoice_url,
        invoicePdf: sentInvoice.invoice_pdf,
        status: sentInvoice.status || 'open',
        amountDue: sentInvoice.amount_due,
        currency: sentInvoice.currency
      };
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to send Stripe invoice');
      throw error;
    }
  }

  /**
   * Finalise an invoice so it can be paid on OUR page, without Stripe sending
   * anything.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * HOW THIS DIFFERS FROM `sendInvoice`
   *
   * `sendInvoice` finalises AND calls Stripe's `invoices.sendInvoice`, which
   * emails the customer. That is the right thing when Stripe is doing the
   * delivering. It is the wrong thing when the client is already looking at
   * the bill in their portal.
   *
   * Finalising alone is what creates the PaymentIntent, and therefore the
   * `confirmation_secret` the embedded card confirms. It charges nobody.
   *
   * `auto_advance: false` is the load-bearing argument. Left at Stripe's
   * default for `send_invoice` — which is TRUE — finalising would hand the
   * invoice to Stripe's own collection: an email to the customer and a dunning
   * schedule running alongside our reminders. The client would get two bills
   * and two chasers for one debt.
   *
   * Already-finalised invoices are returned as they are rather than treated as
   * an error, so a second opener of the same bill is harmless.
   * ───────────────────────────────────────────────────────────────────────────
   */
  async finalizeForPayment(
    invoiceId: string,
    connectAccountId: string
  ): Promise<{ invoiceId: string; status: string; hostedInvoiceUrl: string | null; invoicePdf: string | null }> {
    const existing = await this.stripe.invoices.retrieve(invoiceId, {
      stripeAccount: connectAccountId
    });

    const invoice =
      existing.status === 'draft'
        ? await this.stripe.invoices.finalizeInvoice(
            invoiceId,
            { auto_advance: false },
            { stripeAccount: connectAccountId }
          )
        : existing;

    logger.info(
      { invoiceId, connectAccountId, status: invoice.status, wasDraft: existing.status === 'draft' },
      'Invoice finalised for in-portal payment'
    );

    return {
      invoiceId: invoice.id as string,
      status: invoice.status || 'open',
      hostedInvoiceUrl: invoice.hosted_invoice_url ?? null,
      invoicePdf: invoice.invoice_pdf ?? null
    };
  }
  /**
   * Get the hosted invoice URL where client can pay
   */
  async getInvoicePaymentUrl(
    invoiceId: string,
    connectAccountId: string
  ): Promise<string | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      return invoice.hosted_invoice_url;
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to get invoice payment URL');
      throw error;
    }
  }

  /**
   * Get the Stripe-generated PDF URL for the invoice
   */
  async getInvoicePdf(
    invoiceId: string,
    connectAccountId: string
  ): Promise<string | null> {
    try {
      const invoice = await this.stripe.invoices.retrieve(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      return invoice.invoice_pdf;
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to get invoice PDF URL');
      throw error;
    }
  }

  /**
   * Mark an invoice as paid outside of Stripe (manual payment)
   */
  async markInvoicePaid(
    invoiceId: string,
    connectAccountId: string
  ): Promise<StripeInvoiceResult> {
    try {
      logger.info({ invoiceId, connectAccountId }, 'Marking Stripe invoice as paid');

      const invoice = await this.stripe.invoices.pay(
        invoiceId,
        {
          paid_out_of_band: true
        },
        {
          stripeAccount: connectAccountId
        }
      );

      logger.info({
        invoiceId: invoice.id,
        connectAccountId,
        status: invoice.status
      }, 'Stripe invoice marked as paid');

      return {
        invoiceId: invoice.id,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
        status: invoice.status || 'paid',
        amountDue: invoice.amount_due,
        currency: invoice.currency
      };
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to mark invoice as paid');
      throw error;
    }
  }

  /**
   * Void (cancel) an invoice
   */
  async voidInvoice(
    invoiceId: string,
    connectAccountId: string
  ): Promise<StripeInvoiceResult> {
    try {
      logger.info({ invoiceId, connectAccountId }, 'Voiding Stripe invoice');

      const invoice = await this.stripe.invoices.voidInvoice(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      logger.info({
        invoiceId: invoice.id,
        connectAccountId,
        status: invoice.status
      }, 'Stripe invoice voided');

      return {
        invoiceId: invoice.id,
        hostedInvoiceUrl: invoice.hosted_invoice_url,
        invoicePdf: invoice.invoice_pdf,
        status: invoice.status || 'void',
        amountDue: invoice.amount_due,
        currency: invoice.currency
      };
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to void invoice');
      throw error;
    }
  }

  /**
   * Get invoice details from Stripe
   */
  async getInvoice(
    invoiceId: string,
    connectAccountId: string
  ): Promise<Stripe.Invoice> {
    try {
      const invoice = await this.stripe.invoices.retrieve(
        invoiceId,
        {
          stripeAccount: connectAccountId
        }
      );

      return invoice;
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to get invoice');
      throw error;
    }
  }

  /**
   * List invoices for a Connect account
   */
  async listInvoices(
    connectAccountId: string,
    options: {
      customerId?: string;
      status?: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
      limit?: number;
    } = {}
  ): Promise<Stripe.Invoice[]> {
    try {
      const { customerId, status, limit = 10 } = options;

      const params: Stripe.InvoiceListParams = {
        limit
      };

      if (customerId) params.customer = customerId;
      if (status) params.status = status;

      const invoices = await this.stripe.invoices.list(
        params,
        {
          stripeAccount: connectAccountId
        }
      );

      return invoices.data;
    } catch (error) {
      logger.error({ err: error, connectAccountId }, 'Failed to list invoices');
      throw error;
    }
  }

  /**
   * Update invoice metadata (before finalization)
   */
  async updateInvoiceMetadata(
    invoiceId: string,
    connectAccountId: string,
    metadata: Record<string, string>
  ): Promise<Stripe.Invoice> {
    try {
      const invoice = await this.stripe.invoices.update(
        invoiceId,
        {
          metadata
        },
        {
          stripeAccount: connectAccountId
        }
      );

      logger.debug({ invoiceId, connectAccountId }, 'Updated invoice metadata');
      return invoice;
    } catch (error) {
      logger.error({ err: error, invoiceId, connectAccountId }, 'Failed to update invoice metadata');
      throw error;
    }
  }
}

// Singleton instance
let stripeInvoiceServiceInstance: StripeInvoiceService | null = null;

export function getStripeInvoiceService(): StripeInvoiceService {
  if (!stripeInvoiceServiceInstance) {
    stripeInvoiceServiceInstance = new StripeInvoiceService();
  }
  return stripeInvoiceServiceInstance;
}
