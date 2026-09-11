/**
 * A date the way a person answers a question, turned into one the system means.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS CLOSES
 *
 * Mid-write, the next message is a VALUE, not a request — that is what makes the
 * fill path a state machine instead of a guess. But every value was stored as
 * the literal text typed, and for a date field that is wrong the moment anyone
 * answers the way people actually answer:
 *
 *   "when is it due?"  ->  "9 בספטמבר"   stored as the string "9 בספטמבר"
 *                      ->  "מחר"          stored as the string "מחר"
 *
 * The column then rejects it, and the user is asked the same question again for
 * a perfectly clear answer they already gave.
 *
 * WHY THIS IS NOT A KEYWORD TABLE
 *
 * Month and weekday names come from `Intl` in the reader's own language, so
 * every language the platform ever supports is handled without a list being
 * maintained here. The only vocabulary this file owns is "today/tomorrow/
 * yesterday", which `Intl` has no notion of — and even that is shared with the
 * answer line rather than copied (see ANCHOR_WORDS in ../dates).
 *
 * Returns null on anything it cannot read with confidence, and the caller keeps
 * today's behaviour. A wrong date silently written into a reminder is worse
 * than being asked again.
 *
 * @module lib/business-os/bizql/mutate
 */

import { ANCHOR_WORDS, partsInZone } from '../dates';

/** What a resolved answer becomes: the same shape the planner emits. */
export interface SpokenDate {
  $date: string;
}

/** Anchors a person actually says in answer to "when?". */
const SPOKEN_ANCHORS = ['today', 'tomorrow', 'yesterday'] as const;

/**
 * Strip what does not carry meaning, including the Hebrew prefixes that glue
 * onto a date word: "ב-9", "בספטמבר", "למחר".
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,;:!?"'׳״]/g, ' ')
    .replace(/[-־–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Does this word appear, allowing a glued Hebrew prefix in front of it? */
function says(haystack: string, needle: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  if (haystack.includes(n)) return true;

  // Hebrew attaches ב/ל/ה to the noun: "בספטמבר" is "in September".
  return /^[֐-׿]/.test(n)
    ? new RegExp(`(?:^|\\s)[בלהמוש]?${n}(?:$|\\s)`).test(haystack)
    : false;
}

/** Month names in a language, long and short, indexed 1-12. */
function monthNames(language: string): Array<{ month: number; names: string[] }> {
  const out: Array<{ month: number; names: string[] }> = [];

  for (let month = 1; month <= 12; month++) {
    const day = new Date(Date.UTC(2026, month - 1, 15));
    const names = ['long', 'short'].map((style) =>
      normalize(
        new Intl.DateTimeFormat(language, { month: style as 'long', timeZone: 'UTC' }).format(day)
      )
    );
    out.push({ month, names: [...new Set(names)].filter(Boolean) });
  }

  return out;
}

/** Weekday names in a language, mapped to the anchor that names them. */
function weekdayNames(language: string): Array<{ anchor: string; names: string[] }> {
  const anchors = [
    'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
  ];

  return anchors.map((anchor, index) => {
    // 2026-03-01 is a Sunday, so +index walks the week.
    const day = new Date(Date.UTC(2026, 2, 1 + index));
    const names = ['long', 'short'].map((style) =>
      normalize(
        new Intl.DateTimeFormat(language, { weekday: style as 'long', timeZone: 'UTC' }).format(day)
      )
    );
    return { anchor, names: [...new Set(names)].filter(Boolean) };
  });
}

/**
 * Read a date out of what someone said.
 *
 * @param text     the reply, verbatim
 * @param language the reader's language, for month and weekday names
 * @param timezone the business timezone, so "which year" is decided on their clock
 */
export function parseSpokenDate(
  text: string,
  language = 'en',
  timezone = 'UTC'
): SpokenDate | null {
  const said = normalize(text);
  if (!said) return null;

  /*
   * 1. An explicit calendar date, however it was punctuated.
   *
   * Matched against the RAW text: `normalize` turns hyphens into spaces so that
   * "ב-9 בספטמבר" reads as words, and that same step would take "2026-10-30"
   * apart before it could be recognised.
   */
  const iso = /(\d{4})[-/.\s](\d{1,2})[-/.\s](\d{1,2})/.exec(text.trim());
  if (iso) {
    const [, y, m, d] = iso;
    return { $date: `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` };
  }

  // 2. "today" / "tomorrow" / "yesterday", in any supported language.
  for (const anchor of SPOKEN_ANCHORS) {
    const words = Object.values(ANCHOR_WORDS[anchor] ?? {});
    if (words.some((word) => says(said, word))) return { $date: anchor };
  }

  // 3. A weekday. The anchor resolves to its NEXT occurrence, which is what
  //    "on Thursday" means to everyone who says it.
  for (const { anchor, names } of weekdayNames(language)) {
    if (names.some((name) => says(said, name))) return { $date: anchor };
  }

  const { y, m, d: todayDay } = partsInZone(new Date(), timezone);

  // 4. A day and a month name: "9 בספטמבר", "September 9", "9 de septiembre".
  const day = /(?:^|\s)(\d{1,2})(?:$|\s)/.exec(said)?.[1];

  for (const { month, names } of monthNames(language)) {
    if (!names.some((name) => says(said, name))) continue;
    if (!day) continue;

    const dayNumber = Number(day);
    if (dayNumber < 1 || dayNumber > 31) return null;

    /*
     * No year was said, so take the NEXT occurrence — the same rule the planner
     * prompt states. Someone answering "9 September" in November means next
     * year's, and defaulting to this year would quietly book a date in the past.
     */
    const isPast = month < m || (month === m && dayNumber < todayDay);
    const year = isPast ? y + 1 : y;

    return {
      $date: `${year}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`,
    };
  }

  // 5. A bare numeric day/month: "9/9", "9.9". Ordered day-first, which is what
  //    every locale this product ships in uses.
  const numeric = /(?:^|\s)(\d{1,2})[/](\d{1,2})(?:$|\s)/.exec(said);
  if (numeric) {
    const dayNumber = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (month >= 1 && month <= 12 && dayNumber >= 1 && dayNumber <= 31) {
      const isPast = month < m || (month === m && dayNumber < todayDay);
      return {
        $date: `${isPast ? y + 1 : y}-${String(month).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`,
      };
    }
  }

  return null;
}
