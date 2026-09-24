/**
 * The Fix button for a journey gap: which settings tab it opens, and what it
 * says on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT IN `journeyReadiness.ts`
 *
 * It was, and that broke every page that rendered a gap.
 *
 * `journeyReadiness` imports `supabaseServer` at module level, which calls
 * `createClient` with the SERVICE ROLE key as soon as the module is evaluated.
 * That key is not `NEXT_PUBLIC_`, so in a browser it is `undefined` and the
 * call throws `supabaseKey is required` — as an unhandled runtime error, on
 * three client components that only wanted a string and a tab name.
 *
 * Importing one pure function from a module is importing the whole module.
 * A mapping with no I/O in it belongs where a client component can reach it.
 *
 * The type comes back across as `import type`, which the compiler erases — no
 * runtime edge to `journeyReadiness` survives the build.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THE TAB AND THE LABEL TRAVEL TOGETHER
 *
 * Because they have to agree. Four separate files each wrote
 * `isInvoicing ? 'invoice' : 'availability'`, which was true while two kinds
 * blocked. A third made all four wrong at once: a `timezone` gap opened the
 * availability tab — hours, no timezone picker — under a button reading "Set
 * your working hours". The tab and the sentence pointing at different things is
 * worse than either being wrong alone, because the owner arrives somewhere the
 * message cannot be acted on and concludes the product is broken.
 */

import type { JourneyGapKind } from '@/lib/business-os/journeyReadiness';

/** A tab of the Business OS configuration dialog. */
export type GapFixTab = 'availability' | 'business' | 'payments' | 'invoice';

export interface GapFix {
  tab: GapFixTab;
  /** Translation key, looked up first. */
  key: string;
  /** English shown when no translation exists for the active language. */
  fallback: string;
}

export function gapFixAction(kind: JourneyGapKind): GapFix {
  switch (kind) {
    case 'hours':
      return { tab: 'availability', key: 'gap.fix.availability', fallback: 'Set your working hours' };

    // The timezone lives with the business's own details, not with the hours it
    // qualifies — which is the whole reason this mapping exists.
    case 'timezone':
      return { tab: 'business', key: 'gap.fix.timezone', fallback: 'Set your timezone' };

    case 'processor':
      return { tab: 'payments', key: 'gap.fix.processor', fallback: 'Connect payments' };

    case 'invoicing':
      return { tab: 'invoice', key: 'gap.fix.invoicing', fallback: 'Complete invoice details' };
  }
}
