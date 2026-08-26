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
          stripeAccount: connectAccountId
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
