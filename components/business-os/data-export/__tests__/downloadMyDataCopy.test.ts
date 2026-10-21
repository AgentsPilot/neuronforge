/**
 * Copy parity of the "Download my data" control (data export DE-9, workplan
 * §6.4; SA DE-9 C-10): every key non-empty in en / he / es, he and es
 * translated, placeholders identical across languages AND exactly the ones
 * the control fills, `tooLarge` naming no ceiling (DE-8b QA edge note 4).
 */

import {
  DOWNLOAD_MY_DATA_COPY,
  DOWNLOAD_MY_DATA_PLACEHOLDERS,
  downloadMyDataCopy,
  fillCopy,
  type DownloadMyDataCopyKey,
} from '../downloadMyDataCopy';

const LOCALES = ['en', 'he', 'es'] as const;
const KEYS = Object.keys(DOWNLOAD_MY_DATA_COPY.en) as DownloadMyDataCopyKey[];
const placeholdersOf = (text: string) => Array.from(text.matchAll(/\{(\w+)\}/g), (m) => m[1]).sort();

describe('downloadMyDataCopy parity', () => {
  it('has a real key set (not vacuous)', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(19);
  });

  it.each(LOCALES)('%s: every key is a non-empty string', (locale) => {
    expect(Object.keys(DOWNLOAD_MY_DATA_COPY[locale]).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) expect(DOWNLOAD_MY_DATA_COPY[locale][key].trim()).not.toBe('');
  });

  it.each(['he', 'es'] as const)('%s differs from en on every key', (locale) => {
    const same = KEYS.filter((key) => DOWNLOAD_MY_DATA_COPY[locale][key] === DOWNLOAD_MY_DATA_COPY.en[key]);
    expect(same).toEqual([]);
  });

  it('every language has exactly the placeholders the control fills (C-10)', () => {
    for (const key of KEYS) {
      const expected = [...(DOWNLOAD_MY_DATA_PLACEHOLDERS[key] ?? [])].sort();
      for (const locale of LOCALES) {
        expect({ locale, key, placeholders: placeholdersOf(DOWNLOAD_MY_DATA_COPY[locale][key]) }).toEqual({
          locale,
          key,
          placeholders: expected,
        });
      }
    }
  });

  it('tooLarge has {email} and names no ceiling (QA edge note 4)', () => {
    for (const locale of LOCALES) {
      const text = DOWNLOAD_MY_DATA_COPY[locale].tooLarge;
      expect(text).toContain('{email}');
      expect(text).not.toMatch(/150|40\s*MB/i);
    }
  });

  it('no sentence types a number the config owns (the daily limit is {limit})', () => {
    for (const locale of LOCALES) expect(DOWNLOAD_MY_DATA_COPY[locale].dailyLimit).not.toMatch(/\b3\b/);
  });

  it('an unknown locale falls back to en; fillCopy leaves an unknown placeholder visible', () => {
    expect(downloadMyDataCopy('fr')).toBe(DOWNLOAD_MY_DATA_COPY.en);
    expect(downloadMyDataCopy(undefined)).toBe(DOWNLOAD_MY_DATA_COPY.en);
    expect(downloadMyDataCopy('he')).toBe(DOWNLOAD_MY_DATA_COPY.he);
    expect(fillCopy('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });
});
