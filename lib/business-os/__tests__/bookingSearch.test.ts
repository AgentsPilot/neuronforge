/**
 * The bookings search finds a booking by any word or number on it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS RUNS RATHER THAN GREPS
 *
 * The sibling guard (`bookingsSearchAndPaging.guard.test.ts`) pins WHICH fields
 * the contact drawer searches, by reading the source. It cannot tell whether the
 * matching works, and the matching is where this feature's bugs live: every one
 * of them is an off-by-one in a character class.
 *
 * The box this replaced matched the whole query as one contiguous string against
 * six low-cardinality fields. On a client with fifty orders that is a control
 * which cannot find anything: the service name repeats on all fifty, the status
 * words on most, the note is usually empty, and the one field with real spread —
 * the date — was reachable only by typing it exactly as rendered, down to the
 * comma in "Thu, Oct 12, 2026".
 *
 * So the cases below are written as the OWNER's attempts, not as the code's
 * branches: what someone holding an invoice, a bank line or a half-remembered
 * month would actually type.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  foldForSearch,
  figuresOf,
  searchWords,
  wordLands,
  recordMatches,
} from '@/lib/business-os/bookingSearch';

/** One booking's pooled text, as the drawer builds it: rendered and stored. */
const CONSULTATION = foldForSearch(
  [
    'Initial consultation',
    'website',
    'confirmed',
    'Awaiting payment',
    'Client asked for evenings only',
    'Thu, Oct 12, 2026, 02:30 PM',
    '2026-10-12',
    '₪1,200.00',
    'ILS',
    'card',
    '4242',
    'inv_8821',
    '050-123-4567',
    '0501234567',
  ].join(' ')
);

/** A booking that must NOT answer for the one above. */
const FOLLOW_UP = foldForSearch(
  ['Follow-up session', 'manual', 'completed', 'Mon, Mar 3, 2025', '2025-03-03', '₪450.00', 'ILS'].join(
    ' '
  )
);

const finds = (query: string, text = CONSULTATION) => recordMatches(searchWords(query), text);

describe('what the owner types', () => {
  it('finds a month and a year typed as two words', () => {
    /*
     * THE CASE THIS WAS BUILT FOR. "oct 2026" against "Thu, Oct 12, 2026" was
     * a miss, because the query was matched as one contiguous string and a
     * comma sits between the two halves. An owner does not know that.
     */
    expect(finds('oct 2026')).toBe(true);
    expect(finds('2026 oct')).toBe(true);
  });

  it('does not care what order the words come in', () => {
    expect(finds('consultation evenings')).toBe(true);
    expect(finds('evenings consultation')).toBe(true);
  });

  it('requires every word, so two words narrow rather than widen', () => {
    // The AND an owner expects: "unpaid consultation" means both.
    expect(finds('consultation awaiting')).toBe(true);
    expect(finds('consultation refunded')).toBe(false);
  });

  it('ignores a trailing space while they are still typing', () => {
    // An empty word belongs to nobody. Treating it as a term emptied the list
    // under the reader mid-keystroke.
    expect(finds('oct ')).toBe(true);
    expect(searchWords('  ')).toEqual([]);
    expect(recordMatches(searchWords(''), CONSULTATION)).toBe(true);
  });

  it('tells the two bookings apart', () => {
    expect(finds('consultation', FOLLOW_UP)).toBe(false);
    expect(finds('follow-up', FOLLOW_UP)).toBe(true);
    expect(finds('2025', CONSULTATION)).toBe(false);
  });
});

