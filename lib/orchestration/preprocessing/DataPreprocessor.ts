/**
 * DataPreprocessor - Central dispatcher for data preprocessing
 *
 * Phase 2: Preprocessing System
 * Coordinates preprocessing operations for all data types
 */

import type { PreprocessingResult, PreprocessorConfig } from './types';
import { EmailPreprocessor } from './EmailPreprocessor';
import { TransactionPreprocessor } from './TransactionPreprocessor';
import { ContactPreprocessor } from './ContactPreprocessor';
import { EventPreprocessor } from './EventPreprocessor';
import { GenericPreprocessor } from './GenericPreprocessor';

export class DataPreprocessor {
  /**
   * Preprocess data before LLM processing
   * Automatically detects data type and applies appropriate preprocessing
   */
  static async preprocess(
    data: any,
    config: PreprocessorConfig = {}
  ): Promise<PreprocessingResult> {
    // Set defaults
    const fullConfig: Required<PreprocessorConfig> = {
      removeNoise: config.removeNoise ?? true,
      extractMetadata: config.extractMetadata ?? true,
      normalizeData: config.normalizeData ?? true,
      deduplicate: config.deduplicate ?? false,
      maxItems: config.maxItems ?? 10000,
      customRules: config.customRules ?? [],
    };

    // Detect data type
    const dataType = this.detectDataType(data);

    console.log(`[DataPreprocessor] Detected data type: ${dataType}`);

    // Route to appropriate preprocessor
    try {
      let result: PreprocessingResult;

      switch (dataType) {
        case 'email':
          result = await EmailPreprocessor.preprocess(data, fullConfig);
          break;

        case 'transaction':
          result = await TransactionPreprocessor.preprocess(data, fullConfig);
          break;

        case 'contact':
          result = await ContactPreprocessor.preprocess(data, fullConfig);
          break;

        case 'event':
          result = await EventPreprocessor.preprocess(data, fullConfig);
          break;

        case 'generic':
        case 'unknown':
        default:
          result = await GenericPreprocessor.preprocess(data, fullConfig);
          break;
      }

      console.log(
        `[DataPreprocessor] Preprocessing complete: ${result.operations.length} operations, ` +
        `${result.warnings?.length || 0} warnings`
      );

      return result;
    } catch (error) {
      console.error('[DataPreprocessor] Preprocessing failed:', error);

      // Return minimal result on error
      return {
        cleanedInput: data,
        metadata: {},
        operations: [],
        dataType,
        success: false,
        warnings: [`Preprocessing failed: ${error}`],
      };
    }
  }

  /**
   * Preprocess array of items
   */
  static async preprocessArray(
    data: any[],
    config: PreprocessorConfig = {}
  ): Promise<PreprocessingResult> {
    if (!Array.isArray(data)) {
      return this.preprocess([data], config);
    }

    // Apply max items limit
    const maxItems = config.maxItems ?? 10000;
    const limitedData = data.slice(0, maxItems);

    if (data.length > maxItems) {
      console.warn(
        `[DataPreprocessor] Dataset truncated from ${data.length} to ${maxItems} items`
      );
    }

    return this.preprocess(limitedData, config);
  }

  /**
   * Detect data type based on structure (plugin-agnostic)
   */
  private static detectDataType(
    data: any
  ): 'email' | 'transaction' | 'contact' | 'event' | 'generic' | 'unknown' {
    // Handle array - detect from first item
    if (Array.isArray(data)) {
      if (data.length === 0) return 'unknown';
      return this.detectDataType(data[0]);
    }

    if (!data || typeof data !== 'object') {
      return 'unknown';
    }

    // Email detection: Has subject AND (from OR sender OR payload)
    if (data.subject && (data.from || data.sender || data.payload)) {
      return 'email';
    }

    // Transaction detection: Has amount AND (currency OR status indicating payment)
    if (
      (data.amount !== undefined || data.total !== undefined) &&
      (data.currency || data.status || data.paid !== undefined)
    ) {
      return 'transaction';
    }

    // Contact detection: Has email AND name-related fields
    if (
      data.email &&
      (data.firstName || data.lastName || data.name || data.names || data.properties)
    ) {
      return 'contact';
    }

    // Event detection: Has time fields (startTime, start, or schedule-related)
    if (
      data.startTime ||
      data.start?.dateTime ||
      (data.start && data.end) ||
      data.summary
    ) {
      return 'event';
    }

    // Check for nested data wrapper
    if (data.data && typeof data.data === 'object') {
      return this.detectDataType(data.data);
    }

    // Generic structured data
    if (Object.keys(data).length > 0) {
      return 'generic';
    }

    return 'unknown';
  }

