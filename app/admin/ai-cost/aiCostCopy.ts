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
