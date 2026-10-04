/**
 * One definition of the credit bands (credit deduction slice 8a; FR-47,
 * AC-41; SA SQ-39, condition 3, C-W1).
 *
 *   1. `creditBands.ts` imports nothing (the admin screen and the card load it).
 *   2. Every consumer imports it: the card, the admin column and the admin
 *      batch (slice 8b adds the low-line record).
 *   3. No cut-off is defined or compared anywhere else in scope: the named
 *      consumers, every non-test file in `lib/business-os/credits/` except the
 *      band module, and every non-test file under `app/admin/users/`. (Scoped,
 *      not the whole `components/business-os/` tree: unrelated `minutes >= 60`
 *      style comparisons live there — SA C-W1.)
 *   4. `LOW_THRESHOLD` exists nowhere in product code.
 *
 * Every rule is proved on planted samples first.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Comments removed: prose about a cut-off is not a cut-off. */
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const BANDS = 'lib/business-os/credits/creditBands.ts';
const CONSUMERS = [
  'components/business-os/UsageCard.tsx',
  'app/admin/users/components/CreditsLeftCell.tsx',
  'lib/business-os/credits/adminCreditPercent.ts',
  // Slice 8b: the low-line audit record.
  'lib/business-os/credits/creditLowLine.ts',
];

/** Product files under a directory (no tests, no declarations). */
function productFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
      if (['node_modules', '.next', '__tests__'].includes(entry.name)) continue;
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out;
}

const SCOPE = [
  ...new Set([
    ...CONSUMERS,
    ...productFiles('lib/business-os/credits').filter((file) => file !== BANDS),
    ...productFiles('app/admin/users'),
  ]),
].sort();

const N = String.raw`(?:60|30|10|20|0?\.6|0?\.3|0?\.1|0?\.2)`;
/**
 * A comparison against a cut-off, either side of `<`, `<=`, `>`, `>=`. Not an
 * arrow (`=> 10`), and not JSX text (`<b>10</b>`).
 */
const CUT_OFF_COMPARISON = new RegExp(
  // A number followed by a bare `<` is JSX text closing (`>10</b>`, `>10<`), not a comparison.
  String.raw`(?<!=)(?:<=?|>=?)\s*${N}(?![\d.])(?!\s*<(?!=))` + '|' + String.raw`(?<![\w.>])${N}\s*(?:<=?|>=?)(?!\s*\/)`
);
const CUT_OFF_DEFINITION = /\b(?:const|let|var)\s+(?:LOW_THRESHOLD|LOW_LINE\w*)\b/;

describe('the rules match planted samples', () => {
  it.each([
    'const isLow = share <= 0.2;',
    'if (pct >= 60) return "green";',
    'return 10 > p;',
    'x < 30 ? a : b',
    'value>=.1',
    '0.6 <= share',
  ])('matches the comparison %s', (sample) => {
    expect(CUT_OFF_COMPARISON.test(sample)).toBe(true);
  });

  it.each([
    'marginTop: 10,',
    'width: 156,',
    '<span>10</span>',
    '<td>>10<</td>',
    'const f = () => 10;',
    'x >= 100',
    'x < 0.25',
    'pageSize: 1_000',
    'Array.from({ length: 30 })',
  ])('does not match %s', (sample) => {
    expect(CUT_OFF_COMPARISON.test(sample)).toBe(false);
  });

  it('JSX text like ">10<" is not a comparison (SA C-W1)', () => {
    expect(CUT_OFF_COMPARISON.test('<p className="x">10</p>')).toBe(false);
    expect(CUT_OFF_COMPARISON.test('return <b>>10<</b>;')).toBe(false);
  });

  it('matches a planted definition', () => {
    expect(CUT_OFF_DEFINITION.test('const LOW_THRESHOLD = 0.2;')).toBe(true);
    expect(CUT_OFF_DEFINITION.test('export const LOW_LINE_PERCENT = 10;')).toBe(true);
    expect(CUT_OFF_DEFINITION.test('import { LOW_LINE_PERCENT } from "./creditBands";')).toBe(false);
  });
});

describe('1–2. the band module is the one definition, and every consumer imports it', () => {
  it('creditBands.ts imports nothing', () => {
    const code = codeOf(read(BANDS));
    expect(code).not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/\brequire\s*\(/);
  });

  it.each(CONSUMERS)('%s imports the band module', (file) => {
    expect(codeOf(read(file))).toMatch(/from\s+['"](?:@\/lib\/business-os\/credits|\.)\/creditBands['"]/);
  });
});

describe('3. no other file in scope defines or compares a cut-off (SA C-W1)', () => {
  it('the scope is real: the consumers, the credits directory and the admin Businesses screen', () => {
    for (const file of CONSUMERS) expect(SCOPE).toContain(file);
    expect(SCOPE).toContain('lib/business-os/credits/ownerCreditUsage.ts');
    expect(SCOPE).toContain('app/admin/users/page.tsx');
    expect(SCOPE).not.toContain(BANDS);
    expect(SCOPE.some((file) => file.includes('__tests__'))).toBe(false);
  });

  it.each(SCOPE)('%s passes today', (file) => {
    const code = codeOf(read(file));
    expect(code.match(CUT_OFF_COMPARISON)?.[0] ?? null).toBeNull();
    expect(code).not.toMatch(CUT_OFF_DEFINITION);
  });
});

describe('4. LOW_THRESHOLD exists nowhere in product code', () => {
  it('no product file under app/, components/, lib/ or hooks/ names it', () => {
    const found = ['app', 'components', 'lib', 'hooks']
      .filter((dir) => fs.existsSync(path.join(ROOT, dir)))
      .flatMap((dir) => productFiles(dir))
      .filter((file) => /\bLOW_THRESHOLD\b/.test(read(file)));
    expect(found).toEqual([]);
  });
});
