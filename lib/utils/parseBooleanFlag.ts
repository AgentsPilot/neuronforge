// lib/utils/parseBooleanFlag.ts
//
// The shared boolean-flag parser. C-33.
//
// ⚠️ THIS MODULE MUST HAVE ZERO IMPORTS. That is its entire job.
//
// It was extracted from `lib/utils/featureFlags.ts` so that server code can
// share the parsing rules without importing that module's dependency graph.
// `featureFlags.ts` imports `@/lib/logger/client`, which today is a three-line
// re-export of the same Pino instance the server uses — so it *is* importable
// server-side right now. But nothing enforces that it stays that way, it has
// zero server importers to notice if it stops, and a single `'use client'`
// directive or `window` reference added by someone with no reason to think
// about `authorizePurge` would break an authorization boundary at runtime.
//
// The purge feature's D9 gate (`isBusinessDeleteSurfaceEnabled`) is one of the
// consumers, and it decides what is *permitted*, not what is rendered. Adding
// an import here re-couples that decision to the client bundle's dependency
// graph. Don't.

/**
 * Parse a boolean feature flag from an environment variable value.
 *
 * Accepts `'true'` / `'1'` as true and `'false'` / `'0'` as false, trimmed and
 * case-insensitive. Anything unrecognised — including an empty or unset value —
 * returns `defaultValue`.
 *
 * The lenient parsing matters more than it looks: writing `=1` or `=TRUE` in a
 * deployment environment is common, and a strict `=== 'true'` check would treat
 * both as "off" while giving the operator no signal about why the thing they
 * just enabled did nothing.
 *
 * @param flag - Raw environment variable value, possibly undefined
 * @param defaultValue - Result when the value is absent or unrecognised
 */
export function parseBooleanFlag(
  flag: string | undefined,
  defaultValue: boolean = false
): boolean {
  if (!flag || flag.trim() === '') {
    return defaultValue;
  }

  const normalized = flag.trim().toLowerCase();

  if (normalized === 'false' || normalized === '0') return false;
  if (normalized === 'true' || normalized === '1') return true;

  return defaultValue;
}
