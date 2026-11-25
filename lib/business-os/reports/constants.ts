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
  /* `#F79009` is the approved orders mockup's `--owed-fill` (artifact
     d394addc). The previous `#FB923C` was a lighter orange that sat closer to
     the sand now used for lost money; this is the shade the design paired with
     that sand and with `DANGER` below. Same hue family, same meaning. */
  WARNING: '#F79009',

  /** Purple accent color */
  ACCENT: '#8B5CF6',

  /** Muted grey for the unattributed revenue row */
  UNATTRIBUTED: '#94A3B8',

  /** Late — money being chased. Distinct from WARNING, which merely waits. */
  DANGER: '#F04438',

  /**
   * Asked for and never arriving: a stopped plan's periods, a voided invoice.
   *
   * Deliberately not red. It is not a failure to chase — the owner decided it —
   * and colouring it like an overdue invoice would put a permanent alarm beside
   * a closed decision.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE INTENT ABOVE IS UNCHANGED. THE VALUE DID NOT DELIVER IT.
   *
   * `#B54708` is a burnt orange-brown, and it sits in the same family as
   * `DANGER` (#F04438). At a figure's size that reads as a shade; on a 6px bar
   * segment or a status dot the two are the same mark, so "cancelled" and
   * "overdue" — a closed decision and an alarm — became indistinguishable
   * exactly where they are read fastest. Reported from the page, 2026-11-08.
   *
   * `#C9AC80` is the sand the approved orders mockup used for lost money
   * (`--lost-fill`, artifact d394addc, 2026-09-30), beside the SAME red
   * `#F04438` this palette already uses for late. Quiet, warm, and plainly not
   * an alarm — which is what the paragraph above asked for all along.
   *
   * It is light, so it works as a fill and not as small text on a pale ground.
   * `STATUS_INK.cancelled` already redirects the WORD to the neutral grey for
   * that reason, and that redirect now matters on light surfaces rather than
   * dark ones.
   * ───────────────────────────────────────────────────────────────────────────
   */
  LOST: '#C9AC80',

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
