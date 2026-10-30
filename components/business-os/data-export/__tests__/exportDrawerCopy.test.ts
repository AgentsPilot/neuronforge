/**
 * The export drawer's words (export redesign MX-1b, workplan §11, T-10).
 */

import { EXPORT_DRAWER_COPY, exportDrawerCopy, fillDrawerCopy } from '../exportDrawerCopy';

type Flat = Record<string, string>;
const flatten = (value: unknown, prefix = ''): Flat =>
  Object.entries(value as Record<string, unknown>).reduce<Flat>((out, [key, v]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof v === 'string') out[path] = v;
    else Object.assign(out, flatten(v, path));
    return out;
  }, {});

const holes = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe('exportDrawerCopy', () => {
  const en = flatten(EXPORT_DRAWER_COPY.en);

  it.each(['he', 'es'] as const)('%s has every key, non-empty, with the same placeholders as en', (language) => {
    const other = flatten(EXPORT_DRAWER_COPY[language]);
    expect(Object.keys(other).sort()).toEqual(Object.keys(en).sort());
    for (const key of Object.keys(en)) {
      expect(other[key].trim().length).toBeGreaterThan(0);
      expect(holes(other[key])).toEqual(holes(en[key]));
    }
  });

  it('the files sentence is the requirement §3.2 sentence (BQ-35 answered: final)', () => {
    expect(EXPORT_DRAWER_COPY.en.filesNotIncluded).toBe(
      "Files (client documents, website pictures) are not included. Download client documents from each client's record."
    );
  });

  it("the confirmation is the user's wording (BQ-E5-3) and the entry label is Export data (BQ-E5-2)", () => {
    expect(EXPORT_DRAWER_COPY.en.startedToast).toBe('Export started. The exported files will be sent to {email} once ready.');
    expect(EXPORT_DRAWER_COPY.en.entryLabel).toBe('Export data');
  });

  it('never says "delivered" in any language (XC-9)', () => {
    expect(JSON.stringify(EXPORT_DRAWER_COPY)).not.toMatch(/deliver|נמסר|entregad/i);
  });

  it('falls back to English for an unknown or missing language', () => {
    expect(exportDrawerCopy(undefined)).toBe(EXPORT_DRAWER_COPY.en);
    expect(exportDrawerCopy('fr')).toBe(EXPORT_DRAWER_COPY.en);
    expect(exportDrawerCopy('he')).toBe(EXPORT_DRAWER_COPY.he);
  });

  it('fillDrawerCopy fills known placeholders and leaves unknown ones', () => {
    expect(fillDrawerCopy('a {x} b {y}', { x: 1 })).toBe('a 1 b {y}');
  });
});
