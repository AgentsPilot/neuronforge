/**
 * One colour for money that went back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS REPLACES
 *
 * A refund looked different on every screen it appeared on, because four files
 * each decided for themselves:
 *
 *     contact drawer card        orange
 *     invoice list               orange, with its own shade of it
 *     transactions list          grey
 *     manage payment dialog      slate
 *
 * Same event, four answers, so an owner moving between the money list, the
 * invoice list and a contact could not learn what the colour meant. Each file
 * also carried a comment arguing for its own choice, which is how four
 * reasonable decisions add up to an unreadable product.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RULE
 *
 * FULL refund is RED. Everything was returned: the sale is reversed, nothing
 * was kept, and it must be impossible to mistake for a completed one.
 *
 * PARTIAL refund is AMBER. The business is still holding money and the job may
 * still be live — a different fact, and it would be wrong to dress it as the
 * same one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS DELIBERATELY DOES NOT APPLY: THE JOURNEY RAIL
 *
 * The node beside a step is a SEVERITY channel, not an event log. Red there
 * already means overdue money, a declined card, a bounced email, a cancelled
 * booking or a dead quote — five things the owner must act on. A completed
 * refund is the opposite: closed, nothing owed, nothing to chase. Putting it in
 * red would cost red its meaning across the whole drawer to gain one node.
 *
 * So the rail marks a refund slate and changes its GLYPH instead, and the rule
 * worth remembering is:
 *
 *     THE RAIL SAYS WHAT NEEDS DOING. THE CARD SAYS WHAT HAPPENED.
 *
 * @module components/payments/refundTone
 */

/** Inline styles, for the surfaces that compose colours as values. */
export const REFUND_HEX = {
  /** Everything came back. */
  full: '#F04438',
  /** Some came back; the rest stayed. */
  partial: '#F79009',
} as const;

/**
 * Tailwind pairs, for the surfaces that compose colours as classes.
 *
 * `text` and `bg` are given separately rather than as one string because the
 * call sites need them apart — a chip takes both, a line of text takes one.
 */
export const REFUND_CLASS = {
  full: {
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
    /** The heavier surface the invoice list's cards use. */
    panel: 'bg-red-50 dark:bg-red-900/20',
    panelText: 'text-red-700 dark:text-red-300',
    border: 'border-red-200 dark:border-red-800',
    dot: 'bg-red-500',
  },
  partial: {
    text: 'text-orange-600 dark:text-orange-400',
    bg: 'bg-orange-500/10',
    panel: 'bg-orange-50 dark:bg-orange-900/20',
    panelText: 'text-orange-700 dark:text-orange-300',
    border: 'border-orange-200 dark:border-orange-800',
    dot: 'bg-orange-500',
  },
} as const;

/**
 * Which of the two a given refund is.
 *
 * Takes the figures rather than a status, because the status cannot answer it:
 * a partial refund deliberately leaves an invoice reading `paid`, and a refund
 * can land on one that was never marked paid at all.
 *
 * A zero or missing total resolves to `partial` — the quieter of the two. With
 * no amount to compare against there is no evidence everything came back, and
 * overstating that is the error worth avoiding.
 */
export function refundExtent(
  refunded: number | null | undefined,
  total: number | null | undefined
): 'full' | 'partial' {
  const back = Number(refunded ?? 0);
  const whole = Number(total ?? 0);

  return whole > 0 && back >= whole ? 'full' : 'partial';
}
