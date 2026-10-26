/**
 * Money MK-3a source guards for the AI cost page (workplan §8, T-13; SA-6,
 * SA-11 / FC-9, USD-6; SA-WP-MK3 conditions 5 and 7).
 *
 *   G-1 (SA-6) no non-test file under app/, lib/, components/ or hooks/ names
 *       an old cost-report address in code (comments stripped): the Charge
 *       checks page `/admin/finance/charges`, and the Business OS AI tab
 *       `business-os-llm?tab=costs` (QA L-1: Model pricing's margin link used
 *       it). Both only redirect now (`next.config.js`, which holds them as
 *       redirect sources and is not scanned here). MK-3b adds AI calls &
 *       usage, `/admin/analytics`, which left the disk too (the Calls tab):
 *       a string that starts with that path, not an import of a module that
 *       still lives in `app/admin/analytics/`.
 *   G-2 (USD-6) no AI cost page file (its folder and the report's components
 *       and copy) writes a money string as "USD <amount>"; labels such as
 *       "(USD)" pass, as in Finance's copy guard.
 *   G-3 (SA-11, FC-9) the generic names `costs`, `grossMargin`,
 *       `operatingMargin` and `OtherCosts*` are not declared in the AI cost
 *       page's own files: the page stays AI-specific so a later "Costs" view
 *       can take those names.
 *   G-4 (AI cost page) the page names no Stripe mode, reads nothing itself (no
 *       `fetch(`, no `.json(`), and logs through no `console.`.
 *
 * Every rule is a pure function run on the real files AND on a planted
 * control that must trip it: a rule that cannot match looks exactly like a
 * rule that found nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__snapshots__' || entry.name === 'node_modules') continue;
      walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(rel);
    }
  }
  return out.sort();
}

// ── G-1: no in-app link relies on the redirect ────────────────────────────────
const OLD_CHARGES = '/admin/finance/charges';
/** QA L-1: the M-5 tab address; `tab=costs` with any key order after the page path. */
const OLD_COSTS_TAB = /\/admin\/business-os-llm\?(?:[^'"`\s]*&)?tab=costs\b/;
/** MK-3b: a string that starts with the old AI calls & usage address (an `@/app/admin/analytics/…` import does not). */
const OLD_ANALYTICS = /['"`]\/admin\/analytics\b/;
const namesOldAddress = (raw: string): boolean => {
  const code = stripComments(raw);
  return code.includes(OLD_CHARGES) || OLD_COSTS_TAB.test(code) || OLD_ANALYTICS.test(code);
};

describe('G-1 (SA-6): nothing in the app names the old Charge checks address in code', () => {
  const files = ['app', 'lib', 'components', 'hooks'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(d));

  it('walks the app (non-vacuity)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain('app/admin/finance/financeLinks.ts');
    expect(files).toContain('app/admin/ai-cost/page.tsx');
  });

  it('no file names it in code', () => {
    expect(files.filter((file) => namesOldAddress(read(file)))).toEqual([]);
  });

  it('the rule bites (planted), and a comment does not trip it', () => {
    expect(namesOldAddress(`const href = '${OLD_CHARGES}?account=1';`)).toBe(true);
    expect(namesOldAddress("const href = '/admin/business-os-llm?tab=costs';")).toBe(true);
    expect(namesOldAddress("const href = `/admin/business-os-llm?range=7d&tab=costs`;")).toBe(true);
    expect(namesOldAddress("const href = '/admin/business-os-llm?tab=activity';")).toBe(false);
    expect(namesOldAddress("const href = '/admin/analytics?scope=bos';")).toBe(true);
    expect(namesOldAddress('const href = `/admin/analytics`;')).toBe(true);
    expect(namesOldAddress("import { CallsTab } from '@/app/admin/analytics/components/CallsTab';")).toBe(false);
    expect(namesOldAddress("// was '/admin/business-os-llm?tab=costs'\nconst a = 1;")).toBe(false);
    expect(namesOldAddress(`// was ${OLD_CHARGES}\nconst a = 1;`)).toBe(false);
  });

  it('the old page file is gone and the redirects hold both addresses', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/admin/finance/charges/page.tsx'))).toBe(false);
    expect(read('next.config.js')).toContain(`source: '${OLD_CHARGES}'`);
    expect(read('next.config.js')).toContain("has: [{ type: 'query', key: 'tab', value: 'costs' }]");
    expect(fs.existsSync(path.join(ROOT, 'app/admin/analytics/page.tsx'))).toBe(false);
    expect(read('next.config.js')).toContain("source: '/admin/analytics'");
  });

  it('QA L-1: the margin-review link goes straight to the AI cost page', () => {
    expect(read('app/admin/system-config/priceApply.ts')).toContain("CREDIT_PRICING_VIEW_URL = '/admin/ai-cost?tab=checks'");
  });
});

// ── G-2, G-3, G-4: the AI cost page's own files ──────────────────────────────
const PAGE_FILES = [
  ...walk('app/admin/ai-cost'),
  // MK-3b: the Calls tab's files.
  ...walk('app/admin/analytics'),
  ...walk('app/admin/business-os-llm/components/costs'),
  'app/admin/business-os-llm/costCopy.ts',
  'app/admin/business-os-llm/leakCopy.ts',
  'app/admin/business-os-llm/costFormat.ts',
];

/** Finance's copy-guard shape (USD-6): a code glued to an amount. */
const USD_MONEY = /USD -?\d|`USD \$\{|['"]USD ['"]|USD \$\{/;
/** FC-9: a declaration of a reserved generic name. */
const GENERIC_NAME = /\b(?:const|let|var|function|interface|type|class)\s+(?:costs|grossMargin|operatingMargin|OtherCosts\w*)\b/;
const MODE_WORD = /\blivemode\b|test mode|live mode|stripeMode/i;

describe('G-2 / G-3 / G-4: the AI cost page files', () => {
  it('scans the page and the report files (non-vacuity)', () => {
    for (const file of [
      'app/admin/ai-cost/page.tsx',
      'app/admin/ai-cost/aiCostCopy.ts',
      'app/admin/business-os-llm/components/costs/AiCostKpis.tsx',
      'app/admin/business-os-llm/components/costs/RecordedSection.tsx',
      'app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx',
    ]) {
      expect(PAGE_FILES).toContain(file);
    }
  });

  it.each(PAGE_FILES)('%s: no "USD " money string (USD-6)', (file) => {
    expect(USD_MONEY.test(stripComments(read(file)))).toBe(false);
  });

  it.each(PAGE_FILES)('%s: no reserved generic cost name is declared (SA-11, FC-9)', (file) => {
    expect(GENERIC_NAME.test(stripComments(read(file)))).toBe(false);
  });

  it.each(PAGE_FILES)('%s: names no Stripe mode', (file) => {
    expect(MODE_WORD.test(stripComments(read(file)))).toBe(false);
  });

  it('the page reads nothing itself and logs through no console', () => {
    const code = stripComments(read('app/admin/ai-cost/page.tsx'));
    expect(code).not.toMatch(/\bfetch\(/);
    expect(code).not.toMatch(/\.json\(/);
    expect(code).not.toMatch(/\bconsole\./);
  });

  it('the rules bite (planted controls)', () => {
    expect(USD_MONEY.test("const s = `USD ${amount}`;")).toBe(true);
    expect(USD_MONEY.test("const s = 'USD 3.50';")).toBe(true);
    expect(USD_MONEY.test("const label = 'Charged AI cost (USD)';")).toBe(false);
    expect(GENERIC_NAME.test('const costs = [];')).toBe(true);
    expect(GENERIC_NAME.test('export function grossMargin() {}')).toBe(true);
    expect(GENERIC_NAME.test('interface OtherCostsLine {}')).toBe(true);
    expect(GENERIC_NAME.test('const aiCosts = [];')).toBe(false);
    expect(GENERIC_NAME.test('const costsFiles = [];')).toBe(false);
    expect(MODE_WORD.test('if (row.livemode) {}')).toBe(true);
  });
});
