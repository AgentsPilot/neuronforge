/**
 * "Most came from X" in three languages.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The channel used to be appended by the caller — `${t(key)} ${label}.` — which
 * reads correctly in English and Spanish and is wrong in Hebrew, where `מ` is
 * an inseparable prefix. The stored value ended `מ-` and the rendered line came
 * out "רובם הגיעו מ- אתרים אחרים": a dangling hyphen, and a space where the
 * word should have joined.
 *
 * Interpolation puts the spacing under each language's own control, which is
 * the only place that decision can be made correctly.
 *
 * Read from source rather than imported: `LanguageContext` is a `'use client'`
 * module holding a React context, and `translations` is not exported. The same
 * approach as `app/api/business-os/stats/__tests__/bookedThisWeek.guard.test.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const source = readFileSync(
  join(__dirname, '..', 'LanguageContext.tsx'),
  'utf8'
);

/** Every locale's value for one key, in file order: en, es, he. */
function valuesFor(key: string): string[] {
  const pattern = new RegExp(`'${key.replace('.', '\\.')}': '([^']*)'`, 'g');
  return [...source.matchAll(pattern)].map(m => m[1]);
}

const KEY = 'verdict.live.via';

describe(KEY, () => {
  const values = valuesFor(KEY);

  it('is defined in all three languages', () => {
    expect(values).toHaveLength(3);
  });

  it('carries the {channel} placeholder in every language', () => {
    // Without it the caller has to concatenate, and the caller cannot know
    // whether this language wants a space.
    for (const value of values) {
      expect(value).toContain('{channel}');
    }
  });

  it('joins the Hebrew prefix to the word, with no hyphen and no space', () => {
    const he = values.find(v => /[֐-׿]/.test(v))!;

    expect(he.replace('{channel}', 'אתרים אחרים')).toBe('רובם הגיעו מאתרים אחרים');
    expect(he).not.toContain('מ-');
    expect(he).not.toMatch(/מ\s+\{channel\}/);
  });

  it('keeps the space the Latin languages need', () => {
    const en = values.find(v => v.startsWith('Most came from'))!;
    const es = values.find(v => v.startsWith('La mayor'))!;

    expect(en.replace('{channel}', 'other sites')).toBe('Most came from other sites');
    expect(es.replace('{channel}', 'otros sitios')).toBe('La mayoría llegó desde otros sitios');
  });

  it('is interpolated at the call site, not concatenated', () => {
    const dashboard = readFileSync(
      join(__dirname, '..', '..', '..', 'components', 'business-os', 'insight', 'LiveDashboard.tsx'),
      'utf8'
    );

    expect(dashboard).toContain("t('verdict.live.via', { channel:");
    // The old shape: the key, then a space, then the label.
    expect(dashboard).not.toMatch(/t\('verdict\.live\.via'\)[^}]*\}\s+\$\{topLeadChannel\.label\}/);
  });
});
