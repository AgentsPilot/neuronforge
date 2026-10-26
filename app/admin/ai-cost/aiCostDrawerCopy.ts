/**
 * The AI cost drawers' own words (Money MK-8b; KPI restructure review §4.2,
 * Q-7). Figures keep the page's labels ("Charged AI cost", "Recorded AI
 * cost"), which live in `app/admin/business-os-llm/costCopy.ts` with the strip.
 */

export const AI_COST_DRAWER = {
  /** What a drawer read is, for the shared fallback "Could not read {what}." */
  what: "this business's AI cost",
  /** The row opener's name and tooltip, the Businesses page's words (D-2, MK-10). */
  openDetails: (name: string) => `Open details for ${name}`,
  openPeriodDetails: (name: string, day: string) => `Open details for ${name}, period from ${day}`,
  /** A business whose name could not be read: the short id after this word. */
  titleFallback: 'Business',
  periodTitleSuffix: (day: string) => `period from ${day}`,
  windowSection: 'AI cost in this window',
  windowLine: (from: string, to: string) => `${from} to ${to} (UTC)`,
  creditsCharged: 'Credits charged',
  charges: 'Charges',
  credits: (value: string) => `${value} credits`,
  periodsSection: 'Billing periods',
  periodsNone: 'No billing period touches this window.',
  noTotalsRow: 'no totals row for this period',
  leakSection: 'Leak check',
  periodSection: 'This billing period',
  periodNotInWindow: 'This period is not in the window any more. Close the drawer and open the row again.',
  businessSection: 'This business in the window',
  columnFigure: 'Figure',
  columnStored: 'Stored',
  columnRebuilt: 'Rebuilt from rows',
  differs: 'differs',
  rowsNotRead: 'not checked: the ledger rows could not be read',
  openFull: 'Open full view',
  /** The stored and rebuilt figures, in the period table's order. */
  figures: {
    creditsTotal: 'Credits',
    creditsOwner: 'Owner',
    creditsScheduled: 'Scheduled',
    creditsExternal: 'External',
    creditsAdjustment: 'Corrections',
    costUsd: 'Cost',
    charges: 'Charges',
    fallbackPriced: 'Fallback-priced',
  },
} as const;
