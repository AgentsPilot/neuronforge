/**
 * Reports Dashboard Configuration Constants
 *
 * Centralizes all business logic thresholds and visual settings
 * for the cash flow dashboard to avoid hardcoded values.
 */

// Performance Thresholds
export const PERFORMANCE_THRESHOLDS = {
  /** Success rate threshold for "success" status (90%) */
  SUCCESS_RATE_GOOD: 0.9,

  /** Collection rate threshold for "success" status (80%) */
  COLLECTION_RATE_GOOD: 0.8,

  /** Refund rate threshold for "success" status (5%) */
  REFUND_RATE_GOOD: 0.05,

  /** Outstanding invoices count for "warning" status */
  OUTSTANDING_WARNING: 2,

  /** Outstanding invoices count for "success" status */
  OUTSTANDING_GOOD: 0,
} as const;

// Visual Design
export const REPORTS_COLORS = {
  /** Primary reports color - Green */
  PRIMARY: '#22C58B',

  /** Pending/Warning color - Orange */
  WARNING: '#FB923C',

  /** Purple accent color */
  ACCENT: '#8B5CF6',

  /** Muted grey for the unattributed revenue row */
  UNATTRIBUTED: '#94A3B8',

  /** Service revenue color palette (cycles through for multiple services) */
  SERVICE_PALETTE: [
    '#22C58B', // Green
    '#3B82F6', // Blue
    '#8B5CF6', // Purple
    '#F59E0B', // Amber
    '#EC4899', // Pink
    '#10B981'  // Emerald
  ],
} as const;

// Display Limits
export const DISPLAY_LIMITS = {
  /** Maximum number of services to show in revenue breakdown */
  MAX_SERVICES: 6,
} as const;

/**
 * The service_id the stats API uses for revenue that belongs to no service —
 * an ad-hoc invoice, a deposit, a payment taken outside the catalogue. Keeping
 * it as a row is what makes the breakdown add up to the revenue card above it.
 * Not a UUID, so it can never collide with a real service.
 */
export const UNATTRIBUTED_SERVICE_ID = 'unattributed';
