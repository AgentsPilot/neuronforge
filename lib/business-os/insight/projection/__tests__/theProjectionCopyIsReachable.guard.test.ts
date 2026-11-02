/**
 * Every line the projection emits has copy, and every line of copy is emitted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BOTH DIRECTIONS, BECAUSE BOTH HAVE SHIPPED
 *
 * `ImpactProjector` runs on the server and hands the client a translation KEY
 * plus params, so the client renders whatever the key resolves to. That makes
 * two independent ways to be wrong, and nothing fails loudly in either:
 *
 *   a key with no copy      the raw key goes on screen. This is how
 *                           `journey.meta.total_bookings` reached a dashboard.
 *
 *   copy with no key        the string exists, reads correctly in review, and
 *                           is never rendered. The card keeps showing the old
 *                           line and the fix looks done.
 *
 * The second is why this file exists. `insight.cash_ar_overdue.do_nothing_detail_one`
 * was added in three languages to fix "~1 שעות" — a plural noun on a count of
 * one, which Hebrew does not form by adding a letter — and the projector was
 * never changed to emit it. Three correct translations, zero effect, and the
 * work was reported as finished.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPED TO THE `insight.` NAMESPACE ON PURPOSE
 *
 * Other `_one` keys in the file are not singular variants at all — `chat.which_one`,
 * `config.services.pick_one`, `usage.less_than_one` — and `automation.unit.*_one`
 * is built at the call site as `${unit}${count === 1 ? '_one' : ''}`, so no
 * literal exists to find. An allow-list covering those would be a list someone
 * has to maintain, and a guard nobody maintains is a guard that gets widened
 * until it passes. The insight namespace needs no exceptions.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..', '..', '..', '..');
const PROJECTOR = readFileSync(join(__dirname, '..', 'ImpactProjector.ts'), 'utf8');

function translations(language: 'en' | 'he' | 'es'): string {
  return readFileSync(join(ROOT, 'lib', 'business-os', 'translations', `${language}.ts`), 'utf8');
}

/** Every `key: '...'` literal the projector hands the client. */
function emittedKeys(): string[] {
  const found = PROJECTOR.matchAll(/\bkey:\s*'([a-z0-9_.]+)'/g);
  return [...new Set([...found].map(m => m[1]))];
}

/**
 * Every source file that could reference a key, excluding the copy itself.
 *
 * The translation files obviously contain every key; counting them as a
 * reference is what would make the second direction vacuous.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue;

    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (path.includes(join('business-os', 'translations'))) continue;
      sourceFiles(path, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(path);
    }
  }
  return out;
}

let CODE = '';
beforeAll(() => {
  /* Read once. `lib` and `components` are where keys are emitted and rendered;
     `app` routes forward them without naming them. */
  CODE = [...sourceFiles(join(ROOT, 'lib')), ...sourceFiles(join(ROOT, 'components'))]
    .map(file => readFileSync(file, 'utf8'))
    .join('\n');
});

describe('every key the projector emits has copy', () => {
  it.each([['en'], ['he'], ['es']])('in %s', language => {
    const copy = translations(language as 'en' | 'he' | 'es');
    const missing = emittedKeys().filter(key => !copy.includes(`'${key}'`));

    expect(missing).toEqual([]);
  });

  it('emits something at all, so the check above is not vacuous', () => {
    /* A refactor that stopped putting literal keys in this file would make
       every assertion above pass over an empty list. */
    expect(emittedKeys().length).toBeGreaterThan(10);
  });
});

describe('every insight singular variant is actually emitted', () => {
  it('has no copy nothing renders', () => {
    /*
     * THE BUG THIS FILE IS FOR. A `_one` string that no code asks for is a
     * plural still on screen and a fix that looks finished.
     */
    const singulars = [...translations('en').matchAll(/'(insight\.[a-z0-9_.]+_one)'/g)].map(m => m[1]);

    const orphaned = singulars.filter(key => !CODE.includes(`'${key}'`));

    expect(orphaned).toEqual([]);
  });

  it('carries the singular in every language where the plural exists', () => {
    /*
     * A singular in English only leaves the languages that NEED it — Hebrew
     * does not pluralise by adding a letter — falling back to the key or to
     * the wrong form.
     */
    const singulars = [...translations('en').matchAll(/'(insight\.[a-z0-9_.]+_one)'/g)].map(m => m[1]);

    for (const language of ['he', 'es'] as const) {
      const copy = translations(language);
      expect(singulars.filter(key => !copy.includes(`'${key}'`))).toEqual([]);
    }
  });
});
