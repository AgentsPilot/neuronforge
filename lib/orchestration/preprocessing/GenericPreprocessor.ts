/**
 * GenericPreprocessor - Fallback preprocessor for unknown data types
 *
 * Phase 2: Preprocessing System
 * Provides basic preprocessing for unrecognized data structures
 */

import type { PreprocessingResult, PreprocessorConfig, ExtractedMetadata, PreprocessingOperation } from './types';

export class GenericPreprocessor {
  /**
   * Preprocess generic data
   */
  static async preprocess(
    data: any,
    config: Required<PreprocessorConfig>
  ): Promise<PreprocessingResult> {
    const operations: PreprocessingOperation[] = [];
    const warnings: string[] = [];

    // Ensure array
    const items = Array.isArray(data) ? data : [data];

    // Apply max items limit
    const limitedItems = items.slice(0, config.maxItems);
    if (items.length > config.maxItems) {
      warnings.push(`Truncated from ${items.length} to ${config.maxItems} items`);
    }

    // Basic cleaning if requested
    let cleanedItems = limitedItems;
    if (config.removeNoise) {
      cleanedItems = this.removeEmptyItems(limitedItems);
      operations.push({
        type: 'clean',
        target: 'items',
        description: 'Removed empty or invalid items',
        itemsAffected: limitedItems.length - cleanedItems.length,
      });
    }

    // Deduplicate if requested
    if (config.deduplicate) {
      const beforeCount = cleanedItems.length;
      cleanedItems = this.deduplicate(cleanedItems);
      operations.push({
        type: 'deduplicate',
        target: 'items',
        description: 'Removed duplicate items',
        itemsAffected: beforeCount - cleanedItems.length,
      });
    }

    // Extract metadata
    const metadata: ExtractedMetadata = {};
    if (config.extractMetadata) {
      metadata.dateRange = this.extractDateRange(cleanedItems);
      metadata.counts = { total: cleanedItems.length };
      metadata.statistics = this.extractStatistics(cleanedItems);

      operations.push({
        type: 'extract',
        target: 'metadata',
        description: 'Extracted generic metadata',
        itemsAffected: cleanedItems.length,
      });
    }

    return {
      cleanedInput: cleanedItems,
      metadata,
      operations,
      dataType: 'generic',
      success: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Remove empty or invalid items
   */
  private static removeEmptyItems(items: any[]): any[] {
    return items.filter(item => {
      // Remove null/undefined
      if (item === null || item === undefined) {
        return false;
      }

      // Remove empty objects
      if (typeof item === 'object' && Object.keys(item).length === 0) {
        return false;
      }

      // Remove empty strings
      if (typeof item === 'string' && item.trim() === '') {
        return false;
      }

      return true;
    });
  }

  /**
   * Deduplicate items by JSON stringification
   */
  private static deduplicate(items: any[]): any[] {
    const seen = new Set<string>();
    return items.filter(item => {
      try {
        const key = JSON.stringify(item);
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      } catch {
        // If can't stringify, keep the item
        return true;
      }
    });
  }

  /**
   * Extract date range from generic data
   * Searches for common date field names
   */
  private static extractDateRange(items: any[]): ExtractedMetadata['dateRange'] {
    const dateFields = [
      'date', 'createdAt', 'created_at', 'updatedAt', 'updated_at',
      'timestamp', 'time', 'datetime', 'startTime', 'start_time',
      'endTime', 'end_time', 'created', 'modified',
    ];

    const dates: Date[] = [];

    for (const item of items) {
      if (typeof item !== 'object') continue;

      for (const field of dateFields) {
        const value = item[field];
        if (value) {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            dates.push(date);
            break; // Only take first valid date per item
          }
        }
      }
    }

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
   * Extract statistical metadata from numeric and categorical fields
   */
  private static extractStatistics(items: any[]): ExtractedMetadata['statistics'] {
    if (items.length === 0 || typeof items[0] !== 'object') {
      return undefined;
    }

    const numericFields: Record<string, number[]> = {};
    const categoricalFields: Record<string, Record<string, number>> = {};

    // Collect all field values
    for (const item of items) {
      if (typeof item !== 'object') continue;

      for (const [key, value] of Object.entries(item)) {
        // Skip complex objects
        if (typeof value === 'object' && value !== null) continue;

        // Numeric field
        if (typeof value === 'number' && !isNaN(value)) {
          if (!numericFields[key]) {
            numericFields[key] = [];
          }
          numericFields[key].push(value);
        }

        // Categorical field
        if (typeof value === 'string' && value.length < 100) {
          if (!categoricalFields[key]) {
            categoricalFields[key] = {};
          }
          categoricalFields[key][value] = (categoricalFields[key][value] || 0) + 1;
        }
      }
    }

    // Calculate statistics for numeric fields
    const numericStats: Record<string, any> = {};
    for (const [field, values] of Object.entries(numericFields)) {
      if (values.length === 0) continue;

      const sum = values.reduce((a, b) => a + b, 0);
      const avg = sum / values.length;
      const min = Math.min(...values);
      const max = Math.max(...values);

      numericStats[field] = {
        sum: Math.round(sum * 100) / 100,
        avg: Math.round(avg * 100) / 100,
        min,
        max,
        count: values.length,
      };
    }

    // Only keep top 5 values for categorical fields
    const limitedCategoricalFields: Record<string, Record<string, number>> = {};
    for (const [field, valueCounts] of Object.entries(categoricalFields)) {
      const topValues = Object.entries(valueCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      limitedCategoricalFields[field] = Object.fromEntries(topValues);
    }

    if (Object.keys(numericStats).length === 0 && Object.keys(limitedCategoricalFields).length === 0) {
      return undefined;
    }

    return {
      numericFields: numericStats,
      categoricalFields: limitedCategoricalFields,
    };
  }
}