  /**
   * Format metadata facts for LLM injection
   * Converts extracted metadata into natural language facts
   */
  static formatMetadataFacts(metadata: PreprocessingResult['metadata']): string {
    const facts: string[] = [];

    // Date range
    if (metadata.dateRange) {
      facts.push(`Date range: ${metadata.dateRange.formattedRange}`);
      facts.push(`Items with dates: ${metadata.dateRange.count}`);
    }

    // Counts
    if (metadata.counts) {
      facts.push(`Total items: ${metadata.counts.total}`);

      if (metadata.counts.byType) {
        const typeBreakdown = Object.entries(metadata.counts.byType)
          .map(([type, count]) => `${type}: ${count}`)
          .join(', ');
        facts.push(`Breakdown by type: ${typeBreakdown}`);
      }

      if (metadata.counts.unread !== undefined) {
        facts.push(`Unread items: ${metadata.counts.unread}`);
      }
    }

    // Email-specific
    if (metadata.email) {
      facts.push(`Total emails: ${metadata.counts?.total || 0}`);
      facts.push(`Unique senders: ${metadata.email.senders.length}`);
      facts.push(`Total attachments: ${metadata.email.totalAttachments}`);

      if (metadata.email.senders.length > 0) {
        const topSenders = metadata.email.senders
          .slice(0, 3)
          .map(s => `${s.name || s.email} (${s.count})`)
          .join(', ');
        facts.push(`Top senders: ${topSenders}`);
      }
    }

    // Transaction-specific
    if (metadata.transaction) {
      facts.push(`Total amount: ${metadata.transaction.totalAmount} ${metadata.transaction.currency}`);
      facts.push(`Average amount: ${metadata.transaction.averageAmount.toFixed(2)} ${metadata.transaction.currency}`);
      facts.push(`Range: ${metadata.transaction.minAmount} - ${metadata.transaction.maxAmount}`);

      if (metadata.transaction.netAmount !== undefined) {
        facts.push(`Net amount (after fees): ${metadata.transaction.netAmount} ${metadata.transaction.currency}`);
      }
    }

    // Contact-specific
    if (metadata.contact) {
      facts.push(`Total contacts: ${metadata.contact.totalContacts}`);
      facts.push(`With email: ${metadata.contact.withEmail}`);
      facts.push(`With phone: ${metadata.contact.withPhone}`);

      if (metadata.contact.topCompanies.length > 0) {
        const topCompanies = metadata.contact.topCompanies
          .slice(0, 3)
          .map(c => `${c.company} (${c.count})`)
          .join(', ');
        facts.push(`Top companies: ${topCompanies}`);
      }
    }

    // Event-specific
    if (metadata.event) {
      facts.push(`Total events: ${metadata.event.totalEvents}`);
      facts.push(`Upcoming: ${metadata.event.upcomingEvents}, Past: ${metadata.event.pastEvents}`);
      facts.push(`Average duration: ${metadata.event.avgDuration} minutes`);

      if (metadata.event.recurringEvents > 0) {
        facts.push(`Recurring events: ${metadata.event.recurringEvents}`);
      }
    }

    if (facts.length === 0) {
      return '';
    }

    return '\n\n--- VERIFIED FACTS (use these exact values) ---\n' +
           facts.map(f => `• ${f}`).join('\n') +
           '\n--- END FACTS ---\n\n';
  }
}
