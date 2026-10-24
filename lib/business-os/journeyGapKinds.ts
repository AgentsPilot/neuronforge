/**
 * The journey gap kinds, as a value and a type.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS ITS OWN FILE
 *
 * The kinds used to live in `journeyReadiness.ts`, which imports
 * `supabaseServer` and a repository — so it is server-only, and
 * `serverModulesStayServer.guard.test.ts` names it as such.
 *
 * `gapFixAction` only ever needed the TYPE, and a type import is erased at
 * build, so that was safe. The moment anything needed the VALUE — a client
 * component checking whether a kind off API JSON is one the fix mapping can
 * answer for — importing it from there dragged the service-role client into
 * the browser bundle and the whole platform stopped loading.
 *
 * Hence a module with NO imports at all. Both the server reader and the client
 * component can depend on this one, and neither can poison the other.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Every gap the readiness check can report.
 *
 * `gapFixAction` switches over these with no default branch, so a kind it has
 * never heard of returns `undefined` and the caller then reads a property off
 * nothing. The component that renders gaps takes them from API JSON, where the
 * compiler cannot help — which is what `isJourneyGapKind` is for.
 */
export const JOURNEY_GAP_KINDS = [
  'hours',
  'timezone',
  'processor',
  'invoicing',
  'catalogue',
] as const;

export type JourneyGapKind = (typeof JOURNEY_GAP_KINDS)[number];

/** Is this string one of the kinds `gapFixAction` can actually answer for? */
export function isJourneyGapKind(value: unknown): value is JourneyGapKind {
  return typeof value === 'string' && (JOURNEY_GAP_KINDS as readonly string[]).includes(value);
}
