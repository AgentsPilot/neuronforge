/**
 * The words S-3 added (settings drawer review S-3, C-5, F-2, F-17; SA S-3 C-9).
 *
 * Nothing checks that the three dictionaries stay in step, and a missing key
 * renders as the key itself (`settings.drawer.discard`) in front of an owner
 * deciding whether to throw their edits away. So each new key is pinned in all
 * three languages.
 */

import { en } from '@/lib/business-os/translations/en';
import { he } from '@/lib/business-os/translations/he';
import { es } from '@/lib/business-os/translations/es';

const KEYS = [
  'settings.drawer.discard_title',
  'settings.drawer.discard_desc',
  'settings.drawer.keep_editing',
  'settings.drawer.discard',
  'consent.save_failed',
  'consent.load_failed',
] as const;

const DICTIONARIES: Record<'en' | 'he' | 'es', Record<string, string>> = { en, he, es };

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe.each(KEYS)('%s', (key) => {
  it('is a non-empty string in en, he and es', () => {
    for (const [lang, dictionary] of Object.entries(DICTIONARIES)) {
      const value = dictionary[key];
      expect({ lang, type: typeof value }).toEqual({ lang, type: 'string' });
      expect({ lang, empty: value.trim() === '' }).toEqual({ lang, empty: false });
    }
  });

  it('is translated: he and es differ from en', () => {
    expect(he[key as keyof typeof he]).not.toBe(en[key]);
    expect(es[key as keyof typeof es]).not.toBe(en[key]);
  });

  it('has the same placeholders in every language', () => {
    const expected = placeholders(en[key]);
    expect(placeholders(he[key as keyof typeof he])).toEqual(expected);
    expect(placeholders(es[key as keyof typeof es])).toEqual(expected);
  });
});

describe('SA C-9: the Hebrew Discard cannot be read as "cancel"', () => {
  it('does not use בטל, which also means cancel (the opposite choice, next to Keep editing)', () => {
    expect(he['settings.drawer.discard']).not.toMatch(/בטל/);
    expect(he['settings.drawer.discard_title']).not.toMatch(/לבטל/);
  });
});
