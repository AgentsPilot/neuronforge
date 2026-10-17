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
  'translations',
  'en.ts'
);

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const CONTACT_FILE = 'lib/business-os/supportContact.ts';
const CONTACT_DEFINITION = /export const PLACEHOLDER_ERASURE_CONTACT = '([^']+)';/;

/**
 * Files that contain the same address for a reason unrelated to the contact,
 * with why. Not a contact surface; adding one needs SA review.
 */
const ADDRESS_ALLOWED_FILES: Record<string, string> = {
  'lib/agentkit/v6/translation/NaturalLanguageCorrectionHandler.ts':
    'example text inside a V6 prompt ("Add CC to …"), predates N2; the V6 pipeline is parked',
};

type Source = { file: string; source: string };

/** Non-test code files under app/, components/ and lib/. */
function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

const SOURCES: Source[] = ['app', 'components', 'lib']
  .flatMap((dir) => walk(path.join(ROOT, dir)))
  .map((full) => ({ file: path.relative(ROOT, full).split(path.sep).join('/'), source: fs.readFileSync(full, 'utf-8') }));

function definitionsOf(sources: Source[]): string[] {
  return sources.filter(({ source }) => /PLACEHOLDER_ERASURE_CONTACT\s*=/.test(source)).map(({ file }) => file);
}

function filesNamingAddress(sources: Source[], address: string): string[] {
  return sources
    .filter(({ file, source }) => file !== CONTACT_FILE && !(file in ADDRESS_ALLOWED_FILES) && source.includes(address))
    .map(({ file }) => file);
}

/**
 * Parse `'key': 'value'` / `'key':\n  'value'` pairs out of a source region.
 *
 * Deliberately source-parsing rather than importing: the English dictionary
 * now has its own module, but reaching it through `LanguageContext` would still
 * pull React context into a unit test. Reading the one file is cheaper and says
 * the same thing.
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
  const contactSource = fs.readFileSync(path.join(ROOT, CONTACT_FILE), 'utf-8');

  // The FALLBACK_COPY object literal, isolated so the panel's own JSX and
  // comments cannot contribute stray matches.
  const fallbackBlock = panelSource.slice(
    panelSource.indexOf('const FALLBACK_COPY'),
    panelSource.indexOf('};', panelSource.indexOf('const FALLBACK_COPY'))
  );

  const fallbackKeys = Array.from(fallbackBlock.matchAll(/'([a-z0-9_.]+)':/g)).map(
    (m) => m[1]
  );

  /*
   * The whole file IS the English block now.
   *
   * It used to be sliced out of `LanguageContext.tsx` between `const
   * translations` and `  es: {` — a slice that silently became empty the day
   * the dictionaries moved into modules of their own, which is what this
   * comment is here to stop happening twice.
   */
  const enBlock = langSource;

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
    //
    // Data export DE-9 (SA C-3) moved the constant, unchanged, to the neutral
    // lib/business-os/supportContact.ts so the Danger zone and the "Download
    // my data" control both read it without importing each other. The pin is
    // now repo-wide (app/, components/, lib/), not this one file.
    const match = contactSource.match(CONTACT_DEFINITION);
    expect(match).not.toBeNull();

    const address = match![1];
    expect(address.length).toBeGreaterThan(5);
    expect(address).toMatch(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i);

    // Exactly one definition across app/, components/ and lib/ — no second copy to drift.
    expect(definitionsOf(SOURCES)).toEqual([CONTACT_FILE]);

    // The address literal is in no other source file: every surface reads the constant.
    expect(filesNamingAddress(SOURCES, address)).toEqual([]);

    // The panel reads the constant rather than defining it.
    expect(panelSource).toMatch(/import \{ PLACEHOLDER_ERASURE_CONTACT \} from '@\/lib\/business-os\/supportContact'/);

    // Still greppable. The marker lives in the comment, not the address, so the
    // address stays valid while the reminder survives.
    expect(contactSource).toContain('TEMP-ERASURE-CONTACT');
  });

  it('the scan reaches the sources it pins (not vacuous)', () => {
    expect(SOURCES.length).toBeGreaterThan(500);
    expect(SOURCES.map((s) => s.file)).toEqual(expect.arrayContaining([CONTACT_FILE, 'components/business-os/purge/DangerZonePanel.tsx']));
  });

  it('negative controls: a second definition or a pasted address is caught', () => {
    const planted = [
      { file: CONTACT_FILE, source: "export const PLACEHOLDER_ERASURE_CONTACT = 'a@b.co';" },
      { file: 'components/x/Other.tsx', source: "export const PLACEHOLDER_ERASURE_CONTACT = 'a@b.co';" },
      { file: 'components/y/Mailto.tsx', source: 'const href = "mailto:a@b.co";' },
    ];
    expect(definitionsOf(planted)).toEqual([CONTACT_FILE, 'components/x/Other.tsx']);
    expect(filesNamingAddress(planted, 'a@b.co')).toEqual(['components/x/Other.tsx', 'components/y/Mailto.tsx']);
    // An allow-listed file is not reported.
    expect(filesNamingAddress([{ file: Object.keys(ADDRESS_ALLOWED_FILES)[0], source: 'a@b.co' }], 'a@b.co')).toEqual([]);
  });
});
