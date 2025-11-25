/**
 * TransactionNormalizer - Normalize transactions from different payment providers
 *
 * Phase 1: Data Normalization Layer
 * Supports: Stripe, PayPal, Square, Braintree
 */

import type { UnifiedTransaction } from './types';

export class TransactionNormalizer {
  /**
   * Normalize transaction from any provider to UnifiedTransaction
   * Plugin-agnostic: Detects format by data structure
   */
  static normalize(transaction: any, sourcePlugin: string): UnifiedTransaction {
    // Detect format by structure, not plugin name

    // Stripe format: has 'paid' or uses cents (integer amounts)
    if (transaction.paid !== undefined || (transaction.created && typeof transaction.created === 'number')) {
      return this.normalizeStripe(transaction, sourcePlugin);
    }

    // PayPal format: has 'gross_amount' or 'payer' object
    if (transaction.gross_amount || transaction.payer?.email_address) {
      return this.normalizePayPal(transaction, sourcePlugin);
    }

    // Square format: has 'amount_money' object
    if (transaction.amount_money?.amount !== undefined) {
      return this.normalizeSquare(transaction, sourcePlugin);
    }

    // Generic fallback
    return this.normalizeGeneric(transaction, sourcePlugin);
  }

  /**
   * Normalize Stripe transaction
   */
  private static normalizeStripe(transaction: any, sourcePlugin: string): UnifiedTransaction {
    // Stripe uses cents, convert to dollars
    const amount = transaction.amount / 100;
    const fee = transaction.fee ? transaction.fee / 100 : undefined;
    const net = transaction.net ? transaction.net / 100 : undefined;

    // Map Stripe status to unified status
    let status: UnifiedTransaction['status'] = 'pending';
    if (transaction.status === 'succeeded' || transaction.paid) {
      status = 'completed';
    } else if (transaction.status === 'failed') {
      status = 'failed';
    } else if (transaction.refunded) {
      status = 'refunded';
    }

    return {
      id: transaction.id,
      amount,
      currency: (transaction.currency || 'USD').toUpperCase(),
      status,
      customer: {
        id: transaction.customer,
        email: transaction.receipt_email || transaction.billing_details?.email,
        name: transaction.billing_details?.name,
      },
      createdAt: new Date(transaction.created * 1000).toISOString(),
      completedAt: transaction.status === 'succeeded' ? new Date(transaction.created * 1000).toISOString() : undefined,
      description: transaction.description,
      paymentMethod: this.mapStripePaymentMethod(transaction.payment_method_details?.type),
      fee,
      net,
      _source: {
        plugin: sourcePlugin,
        originalId: transaction.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Map Stripe payment method to unified type
   */
  private static mapStripePaymentMethod(type: string | undefined): UnifiedTransaction['paymentMethod'] {
    if (!type) return undefined;
    if (type.includes('card')) return 'card';
    if (type.includes('bank') || type.includes('ach')) return 'bank_transfer';
    return undefined;
  }

  /**
   * Normalize PayPal transaction
   */
  private static normalizePayPal(transaction: any, sourcePlugin: string): UnifiedTransaction {
    const amount = parseFloat(transaction.gross_amount || transaction.amount?.value || 0);
    const fee = transaction.fee_amount ? parseFloat(transaction.fee_amount) : undefined;

    let status: UnifiedTransaction['status'] = 'pending';
    const statusLower = (transaction.status || '').toLowerCase();
    if (statusLower === 'completed' || statusLower === 'success') {
      status = 'completed';
    } else if (statusLower === 'failed' || statusLower === 'denied') {
      status = 'failed';
    } else if (statusLower === 'refunded') {
      status = 'refunded';
    }

    return {
      id: transaction.id || transaction.transaction_id,
      amount,
      currency: (transaction.currency_code || transaction.amount?.currency_code || 'USD').toUpperCase(),
      status,
      customer: {
        email: transaction.payer?.email_address || transaction.payer_email,
        name: transaction.payer?.name?.full_name || transaction.payer_name,
      },
      merchant: {
        email: transaction.payee?.email_address,
        name: transaction.payee?.merchant_id,
      },
      createdAt: transaction.create_time || transaction.time_created || new Date().toISOString(),
      completedAt: transaction.update_time || transaction.time_updated,
      description: transaction.description || transaction.item_details,
      paymentMethod: 'paypal',
      fee,
      net: fee ? amount - fee : undefined,
      _source: {
        plugin: sourcePlugin,
        originalId: transaction.id || transaction.transaction_id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Normalize Square transaction
   */
  private static normalizeSquare(transaction: any, sourcePlugin: string): UnifiedTransaction {
    // Square uses cents
    const amount = transaction.amount_money ? transaction.amount_money.amount / 100 : 0;
    const fee = transaction.processing_fee ? transaction.processing_fee[0]?.amount_money?.amount / 100 : undefined;

    let status: UnifiedTransaction['status'] = 'pending';
    const statusLower = (transaction.status || '').toLowerCase();
    if (statusLower === 'completed' || statusLower === 'approved') {
      status = 'completed';
    } else if (statusLower === 'failed' || statusLower === 'canceled') {
      status = 'failed';
    } else if (statusLower === 'refunded') {
      status = 'refunded';
    }

    return {
      id: transaction.id,
      amount,
      currency: (transaction.amount_money?.currency || 'USD').toUpperCase(),
      status,
      customer: {
        id: transaction.customer_id,
        email: transaction.receipt_email,
      },
      merchant: {
        id: transaction.location_id,
      },
      createdAt: transaction.created_at || new Date().toISOString(),
      completedAt: transaction.updated_at,
      description: transaction.note,
      paymentMethod: 'card',
      fee,
      net: fee ? amount - fee : undefined,
      _source: {
        plugin: sourcePlugin,
        originalId: transaction.id,
        normalizedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Generic normalization (fallback)
   */
  private static normalizeGeneric(transaction: any, sourcePlugin: string): UnifiedTransaction {
    const amount = parseFloat(transaction.amount || transaction.total || 0);

    let status: UnifiedTransaction['status'] = 'pending';
    const statusStr = String(transaction.status || '').toLowerCase();
    if (statusStr.includes('complet') || statusStr.includes('success') || statusStr.includes('paid')) {
      status = 'completed';
    } else if (statusStr.includes('fail') || statusStr.includes('cancel')) {
      status = 'failed';
    } else if (statusStr.includes('refund')) {
      status = 'refunded';
    }

    return {
      id: transaction.id || transaction.transaction_id || '',
      amount,
      currency: (transaction.currency || 'USD').toUpperCase(),
      status,
      customer: {
        id: transaction.customer_id || transaction.customerId,
        email: transaction.customer_email || transaction.email,
        name: transaction.customer_name || transaction.name,
      },
      createdAt: transaction.created_at || transaction.createdAt || transaction.date || new Date().toISOString(),
      completedAt: transaction.completed_at || transaction.completedAt,
      description: transaction.description || transaction.note,
      _source: {
        plugin: sourcePlugin,
        originalId: transaction.id || '',
        normalizedAt: new Date().toISOString(),
      },
    };
  }
}
