/**
 * One colour per money state, for every surface that shows one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUR PALETTES DESCRIBED THE SAME FACT, AND THEY DISAGREED.
 *
 * The summary strip and the cashflow bar colour money from `REPORTS_COLORS`.
 * The orders row's status chip had its own Tailwind palette, the plan schedule
 * under it had a third, and the detail drawer a fourth. An order awaiting
 * payment therefore drew an ORANGE bar beside a BLUE chip, with the same state
 * AMBER in the schedule below it, and clicking the row opened a drawer that
 * said blue again.
 *
 * The strip is also the filter: clicking its orange "due" cell returned rows
 * badged blue, which defeats the one thing a coloured filter is for.
 *
 * So the colour of a money state is decided here, once, and every surface reads
 * it. `WARNING` is money merely waiting and `DANGER` is money being chased —
 * the distinction `REPORTS_COLORS` documents — and returned money takes the
 * same grey the strip's "returned to clients" cell uses.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/payments/moneyStatusTone
 */

import { REPORTS_COLORS } from '@/lib/business-os/reports/constants';
import type { MoneyStatus } from '@/lib/payments/moneyItems';

/** The state's colour: its dot, its bar segment, its chip ground. */
export const STATUS_TONE: Record<MoneyStatus, string> = {
  paid: REPORTS_COLORS.PRIMARY,
  awaiting_payment: REPORTS_COLORS.WARNING,
  overdue: REPORTS_COLORS.DANGER,
  failed: REPORTS_COLORS.DANGER,
  // Both refund states take the colour the strip gives returned money. They are
  // deliberate completed acts, not failures, which is why neither is red.
  refunded: REPORTS_COLORS.UNATTRIBUTED,
  partially_refunded: REPORTS_COLORS.UNATTRIBUTED,
  cancelled: REPORTS_COLORS.LOST,
  // Nothing has been asked for yet, so this is not money waiting. Grey rather
  // than a colour that implies a debt.
  draft: REPORTS_COLORS.UNATTRIBUTED,
};

/**
 * Where the tone cannot also be the ink.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REASON INVERTED; THE ANSWER DID NOT.
 *
 * `LOST` used to be a dark brown: right as a dot, unreadable as small text on a
 * DARK surface. It is now the mockup's light sand, which reads well on dark and
 * washes out on a PALE one. Either way it cannot be both the area and the word,
 * so cancelled keeps the palette colour on its dot and ground and borrows the
 * neutral grey for the word itself.
 *
 * The mockup solves this with a per-theme ink (`--lost` is #7A5A2E on light and
 * the sand itself on dark). That pairing is not reproduced here on purpose:
 * these are plain values shared by surfaces that do not all know the theme, and
 * a single neutral is honest in both. Introducing theme-aware inks is a real
 * improvement and a larger change than a palette fix.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const STATUS_INK: Partial<Record<MoneyStatus, string>> = {
  cancelled: REPORTS_COLORS.UNATTRIBUTED,
};

/**
 * The colour for one row of a SCHEDULE — a plan's periods, or the payments
 * listed under an order.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Two states answer differently here than they do on a chip, and both are about
 * what a reader is asking of a list:
 *
 *   partially_refunded  is still a collection. The business kept some of it and
 *                       the figure beside it is real, so in a schedule it reads
 *                       as collected. A CHIP answering "was any of this
 *                       returned" correctly greys it instead.
 *   not_billed          is a milestone nobody has been asked for yet. It is not
 *                       a money status at all, so it has no entry above.
 *
 * Shared because the order drawer and the list's own expansion draw the same
 * schedule, and a period must not change colour between them — the fault this
 * module exists to prevent, found again 2026-11-08 when the list coloured its
 * rows by nothing at all while the drawer coloured its dots correctly.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function scheduleTone(status: string): string {
  if (status === 'partially_refunded') return REPORTS_COLORS.PRIMARY;
  if (status === 'not_billed') return REPORTS_COLORS.WARNING;
  return STATUS_TONE[status as MoneyStatus] ?? REPORTS_COLORS.UNATTRIBUTED;
}

/** The pill's ground: the state's own colour, faint enough to sit under text. */
export const chipGround = (tone: string): string => `${tone}1F`;

/**
 * Everything a chip needs for one state.
 *
 * An unknown status resolves to the neutral grey rather than to nothing: a chip
 * with no colour at all reads as a rendering fault, and new states are added to
 * `MoneyStatus` from time to time.
 */
export function statusChipStyle(status: MoneyStatus): { color: string; background: string } {
  const tone = STATUS_TONE[status] ?? REPORTS_COLORS.UNATTRIBUTED;
  return { color: STATUS_INK[status] ?? tone, background: chipGround(tone) };
}