describe('a figure, typed as the owner holds it', () => {
  it('finds an amount without its thousands separator', () => {
    // They read "1200" off a bank line; the card shows "₪1,200.00".
    expect(finds('1200')).toBe(true);
  });

  it('finds the same amount written the way the card writes it', () => {
    expect(finds('1,200')).toBe(true);
    expect(finds('1,200.00')).toBe(true);
    expect(finds('₪1,200')).toBe(true);
  });

  it('finds a phone number however the record punctuates it', () => {
    expect(finds('0501234567')).toBe(true);
    expect(finds('050-123-4567')).toBe(true);
    expect(finds('1234567')).toBe(true);
  });

  it('finds a card tail and an invoice number', () => {
    expect(finds('4242')).toBe(true);
    expect(finds('inv_8821')).toBe(true);
    expect(finds('8821')).toBe(true);
  });

  it('finds a quote total by the whole figure, not just its leading digits', () => {
    /*
     * REPORTED: a ₪280 quote answered to "28" and not to "280".
     *
     * The miss was upstream of this module — the quote's total is rendered by
     * the journey rail and the drawer was not searching the rail, so "28" was
     * landing on something incidental (a day of the month, a run of digits in
     * an id) while "280" landed on nothing. Pinned here as well so the matching
     * itself can never be the reason a complete figure loses to a prefix of it.
     */
    const quoted = foldForSearch('Kitchen refit Quote sent ₪280.00 2026-10-12');
    expect(recordMatches(searchWords('280'), quoted)).toBe(true);
    expect(recordMatches(searchWords('28'), quoted)).toBe(true);
    expect(recordMatches(searchWords('₪280'), quoted)).toBe(true);
    // And a figure the record does not hold stays a miss.
    expect(recordMatches(searchWords('2801'), quoted)).toBe(false);
  });

  it('finds the stored date, which no locale prints', () => {
    // The form on a spreadsheet or an export, beside the rendered one.
    expect(finds('2026-10-12')).toBe(true);
    expect(finds('2026-10')).toBe(true);
  });

  it('does not run a date together into a number nobody meant', () => {
    /*
     * THE REGRESSION THE SEPARATOR CLASS EXISTS TO PREVENT. Closing up every
     * separator would make "12 Oct 2026" the single number "122026", and a
     * search for it would return a booking that has no such figure on it.
     * Only separators INSIDE a figure are closed up.
     */
    expect(finds('122026')).toBe(false);
    expect(figuresOf('12 oct 2026')).not.toContain('122026');
    expect(figuresOf('₪1,200.00')).toContain('120000');
  });

  it('does not match an amount from the digits of unrelated fields', () => {
    // "4242" and "8821" sit next to each other in the text; their join is not
    // a number this booking has.
    expect(finds('42428821')).toBe(false);
  });

  it('does not let an id lend its digits to a number search', () => {
    /*
     * REPORTED, via "280 finds nothing but 28 finds it": a booking carries half
     * a dozen UUIDs, and across a real client history their 32 hex characters
     * each contain nearly any short run of digits you can type. With them in
     * the numeric pool, every short query matched almost everything, so a
     * search could appear to work while landing on the wrong card for the wrong
     * reason — the worst failure of the two, because it answers.
     *
     * The id itself stays findable as text, which is what a paste is.
     */
    const withId = foldForSearch('Follow-up 3f2804a1-9b28-4c07-a280-91e5c6d47b02 ₪450.00');
    expect(recordMatches(searchWords('280'), withId)).toBe(false);
    expect(recordMatches(searchWords('28'), withId)).toBe(false);
    expect(recordMatches(searchWords('450'), withId)).toBe(true);
    // Pasted whole, and by a recognisable chunk.
    expect(recordMatches(searchWords('3f2804a1-9b28-4c07-a280-91e5c6d47b02'), withId)).toBe(true);
    expect(recordMatches(searchWords('3f2804a1'), withId)).toBe(true);
  });
});

describe('folding, which is not transliteration', () => {
  it('matches across Latin accents in either direction', () => {
    const jose = foldForSearch('José García consultation');
    expect(recordMatches(searchWords('jose'), jose)).toBe(true);
    expect(recordMatches(searchWords('José'), jose)).toBe(true);
    expect(recordMatches(searchWords('garcia'), jose)).toBe(true);
  });

  it('is case-blind', () => {
    expect(finds('INITIAL CONSULTATION')).toBe(true);
    expect(finds('Oct')).toBe(true);
  });

  it('leaves Hebrew exactly as it is, and does not romanise it', () => {
    /*
     * A Hebrew business searching Hebrew words against Hebrew records needs no
     * romanisation, and guessing at one matches things nobody asked for. The
     * fold must not touch Hebrew points either — they are a different Unicode
     * block from the Latin combining marks it strips.
     */
    const hebrew = foldForSearch('פגישת ייעוץ 12 באוק׳ 2026');
    expect(hebrew).toContain('ייעוץ');
    expect(recordMatches(searchWords('ייעוץ'), hebrew)).toBe(true);
    expect(recordMatches(searchWords('באוק'), hebrew)).toBe(true);
    expect(recordMatches(searchWords('2026'), hebrew)).toBe(true);
    // Not reachable by its sound in Latin letters, deliberately.
    expect(recordMatches(searchWords('yeutz'), hebrew)).toBe(false);
  });
});

describe('wordLands', () => {
  it('tries the text before it tries the digits', () => {
    // Which is what lets a word with digits in it match as written.
    const text = 'order 2026-10-12';
    expect(wordLands('2026-10-12', text, figuresOf(text))).toBe(true);
  });

  it('never lets a word with no digits match on the numeric path', () => {
    // `''.includes('')` is true, so a wordless query would match everything if
    // the empty-bare case were not excluded.
    expect(wordLands('zzz', 'nothing here', figuresOf('nothing here'))).toBe(false);
    expect(wordLands('-', '1200', figuresOf('1200'))).toBe(false);
  });
});
