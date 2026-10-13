/**
 * A query-string boolean that understands the word "false".
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `z.coerce.boolean()` CANNOT BE USED FOR THIS
 *
 * It calls `Boolean(value)`, and `Boolean('false')` is `true`. Every non-empty
 * string is. So a route validating `?includeCorrelated=false` with
 * `z.coerce.boolean()` reads it as TRUE, and the caller's instruction is not
 * merely ignored — it is inverted.
 *
 * Found on `/api/business-os/insights`, where the dashboard asks for one
 * insight cheaply:
 *
 *     ?limit=1&includeCorrelated=false&includeVectorMaturity=false
 *      &includeProjection=false
 *
 * All three were read as `true`, so the "cheap" request built the correlated
 * insights, the vector maturity and the projections anyway. Nothing failed and
 * nothing logged; the response simply cost what the caller had asked it not to.
 *
 * The failure is invisible in both directions, which is what makes it worth a
 * shared helper rather than a fix at one call site: a flag defaulting to TRUE
 * can never be turned off, and a flag defaulting to FALSE is turned on by
 * `=false` — and neither produces an error anybody would see.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS FALSE
 *
 * The spellings a browser, a fetch client or a person actually sends:
 * `false`, `0`, `no`, `off`, and the empty string. Everything else present is
 * true, which keeps the common `?flag` and `?flag=1` working.
 *
 * ABSENT IS NOT FALSE. A missing parameter passes through untouched so the
 * schema's own `.default()` decides, which is the whole point of having one —
 * a route whose flag defaults to true must stay true when nobody says anything.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/validation/booleanParam
 */

import { z } from 'zod';

/** The spellings that mean no. Compared lower-case and trimmed. */
const FALSEY = new Set(['false', '0', 'no', 'off', '']);

/**
 * A boolean read from a query string.
 *
 * @param fallback what an absent parameter means. Required rather than
 *   defaulted, because "which way does this go when nobody says" is exactly the
 *   decision a reader needs to see at the call site.
 */
export function booleanParam(fallback: boolean) {
  return z.preprocess(value => {
    if (typeof value !== 'string') return value;
    return !FALSEY.has(value.trim().toLowerCase());
  }, z.boolean()).optional().default(fallback);
}
