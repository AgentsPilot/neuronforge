/**
 * TransactionPreprocessor - Preprocess transaction data
 *
 * Phase 2: Preprocessing System
 * Extracts financial metadata, normalizes currencies, validates amounts
 */

import type { PreprocessingResult, PreprocessorConfig, ExtractedMetadata, PreprocessingOperation } from './types';

export class TransactionPreprocessor {
  /**
   * Preprocess transaction data
   */
  static async preprocess(
    data: any,
    config: Required<PreprocessorConfig>
  ): Promise<PreprocessingResult> {
    const operations: PreprocessingOperation[] = [];
    const warnings: string[] = [];

    // Ensure array
    const transactions = Array.isArray(data) ? data : [data];

    // Apply max items limit
    const limitedTransactions = transactions.slice(0, config.maxItems);
    if (transactions.length > config.maxItems) {
      warnings.push(`Truncated from ${transactions.length} to ${config.maxItems} transactions`);
    }

    // Normalize structures if requested
    let cleanedTransactions = limitedTransactions;
    if (config.normalizeData) {
      cleanedTransactions = this.normalizeStructures(limitedTransactions);
      operations.push({
        type: 'normalize',
        target: 'structure',
        description: 'Normalized transaction field structures',
        itemsAffected: cleanedTransactions.length,
      });
    }

    // Validate and clean amounts
    if (config.removeNoise) {
      const beforeCount = cleanedTransactions.length;
      cleanedTransactions = this.validateAmounts(cleanedTransactions, warnings);
      const invalidCount = beforeCount - cleanedTransactions.length;
      if (invalidCount > 0) {
        operations.push({
          type: 'filter',
          target: 'amount',
          description: 'Removed transactions with invalid amounts',
          itemsAffected: invalidCount,
        });
      }
    }

    // Deduplicate if requested
    if (config.deduplicate) {
      const beforeCount = cleanedTransactions.length;
      cleanedTransactions = this.deduplicate(cleanedTransactions);
      operations.push({
        type: 'deduplicate',
        target: 'transactions',
        description: 'Removed duplicate transactions',
        itemsAffected: beforeCount - cleanedTransactions.length,
      });
    }

    // Extract metadata
    const metadata: ExtractedMetadata = {};
    if (config.extractMetadata) {
      metadata.dateRange = this.extractDateRange(cleanedTransactions);
      metadata.counts = this.extractCounts(cleanedTransactions);
      metadata.transaction = this.extractTransactionMetadata(cleanedTransactions);

      operations.push({
        type: 'extract',
        target: 'metadata',
        description: 'Extracted transaction metadata',
        itemsAffected: cleanedTransactions.length,
      });
    }

    return {
      cleanedInput: cleanedTransactions,
      metadata,
      operations,
      dataType: 'transaction',
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Normalize transaction structures to consistent format
   */
  private static normalizeStructures(transactions: any[]): any[] {
    return transactions.map(txn => {
      // Parse amount (handle cents vs dollars)
      let amount = txn.amount || txn.total || 0;
      if (typeof amount === 'object' && amount.value !== undefined) {
        amount = amount.value; // PayPal format
      }
      if (txn.paid !== undefined && typeof txn.created === 'number') {
        // Stripe format: amounts in cents
        amount = amount / 100;
      }

      // Parse currency
      let currency = txn.currency || 'USD';
      if (typeof currency === 'object' && currency.code) {
        currency = currency.code; // Some APIs use nested format
      }
      currency = currency.toUpperCase();

      // Parse status
      let status = txn.status || 'pending';
      if (typeof status === 'string') {
        status = status.toLowerCase();
        if (status.includes('success') || status.includes('complet') || txn.paid === true) {
          status = 'completed';
        } else if (status.includes('fail') || status.includes('cancel')) {
          status = 'failed';
        } else if (status.includes('refund')) {
          status = 'refunded';
        } else if (status.includes('pend')) {
          status = 'pending';
        }
      }

      return {
        id: txn.id || txn.transaction_id || txn.transactionId,
        amount,
        currency,
        status,
        customer: {
          id: txn.customer || txn.customer_id || txn.customerId,
          email: txn.customer_email || txn.email || txn.receipt_email,
          name: txn.customer_name || txn.name,
        },
        merchant: txn.merchant || txn.payee,
        createdAt: txn.createdAt || txn.created_at || txn.create_time || new Date().toISOString(),
        completedAt: txn.completedAt || txn.completed_at || txn.update_time,
        description: txn.description || txn.note || txn.item_details,
        paymentMethod: txn.paymentMethod || txn.payment_method || txn.type,
        fee: txn.fee || txn.fee_amount,
        net: txn.net || txn.net_amount,
      };
    });
  }

  /**
   * Validate amounts and filter invalid transactions
   */
  private static validateAmounts(transactions: any[], warnings: string[]): any[] {
    return transactions.filter(txn => {
      // Check for valid amount
      if (txn.amount === undefined || txn.amount === null) {
        warnings.push(`Transaction ${txn.id || 'unknown'} has no amount`);
        return false;
      }

      const amount = parseFloat(txn.amount);
      if (isNaN(amount)) {
        warnings.push(`Transaction ${txn.id || 'unknown'} has invalid amount: ${txn.amount}`);
        return false;
      }

      if (amount < 0) {
        warnings.push(`Transaction ${txn.id || 'unknown'} has negative amount: ${amount}`);
        return false;
      }

      return true;
    });
  }

  /**
   * Deduplicate transactions by ID
   */
  private static deduplicate(transactions: any[]): any[] {
    const seen = new Set<string>();
    return transactions.filter(txn => {
      const key = txn.id || `${txn.amount}:${txn.createdAt}:${txn.customer?.email}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }

  /**
   * Extract date range from transactions
   */
  private static extractDateRange(transactions: any[]): ExtractedMetadata['dateRange'] {
    const dates = transactions
      .map(t => t.createdAt)
      .filter(d => d)
      .map(d => new Date(d))
      .filter(d => !isNaN(d.getTime()));

    if (dates.length === 0) {
      return undefined;
    }

    const earliest = new Date(Math.min(...dates.map(d => d.getTime())));
    const latest = new Date(Math.max(...dates.map(d => d.getTime())));

    return {
      earliest: earliest.toISOString(),
      latest: latest.toISOString(),
      formattedRange: this.formatDateRange(earliest, latest),
      count: dates.length,
    };
  }

  /**
   * Format date range as human-readable string
   */
  private static formatDateRange(earliest: Date, latest: Date): string {
    const options: Intl.DateTimeFormatOptions = {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    };

    const earliestStr = earliest.toLocaleDateString('en-US', options);
    const latestStr = latest.toLocaleDateString('en-US', options);

    if (earliestStr === latestStr) {
      return earliestStr;
    }

    if (earliest.getFullYear() === latest.getFullYear()) {
      const earliestShort = earliest.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      return `${earliestShort} - ${latestStr}`;
    }

    return `${earliestStr} - ${latestStr}`;
  }

  /**
   * Extract count metadata
   */
  private static extractCounts(transactions: any[]): ExtractedMetadata['counts'] {
    const byType: Record<string, number> = {};

    for (const txn of transactions) {
      const status = txn.status || 'unknown';
      byType[status] = (byType[status] || 0) + 1;
    }

    return {
      total: transactions.length,
      byType,
    };
  }

  /**
   * Extract transaction-specific metadata
   */
  private static extractTransactionMetadata(transactions: any[]): ExtractedMetadata['transaction'] {
    const amounts = transactions.map(t => parseFloat(t.amount)).filter(a => !isNaN(a));
    const currencies = new Set(transactions.map(t => t.currency).filter(c => c));

    if (amounts.length === 0) {
      return undefined;
    }

    // Get primary currency (most common)
    const currencyCount = new Map<string, number>();
    for (const txn of transactions) {
      if (txn.currency) {
        currencyCount.set(txn.currency, (currencyCount.get(txn.currency) || 0) + 1);
      }
    }
    const primaryCurrency = Array.from(currencyCount.entries())
      .sort((a, b) => b[1] - a[1])[0]?.[0] || 'USD';

    // Calculate totals for primary currency only
    const primaryCurrencyAmounts = transactions
      .filter(t => t.currency === primaryCurrency)
      .map(t => parseFloat(t.amount))
      .filter(a => !isNaN(a));

    const totalAmount = primaryCurrencyAmounts.reduce((sum, a) => sum + a, 0);
    const averageAmount = totalAmount / primaryCurrencyAmounts.length;
    const minAmount = Math.min(...primaryCurrencyAmounts);
    const maxAmount = Math.max(...primaryCurrencyAmounts);

    // Count by status
    const byStatus: Record<string, number> = {};
    for (const txn of transactions) {
      const status = txn.status || 'unknown';
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    // Count by payment method
    const byPaymentMethod: Record<string, number> = {};
    for (const txn of transactions) {
      if (txn.paymentMethod) {
        byPaymentMethod[txn.paymentMethod] = (byPaymentMethod[txn.paymentMethod] || 0) + 1;
      }
    }

    // Calculate fees and net if available
    const fees = transactions
      .map(t => parseFloat(t.fee))
      .filter(f => !isNaN(f));
    const totalFees = fees.length > 0 ? fees.reduce((sum, f) => sum + f, 0) : undefined;
    const netAmount = totalFees !== undefined ? totalAmount - totalFees : undefined;

    return {
      totalAmount: Math.round(totalAmount * 100) / 100,
      currency: primaryCurrency,
      averageAmount: Math.round(averageAmount * 100) / 100,
      minAmount: Math.round(minAmount * 100) / 100,
      maxAmount: Math.round(maxAmount * 100) / 100,
      byStatus,
      byPaymentMethod,
      totalFees: totalFees !== undefined ? Math.round(totalFees * 100) / 100 : undefined,
      netAmount: netAmount !== undefined ? Math.round(netAmount * 100) / 100 : undefined,
    };
  }
}
