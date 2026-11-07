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

/**
 * Whole days from today to the due date, counted in CALENDAR days at UTC.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Stripe is told a NUMBER OF DAYS, not a date, so the arithmetic that produces
 * it decides what the client sees on the Stripe page — and it has to agree with
 * the date on our own invoice, or one document contradicts the other.
 *
 * It was `Math.ceil((due - now) / 86400000)`, a raw millisecond division, which
 * depends on the time of day the invoice happens to be raised: a due date two
 * days out reads as 2 at 21:00 and as 3 at 06:00, so the same invoice raised in
 * the morning fell due a day later at Stripe than it did with us.
 *
 * Counting calendar days removes the clock from it: both ends are taken at UTC
 * midnight, so the answer is the number of date boundaries crossed, which is
 * what "due in N days" means to the person reading it.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function wholeDaysUntil(dueDate: Date, from: Date = new Date()): number {
  const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

  return Math.round((midnight(dueDate) - midnight(from)) / 86_400_000);
}

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
          /*
           * `0`, NOT `1`. An invoice due today is due TODAY at Stripe.
           *
           * This floored at 1, so every invoice falling due on the day it was
           * raised was reported to the client as due tomorrow — and that is the
           * common case, not the edge: due-on-receipt, and any service billed
           * when it is booked. Our record said one date, the Stripe page the
           * client pays against said another.
           *
           * A date already past clamps to 0 as well, which is the honest answer
           * for something overdue: due now, not due tomorrow.
           *
           * Stripe takes either this or a `due_date` timestamp, and this is
           * deliberately the one kept. A `due_date` in the past is REFUSED at
           * creation, so expressing "due today" that way risks failing the
           * invoice outright rather than dating it wrongly — a worse failure on
           * the path that asks a client for money. `days_until_due` has no such
           * floor: it is documented as a plain integer, and 0 means due on the
           * day it is created.
           */
          days_until_due: Math.max(0, wholeDaysUntil(dueDate)),
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
