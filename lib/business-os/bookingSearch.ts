/**
 * Matching a typed query against one booking's text.
 *
 * > **Last Updated**: 2026-11-03
 *
 * ## Overview
 *
 * The bookings tab in the CRM contact drawer filters client-side: the owner
 * types, and the list of bookings that already arrived narrows. This module is
 * the matching half of that — the part with no React in it and no opinion about
 * what a booking contains.
 *
 * It lives here rather than inside `BookingsTab.tsx` for one reason: the number
 * handling is where the bugs are, and a source-level guard cannot catch an
 * off-by-one in a separator class. `₪1,200.00` has to be reachable by `1200`,
 * `050-123-4567` by `0501234567`, and a booking in October must NOT be reachable
 * by `122026` just because its day and year sit next to each other. Those are
 * three assertions about one regex, and they need a test that runs.
 *
 * The haystack itself — WHICH of a booking's forty-odd fields are searched —
 * stays in the component, because it depends on the component's own formatters:
 * the date has to be matched as the card RENDERS it, on the business's clock and
 * in the owner's language, and the status label is clock-aware.
 */

/**
 * One string, folded so that what is typed can reach what is shown.
 *
 * Accents come off BOTH sides — the query and the record — so "jose" finds
 * "José" and "José" finds "Jose", and neither has to be spelled the way the
 * other was. Only the Latin combining marks (U+0300–U+036F) are stripped:
 * Hebrew points live in a different block and are left exactly as they are,
 * which is the same no-transliteration rule the search has always kept. A
 * Hebrew business searching Hebrew words against Hebrew records needs no
 * romanisation, and guessing at one would match things nobody asked for.
 */
export function foldForSearch(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * The same string with nothing but its figures left, one run per number.
 *
 * A separator INSIDE a figure is presentation, so it is closed up: "₪1,200.00"
 * becomes "120000", which both "1200" and "1200.00" reach. Everything else
 * becomes a gap, so the "12" and the "2026" of a date stay two separate numbers
 * and a search for "122026" does not match a booking in October.
 *
 * The separators are the ones a locale actually prints between the digits of one
 * figure: a full stop, a comma, a non-breaking space, a narrow non-breaking
 * space, and both apostrophes. A HYPHEN is deliberately not among them — it
 * separates the parts of a date and a phone number far more often than it groups
 * a figure, and closing it up would merge "2026-10-12" into one number. A phone
 * is reached by carrying its digits into the haystack a second time instead.
 *
 * Give this the `shown` half of a split record, never the raw text: an id's
 * digits are noise, and `splitIdentifiers` sets out why.
 */
export function figuresOf(value: string): string {
  return value
    .replace(/(\d)[.,\u00a0\u202f'\u2019](?=\d)/g, '$1')
    .replace(/\D+/g, ' ');
}

/** A v4-shaped identifier: 8-4-4-4 hex and twelve more, every id a booking holds. */
const OPAQUE_ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/**
 * Below this many characters, a word is not matched against ids at all.
 *
 * Eight is the length of a UUID's first group, which is the chunk a person
 * copies when they do not take the whole thing. Shorter than that, a "match" is
 * chance rather than recognition.
 */
const ID_CHUNK = 8;

/**
 * One record's text, split by how precisely a word must be typed to reach it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IDS CANNOT SIT WITH EVERYTHING ELSE
 *
 * A booking carries half a dozen UUIDs — itself, its meeting, its parent, the
 * payment, the invoice, the proposal — and they must be searchable, because an
 * owner holding one pasted off a processor line should find the booking it
 * belongs to.
 *
 * But a UUID is 32 characters of noise, and across two hundred bookings there
 * are enough of them that almost any short string you can type appears inside
 * one. Reported as "280 finds nothing, 28 finds it": with ids in the ordinary
 * text, "28" was landing on an id rather than on anything the owner could see,
 * so the search ANSWERED — with the wrong card, for a reason nobody could have
 * guessed. A search that quietly answers wrongly is worse than one that finds
 * nothing, because nothing is at least legible as a miss.
 *
 * So the ids come out into a half of their own, reachable only by a word long
 * enough to be a deliberate paste. Everything an owner reads as text or as a
 * number stays in `shown`: amounts, dates, the phone, a card tail, and a
 * human-readable reference like "inv_8821" whose digits are meant to be typed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function splitIdentifiers(text: string): { shown: string; ids: string } {
  const ids: string[] = [];
  const shown = text.replace(OPAQUE_ID, match => {
    ids.push(match);
    /* A space, not an empty string: closing the gap would run the words on
       either side of the id together into one that neither of them is. */
    return ' ';
  });
  return { shown, ids: ids.join(' ') };
}

/**
 * The words a query is asking for, in no particular order.
 *
 * Split rather than matched whole, because matching the query as one contiguous
 * string is what made "oct 2026" fail against "Thu, Oct 12, 2026" — the comma
 * between the two halves was enough. An empty word belongs to nobody, so a
 * trailing space while the owner is still typing must not empty the list under
 * them.
 */
export function searchWords(query: string): string[] {
  return foldForSearch(query.trim().toLowerCase()).split(/\s+/).filter(Boolean);
}

/**
 * Does one typed word land on this record?
 *
 * Text first, which is what lets "oct" match the rendered date and "2026-10-12"
 * match the stored one. Then as bare digits against the record's figures, which
 * is what lets "1200" match "₪1,200.00" and "0501234567" match "050-123-4567" —
 * the owner types the amount, the card shows the presentation, and neither
 * should have to know about the other.
 *
 * @param numbers `figuresOf(text)`, passed in rather than derived, because one
 *   record is tested against every word of the query and recomputing it per word
 *   would walk the whole haystack again for each.
 */
export function wordLands(word: string, text: string, numbers: string): boolean {
  if (text.includes(word)) return true;
  const bare = word.replace(/\D+/g, '');
  return bare.length > 0 && numbers.includes(bare);
}

/**
 * Does this record satisfy the whole query?
 *
 * Every word must land, which is the AND an owner expects: "unpaid
 * consultation" means both, not either. `text` is one pooled string per CARD —
 * for a package, the container's words together with its meetings' — so
 * "package october" finds a block whose name is on the container and whose date
 * is on its fourth session.
 *
 * A word reaches the record three ways, in descending order of how loosely it
 * may be typed: as a substring of what the card SHOWS, as bare digits against
 * the figures in what it shows, and — only if it is long enough to be a
 * deliberate paste — as a substring of an id. See `splitIdentifiers`.
 *
 * The splitting happens here rather than at the call site so there is no way to
 * search a record without it, which is exactly how the ids got into the
 * ordinary text in the first place.
 */
export function recordMatches(words: string[], text: string): boolean {
  if (words.length === 0) return true;
  const { shown, ids } = splitIdentifiers(text);
  const numbers = figuresOf(shown);
  return words.every(
    word =>
      wordLands(word, shown, numbers) || (word.length >= ID_CHUNK && ids.includes(word))
  );
}
