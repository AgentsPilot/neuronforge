/**
 * Timestamp rendering for the Business OS AI settings screen.
 *
 * Deliberately UTC and deliberately not `toLocaleString`: two admins reading
 * the same incident must read the same number, and the server log lines and
 * the `token_usage` rows this page is corroborated against are all UTC.
 */

/**
 * `null` in, `null` out — never a date.
 *
 * `new Date(null)` is the epoch, so a missing timestamp rendered naively reads
 * as "1 January 1970": a wrong answer wearing the costume of a right one (QA
 * DEF-6). An unparseable value is returned as-is rather than guessed at.
 */
export function formatInstant(at: string | null | undefined): string | null {
  if (!at) return null;
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * The `since` the ledger route wants: a full ISO instant WITH a timezone
 * designator, which its Zod schema requires and a raw Postgres timestamp does
 * not always carry.
 */
export function toSinceParam(at: string): string | null {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}
