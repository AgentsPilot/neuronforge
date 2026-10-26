/**
 * Match an email address case-insensitively, and ONLY case-insensitively.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Contacts were looked up with `.eq('email', …)`, which is case-sensitive.
 * Addresses are stored as the visitor typed them, so `Offir.Omer@…` missed the
 * existing `offir.omer@…` row and a SECOND contact was created for the same
 * person — with its own bookings and its own money hanging off it. A domain is
 * case-insensitive by specification and every real provider treats the local
 * part that way too.
 *
 * PostgREST has no case-insensitive equality, so the fix is `ilike`. But a
 * LIKE pattern is not a literal:
 *
 *   `_`  matches any single character
 *   `%`  matches any run of characters
 *
 * and `_` is perfectly legal in a local part — `offir_omer@gmail.com` is an
 * ordinary address. Passing one straight to `ilike` turns a lookup into a
 * wildcard search against every contact the business has.
 *
 * MEASURED, against the live table: the pattern `eomer3@gmail_com` matched
 * FIVE different contacts. A booking made from such an address would have been
 * attached to whichever row sorted first — somebody else's. That is worse than
 * the duplicate this was meant to prevent: a duplicate splits one person's
 * history, a mismatch files their appointment and their payment under another
 * person entirely.
 *
 * So every wildcard is escaped and the pattern means exactly the address.
 * Backslash first, or the escapes introduced below would themselves be escaped.
 *
 * @module lib/utils/emailMatch
 */

/**
 * An email as a LIKE pattern that matches that address and nothing else.
 *
 * Use with `.ilike('email', emailLikePattern(address))`. Never pass a raw
 * address to `ilike`.
 */
export function emailLikePattern(email: string): string {
  return email
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
}
