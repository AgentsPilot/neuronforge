/**
 * The AI cost page's own words (Money MK-3, KPI restructure review §4 and
 * §14 point 5): its title, its purpose line and the fixed two-line legend.
 * The strip's and the sections' words stay with the report's components, in
 * `app/admin/business-os-llm/costCopy.ts` and `leakCopy.ts`.
 *
 * Names are AI-specific (FC-1, FC-9): the page says "AI cost", never just
 * "Cost", "Expenses" or "OPEX".
 */

/** The page's h1, equal to its sidebar label (LAY D-3 (a)); Q-9 / Q-14 keep "AI cost". */
export const AI_COST_TITLE = 'AI cost';

/** §14 point 5: the purpose line, with "usage" so it grows into later cost lines. */
export const AI_COST_PURPOSE = 'What AI usage costs us, did we charge for it, and is the charging correct?';

/** §4: one vocabulary, shown as a fixed two-line legend at the top of the page. The two are never added. */
export const AI_COST_LEGEND = {
  charged: {
    term: 'Charged AI cost:',
    text: 'what Business OS AI actions cost us that we billed to a customer in credits (the credit ledger, from 29 Sep 2026). This is the business figure.',
  },
  recorded: {
    term: 'Recorded AI cost:',
    text: 'every AI call the system logged, charged or not, both products (the usage log). This is the operations figure. The two are never added.',
  },
} as const;

// ── Money MK-3b: the two tabs and the strip's notes ──────────────────────────

/** The tab list's name, and its two tabs, exactly these words (SA-CR-MK3A: they match Finance's link). */
export const AI_COST_TABS_LABEL = 'AI cost views';
export const AI_COST_TAB_CHECKS = 'Summary & checks';
export const AI_COST_TAB_CALLS = 'Calls';

/**
 * SA-Q-MK3-3: a linked window (exact instants, from the Health tile) is exact on
 * the Calls tab; the strip and Summary & checks read the whole UTC days that
 * cover it, and say so.
 */
export const aiCostCoveringDaysLine = (from: string, to: string) =>
  `Strip and Summary & checks: ${from} to ${to}, whole UTC days covering the linked window`;

/** SA-Q-MK3-4: `system` is a Calls drill value; the strip has no such business and reads every business. */
export const AI_COST_SYSTEM_STRIP_NOTE = 'Strip: all businesses (system calls belong to no business)';
