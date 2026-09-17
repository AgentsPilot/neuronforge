/**
 * C-26 — the FALLBACK_COPY ↔ `en` equality must be a test, not a comment.
 *
 * `DangerZonePanel` renders on surfaces both inside and outside a
 * `LanguageProvider`:
 *
 *   - /business-os/settings  → provider present  → strings come from `en`
 *   - /v2/settings, /settings → no provider      → strings come from FALLBACK_COPY
 *
 * So the same panel is built from two independent sources of copy. A comment
 * saying "keep these identical" is not a mechanism: the two would drift the
 * first time someone edited one of them, and the drift would be invisible —
 * each surface looks fine in isolation, and nobody opens both at once.
 *
 * This asserts they are byte-identical, so the drift fails CI instead.
 */

import fs from 'fs';
import path from 'path';

const PANEL_PATH = path.join(__dirname, '..', 'DangerZonePanel.tsx');
const LANG_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'lib',
  'business-os',
  'LanguageContext.tsx'
);

/**
 * Parse `'key': 'value'` / `'key':\n  'value'` pairs out of a source region.
 *
 * Deliberately source-parsing rather than importing: importing
 * `LanguageContext.tsx` would pull in React context and a ~10,000-line module
 * into a unit test, and `translations` is not exported anyway.
 */
function parsePairs(source: string, keys: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    const re = new RegExp(`'${key.replace(/\./g, '\\.')}':\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`);
    const m = source.match(re);
    if (m) out[key] = m[1];
  }
  return out;
}

describe('DangerZonePanel copy', () => {
  const panelSource = fs.readFileSync(PANEL_PATH, 'utf-8');
  const langSource = fs.readFileSync(LANG_PATH, 'utf-8');

  // The FALLBACK_COPY object literal, isolated so the panel's own JSX and
  // comments cannot contribute stray matches.
  const fallbackBlock = panelSource.slice(
    panelSource.indexOf('const FALLBACK_COPY'),
    panelSource.indexOf('};', panelSource.indexOf('const FALLBACK_COPY'))
  );

  const fallbackKeys = Array.from(fallbackBlock.matchAll(/'([a-z0-9_.]+)':/g)).map(
    (m) => m[1]
  );

  // The `en` block is the first translations block in LanguageContext.
  const enBlock = langSource.slice(
    langSource.indexOf('const translations'),
    langSource.indexOf("  es: {")
  );

  it('parses a non-empty fallback set (guards against a vacuous pass)', () => {
    // Without this, a regex that matched nothing would make every assertion
    // below trivially true — the characteristic failure of source-parsing tests.
    expect(fallbackKeys.length).toBeGreaterThanOrEqual(8);
  });

  it('every fallback key exists in the `en` translations', () => {
    const en = parsePairs(enBlock, fallbackKeys);
    const missing = fallbackKeys.filter((k) => !(k in en));
    expect(missing).toEqual([]);
  });

  it('every fallback string is byte-identical to its `en` value', () => {
    const en = parsePairs(enBlock, fallbackKeys);
    const fallback = parsePairs(fallbackBlock, fallbackKeys);

    const drifted = fallbackKeys
      .filter((k) => en[k] !== undefined && fallback[k] !== undefined)
      .filter((k) => en[k] !== fallback[k])
      .map((k) => ({ key: k, en: en[k], fallback: fallback[k] }));

    expect(drifted).toEqual([]);
  });

  it('holds a usable erasure contact, in exactly one place, still marked as temporary', () => {
    // N2. The address was `TODO-ERASURE-CONTACT@example.invalid` — deliberately
    // fake, so it could not ship unnoticed. It is now the product owner's real
    // address as an interim unblock, which means the old `.invalid` assertion
    // would fail for the right reason and the wrong one at the same time.
    //
    // Rather than delete the assertion — letting its meaning lapse silently
    // along with the placeholder — it is re-pointed at the properties that
    // still matter:
    //   * the address is real enough to receive mail,
    //   * it exists in exactly ONE place, so a swap is a one-line change,
    //   * and it is still findable by a single grep.
    const match = panelSource.match(
      /export const PLACEHOLDER_ERASURE_CONTACT = '([^']+)';/
    );
    expect(match).not.toBeNull();

    const address = match![1];
    expect(address.length).toBeGreaterThan(5);
    expect(address).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);

    // Exactly one definition — no second copy to drift.
    expect(panelSource.match(/PLACEHOLDER_ERASURE_CONTACT = /g)).toHaveLength(1);

    // Still greppable. The marker lives in the comment, not the address, so the
    // address stays valid while the reminder survives.
    expect(panelSource).toContain('TEMP-ERASURE-CONTACT');
  });
});
