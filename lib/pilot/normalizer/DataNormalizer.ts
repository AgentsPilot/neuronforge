/**
 * DataNormalizer - Central dispatcher for data normalization
 *
 * Phase 1: Data Normalization Layer
 * Converts plugin-specific formats to unified types for cross-plugin operations
 */

import type { NormalizedDataType } from './types';
import { EmailNormalizer } from './EmailNormalizer';
import { TransactionNormalizer } from './TransactionNormalizer';
import { ContactNormalizer } from './ContactNormalizer';
import { EventNormalizer } from './EventNormalizer';

export class DataNormalizer {
  /**
   * Central normalization dispatcher
   */
  static normalize(data: any, sourcePlugin: string): any {
    const dataType = this.detectDataType(data, sourcePlugin);

    console.log(`[DataNormalizer] Normalizing ${dataType} data from ${sourcePlugin}`);

    switch (dataType) {
      case 'email':
        return EmailNormalizer.normalize(data, sourcePlugin);

      case 'transaction':
        return TransactionNormalizer.normalize(data, sourcePlugin);

      case 'contact':
        return ContactNormalizer.normalize(data, sourcePlugin);

      case 'event':
        return EventNormalizer.normalize(data, sourcePlugin);

      default:
        console.warn(`[DataNormalizer] Unknown data type for plugin: ${sourcePlugin}`);
        return data; // Return as-is if we can't normalize
    }
  }

  /**
   * Normalize array of items
   */
  static normalizeArray(data: any[], sourcePlugin: string): any[] {
    if (!Array.isArray(data)) {
      return [this.normalize(data, sourcePlugin)];
    }
    return data.map(item => this.normalize(item, sourcePlugin));
  }

  /**
   * Detect data type based on data shape (plugin-agnostic)
   * Uses structural analysis to identify data types regardless of source
   */
  private static detectDataType(data: any, sourcePlugin: string): NormalizedDataType {
    // Primary detection: Analyze data structure (plugin-agnostic)

    // Email detection: Has subject AND (from OR sender) fields
    if (data.subject && (data.from || data.sender || data.payload)) {
      return 'email';
    }

    // Transaction detection: Has amount AND currency fields
    if ((data.amount !== undefined || data.total !== undefined) && data.currency) {
      return 'transaction';
    }

    // Contact detection: Has email AND name-related fields
    if (data.email && (data.firstName || data.lastName || data.name || data.names)) {
      return 'contact';
    }

    // Event detection: Has time fields (startTime, start, or schedule-related)
    if (data.startTime || data.start?.dateTime || (data.start && data.end)) {
      return 'event';
    }

    // Secondary detection: Check nested structures (for arrays)
    if (Array.isArray(data) && data.length > 0) {
      return this.detectDataType(data[0], sourcePlugin);
    }

    // Fallback: Check for data wrapper patterns
    if (data.data && typeof data.data === 'object') {
      return this.detectDataType(data.data, sourcePlugin);
    }

    return 'unknown';
  }

  /**
   * Check if data is already normalized
   */
  static isNormalized(data: any): boolean {
    return data?._source?.normalizedAt !== undefined;
  }

  /**
   * Get source plugin from normalized data
   */
  static getSourcePlugin(data: any): string | null {
    return data?._source?.plugin || null;
  }
}
