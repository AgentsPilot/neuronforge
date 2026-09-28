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

interface GapFixLabel {
  /** Translation key, looked up first. */
  key: string;
  /** English shown when no translation exists for the active language. */
  fallback: string;
}

/**
 * Where a Fix button goes.
 *
 * Two shapes, because not every gap is cleared in the configuration dialog.
 * The timezone is the one that is not, and modelling it as a dialog tab is
 * exactly how it came to point at a tab with no timezone control on it.
 */
export type GapFix =
  | ({ target: 'dialog'; tab: GapFixTab } & GapFixLabel)
  | ({ target: 'route'; href: string } & GapFixLabel);

export function gapFixAction(kind: JourneyGapKind): GapFix {
  switch (kind) {
    case 'hours':
      return { target: 'dialog', tab: 'availability', key: 'gap.fix.availability', fallback: 'Set your working hours' };

    /*
     * The timezone is NOT in the configuration dialog.
     *
     * It is stored on `user_preferences`, and the only control that writes it
     * is the picker on the Business OS settings page. This pointed at the
     * dialog's `business` tab, which renders `BusinessProfileSection` — a
     * component with no timezone field anywhere in it. So the one gap that
     * blocks publishing a booking surface sent the owner to a form that could
     * not clear it, under a button reading "Set your timezone".
     *
     * That is the same failure this whole module was written to prevent, in
     * the one case the dialog cannot serve: the destination has to be a route.
     */
    case 'timezone':
      return {
        target: 'route',
        href: '/business-os/settings?section=timezone',
        key: 'gap.fix.timezone',
        fallback: 'Set your timezone',
      };

    case 'processor':
      return { target: 'dialog', tab: 'payments', key: 'gap.fix.processor', fallback: 'Connect payments' };

    case 'invoicing':
      return { target: 'dialog', tab: 'invoice', key: 'gap.fix.invoicing', fallback: 'Complete invoice details' };
  }
}
