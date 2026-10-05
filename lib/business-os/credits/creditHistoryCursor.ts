/**
 * The credit history's page position (credit deduction slice 7a, workplan
 * §4.4; SA SQ-29, Q-2).
 *
 * ── WHAT IT CARRIES ──────────────────────────────────────────────────────────
 *   - `w`: the window the page belongs to — its kind (`m` monthly, `c`
 *     calendar month, `t` trial) and its key, the EXACT string read (the
 *     period key, or the trial anchor). A request whose `w` is not the current
 *     window's is answered `{ restart: true }`.
 *   - `t`: the last line's `created_at`, the EXACT string PostgREST returned
 *     (microseconds). Never rebuilt from a `Date`: a millisecond value skips or
 *     repeats rows.
 *   - `i`: the last line's row id (the tie-break).
 *
 * ── WHY IT IS HARDENED ───────────────────────────────────────────────────────
 * `t` and `i` end up inside a PostgREST or-expression. So the cursor is
 * refused unless it is short, base64url, JSON with exactly these three keys,
 * and each value matches a strict pattern — before anything reaches the
 * repository (which checks again). Anything else is a 400 at the route.
 *
 * Opaque to the browser: it is sent back byte for byte, never parsed there.
 * Server-side; pure.
 *
 * @module lib/business-os/credits/creditHistoryCursor
 */

import { z } from 'zod';

/** The window kinds, one letter each, as they appear in `w`. */
export const HISTORY_WINDOW_PREFIX = {
  monthly: 'm',
  calendar_month: 'c',
  trial_total: 't',
} as const;

/** Longest cursor accepted, before decoding. */
export const MAX_HISTORY_CURSOR_LENGTH = 512;

const TIMESTAMPTZ = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})`;
const TIMESTAMPTZ_PATTERN = new RegExp(`^${TIMESTAMPTZ}$`);
const WINDOW_PATTERN = new RegExp(`^[mct]:${TIMESTAMPTZ}$`);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

const CursorSchema = z
  .object({
    w: z.string().regex(WINDOW_PATTERN),
    t: z.string().regex(TIMESTAMPTZ_PATTERN),
    i: z.string().regex(UUID_PATTERN),
  })
  .strict();

export type HistoryCursor = z.infer<typeof CursorSchema>;

/** The `w` of a window: its kind letter and its exact key. */
export function historyWindowTag(kind: keyof typeof HISTORY_WINDOW_PREFIX, key: string): string {
  return `${HISTORY_WINDOW_PREFIX[kind]}:${key}`;
}

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify({ w: cursor.w, t: cursor.t, i: cursor.i }), 'utf8').toString('base64url');
}

/** The cursor, or null when it is anything but a well-formed one (the route answers 400). */
export function decodeHistoryCursor(raw: unknown): HistoryCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_HISTORY_CURSOR_LENGTH) return null;
  if (!BASE64URL_PATTERN.test(raw)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    // Not JSON: a malformed cursor, refused like any other.
    return null;
  }
  const result = CursorSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
