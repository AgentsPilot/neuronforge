/**
 * The three dictionaries say the same things.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NEW
 *
 * They used to be one object literal in `LanguageContext.tsx`, where adding a
 * key to `en` and forgetting `he` meant scrolling four thousand lines to
 * notice. Now they are three files, which makes forgetting *easier*, not
 * harder: the Spanish file is not open when the English one is edited.
 *
 * And the failure is quiet by design. `t()` falls back to English when a key is
 * missing, so a Hebrew screen grows one English line and nothing anywhere
 * reports it. An owner sees it; the test suite does not.
 *
 * So the split needs this guard, and it did not need it before.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { translations } from '../LanguageContext';

type Lang = 'en' | 'es' | 'he';

const LANGS: Lang[] = ['en', 'es', 'he'];
const keysOf = (lang: Lang) => new Set(Object.keys(translations[lang]));

describe('the dictionaries compose exactly as they did inline', () => {
  it('still exposes all three languages under one object', () => {
    expect(Object.keys(translations).sort()).toEqual(['en', 'es', 'he']);
  });

  /*
   * A floor, not a count. Pinning the exact number would make every copy change
   * a two-file edit for no benefit — but a dictionary that loses most of itself
   * (a bad merge, a truncated file, an import that silently resolved to
   * nothing) is the thing worth catching, and that is an order of magnitude.
   */
  it.each(LANGS)('%s carries a full dictionary rather than a fragment', lang => {
    expect(keysOf(lang).size).toBeGreaterThan(1500);
  });

  it('reads a real string through the composed object', () => {
    expect(typeof translations.en['payments.invoices']).toBe('string');
    expect(translations.en['payments.invoices'].length).toBeGreaterThan(0);
  });
});

describe('no language is left behind', () => {
  /*
   * English is the reference because it is where every key is written first,
   * and because it is what `t()` falls back TO. A key missing from English
   * while present elsewhere is a different and stranger bug, so both
   * directions are checked.
   */
  it.each(['es', 'he'] as const)('%s has every key English has', lang => {
    const missing = [...keysOf('en')].filter(key => !keysOf(lang).has(key));

    // Named, not counted: "14 keys missing" sends somebody hunting.
    expect(missing).toEqual([]);
  });

  it.each(['es', 'he'] as const)('%s has no key English does not', lang => {
    const extra = [...keysOf(lang)].filter(key => !keysOf('en').has(key));

    expect(extra).toEqual([]);
  });
});
