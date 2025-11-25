/**
 * Preprocessing Types - Type definitions for data preprocessing
 *
 * Phase 2: Preprocessing System
 * Used by all handlers to extract deterministic metadata before LLM processing
 */

export interface PreprocessingResult {
  /**
   * Original input data (potentially cleaned/normalized)
   */
  cleanedInput: any;

  /**
   * Extracted metadata facts
   */
  metadata: ExtractedMetadata;

  /**
   * Preprocessing operations applied
   */
  operations: PreprocessingOperation[];

  /**
   * Data type detected
   */
  dataType: 'email' | 'transaction' | 'contact' | 'event' | 'generic' | 'unknown';

  /**
   * Whether preprocessing was successful
   */
  success: boolean;

  /**
   * Warnings during preprocessing
   */
  warnings?: string[];
}

export interface ExtractedMetadata {
  /**
   * Date range information
   */
  dateRange?: {
    earliest: string; // ISO 8601
    latest: string; // ISO 8601
    formattedRange: string; // Human-readable
    count: number; // Number of items with dates
  };

  /**
   * Count information
   */
  counts?: {
    total: number;
    byType?: Record<string, number>;
    withAttachments?: number;
    unread?: number;
  };

  /**
   * Email-specific metadata
   */
  email?: {
    senders: Array<{ email: string; name?: string; count: number }>;
    recipients: Array<{ email: string; name?: string; count: number }>;
    hasAttachments: boolean;
    totalAttachments: number;
    threads: number;
    avgBodyLength: number;
  };

  /**
   * Transaction-specific metadata
   */
  transaction?: {
    totalAmount: number;
    currency: string;
    averageAmount: number;
    minAmount: number;
    maxAmount: number;
    byStatus: Record<string, number>;
    byPaymentMethod: Record<string, number>;
    totalFees?: number;
    netAmount?: number;
  };

  /**
   * Contact-specific metadata
   */
  contact?: {
    totalContacts: number;
    withEmail: number;
    withPhone: number;
    withCompany: number;
    topCompanies: Array<{ company: string; count: number }>;
    byTag: Record<string, number>;
  };

  /**
   * Event-specific metadata
   */
  event?: {
    totalEvents: number;
    upcomingEvents: number;
    pastEvents: number;
    allDayEvents: number;
    withAttendees: number;
    avgDuration: number; // minutes
    byOrganizer: Record<string, number>;
    recurringEvents: number;
  };

  /**
   * Statistical information (generic)
   */
  statistics?: {
    numericFields: Record<string, {
      sum: number;
      avg: number;
      min: number;
      max: number;
      count: number;
    }>;
    categoricalFields: Record<string, Record<string, number>>;
  };
}

export interface PreprocessingOperation {
  /**
   * Type of operation performed
   */
  type: 'clean' | 'normalize' | 'extract' | 'deduplicate' | 'filter' | 'enrich';

  /**
   * Field or data affected
   */
  target: string;

  /**
   * Description of operation
   */
  description: string;

  /**
   * Number of items affected
   */
  itemsAffected: number;
}

export interface PreprocessorConfig {
  /**
   * Whether to remove noise (signatures, disclaimers, etc.)
   */
  removeNoise?: boolean;

  /**
   * Whether to extract metadata
   */
  extractMetadata?: boolean;

  /**
   * Whether to normalize data structures
   */
  normalizeData?: boolean;

  /**
   * Whether to deduplicate items
   */
  deduplicate?: boolean;

  /**
   * Maximum items to process (for large datasets)
   */
  maxItems?: number;

  /**
   * Custom extraction rules
   */
  customRules?: Array<{
    field: string;
    extractor: (value: any) => any;
  }>;
}
