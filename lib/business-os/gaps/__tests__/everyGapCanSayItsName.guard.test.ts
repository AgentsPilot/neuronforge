/**
 * Every gap the card can group has a label, in every language it is read in.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT WENT WRONG
 *
 * `NeedsYouCard` renders `t('gaps.kind.' + gap.id)` as the heading of every
 * group, unconditionally, and `LanguageContext.t` ends in `|| key`. So a gap id
 * with no label does not fall back to anything readable: the owner is shown the
 * literal string `gaps.kind.meeting_upcoming` where the heading should be.
 *
 * Two of the seventeen registered gaps had no label in any of the three
 * languages. `quote_awaiting_client` has a `gaps.lead.say.*` sentence, so its
 * rows read correctly and only its heading was raw. `meeting_upcoming` has no
 * sentence either, and `leadSentence` falls back to the same missing key, so
 * both its heading AND every one of its rows showed the key.
 *
 * Nothing connected the GapId union to the translation files, so adding a gap
 * and forgetting its copy was silent — in English too, which is why review
 * never caught it.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *
 * The join, not the wording: every id in `GAP_DEFINITIONS` must resolve to a
 * label in en, he and es. A new gap now fails here until its copy exists,
 * rather than shipping a raw key to the owner's My Day.
 *
 * `gaps.lead.say.*` is deliberately NOT required — it is optional by design and
 * the kind label is its documented fallback. What this insists on is that the
 * fallback itself is never missing.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { GAP_DEFINITIONS } from '@/lib/business-os/gaps/definitions';
import { en } from '@/lib/business-os/translations/en';
import { es } from '@/lib/business-os/translations/es';
import { he } from '@/lib/business-os/translations/he';

/*
 * The three dictionaries directly, not the `translations` barrel: that lives in
 * `LanguageContext.tsx` and importing it would pull React and a context into a
 * test that only needs the copy.
 */
const translations = { en, he, es } as Record<string, Record<string, string>>;

const LANGUAGES = ['en', 'he', 'es'] as const;

describe('every registered gap has a readable name', () => {
  const ids = GAP_DEFINITIONS.map(gap => gap.id);

  it('registers gaps at all, so an empty list cannot pass this file', () => {
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  describe.each(LANGUAGES)('%s', language => {
    const dictionary = translations[language] as Record<string, string>;

    it.each(ids)('has a label for %s', id => {
      const key = `gaps.kind.${id}`;
      const label = dictionary[key];

      expect(label).toBeDefined();
      /* `|| key` is what reaches the screen, so the key itself is a failure. */
      expect(label).not.toBe(key);
      expect(String(label).trim().length).toBeGreaterThan(0);
    });
  });

  /*
   * The three files drifting apart is the other half of the same bug: a label
   * added to English only leaves Hebrew and Spanish owners reading the key.
   */
  it('keeps the three languages in step on every gaps.* key', () => {
    const keysFor = (language: (typeof LANGUAGES)[number]) =>
      Object.keys(translations[language]).filter(key => key.startsWith('gaps.')).sort();

    const english = keysFor('en');
    expect(keysFor('he')).toEqual(english);
    expect(keysFor('es')).toEqual(english);
  });
});
