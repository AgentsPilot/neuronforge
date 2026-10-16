/**
 * @jest-environment node
 *
 * The finance page's source guards (slice 1a, T14): no repository import (the
 * page reads only through its admin route), no `console.`, `useSearchParams`
 * inside a Suspense boundary, and no `route.ts` anywhere under `app/admin` (the
 * page is gated by the admin layout).
 *
 * Finance F-4: the URL is the shared `useAdminFilters` hook's (S-6: only the
 * hook writes history), so no page file calls the router or `history.*`; the
 * local chip renderer is gone (the shared bar renders the chip); and the URL
 * notice is gone (BD-30), so the shared states import no longer needs it.
 *
 * Money M-1 (finance health §11D.7) adds, each with a planted negative control:
 * the local chip renderer stays local and unexported (SA-WR-39); the new M-1
 * page files use no dim text (SA-W69); the picked business name never reaches
 * the URL or a request (AC-109); the header and summary hold no `.reduce(`
 * (AC-112); and the links file imports no other admin page (SA-W56).
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const DIR = path.join(ROOT, 'app', 'admin', 'finance');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = walk(DIR);
const read = (file: string) => fs.readFileSync(file, 'utf8');
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/');

describe('app/admin/finance source guards', () => {
  it('scans the page files (non-vacuity)', () => {
    expect(files.map(rel)).toEqual(
      expect.arrayContaining(['app/admin/finance/page.tsx', 'app/admin/finance/components/FinanceView.tsx'])
    );
  });

  it('imports no repository and no server-only module', () => {
    for (const file of files) {
      expect({ file: rel(file), repo: /@\/lib\/repositories/.test(read(file)) }).toEqual({ file: rel(file), repo: false });
      expect({ file: rel(file), serverOnly: /['"]server-only['"]/.test(read(file)) }).toEqual({ file: rel(file), serverOnly: false });
    }
  });

  it('imports from lib/business-os/finance only types (the wire types)', () => {
    for (const file of files) {
      for (const line of read(file).split('\n')) {
        if (/from ['"]@\/lib\/business-os\/finance\//.test(line)) {
          expect({ file: rel(file), line }).toEqual({ file: rel(file), line: expect.stringMatching(/^import type /) });
        }
      }
    }
  });

  it('never uses console', () => {
    for (const file of files) expect({ file: rel(file), console: /\bconsole\./.test(read(file)) }).toEqual({ file: rel(file), console: false });
  });

  it('the page is a client component (authz guard R8, OI-21) and wraps the view in Suspense (useSearchParams in Next 14)', () => {
    const page = read(path.join(DIR, 'page.tsx'));
    expect(page).toMatch(/^['"]use client['"];/);
    expect(page).toMatch(/<Suspense[\s\S]*<FinanceView \/>[\s\S]*<\/Suspense>/);
  });

  // Finance F-4 (S-6, U-2): the hook writes the address bar; no page file does.
  const URL_WRITER = /\brouter\.(?:replace|push)\(|\bhistory\.(?:replaceState|pushState)\(|\buseRouter\(/;
  it('the URL-writer rule bites (planted)', () => {
    expect(URL_WRITER.test("router.replace(`/admin/finance?${qs}`, { scroll: false });")).toBe(true);
    expect(URL_WRITER.test('router.push(href);')).toBe(true);
    expect(URL_WRITER.test("window.history.replaceState(null, '', url);")).toBe(true);
    expect(URL_WRITER.test("window.history.pushState(null, '', url);")).toBe(true);
    expect(URL_WRITER.test('const router = useRouter();')).toBe(true);
    expect(URL_WRITER.test('setFilters({ window: next });')).toBe(false);
  });

  it('F-4: FinanceView takes its state from useAdminFilters(FINANCE_FILTER_SPEC); no page file writes the URL itself', () => {
    const view = codeOf(path.join(DIR, 'components', 'FinanceView.tsx'));
    expect(view).toMatch(/useAdminFilters\(FINANCE_FILTER_SPEC\)/);
    expect(view).toMatch(/import \{ useAdminFilters \} from '@\/app\/admin\/components\/layout\/useAdminFilters'/);
    expect(view).not.toMatch(/useSearchParams\(/);
    for (const file of files) expect({ file: rel(file), writesUrl: URL_WRITER.test(codeOf(file)) }).toEqual({ file: rel(file), writesUrl: false });
  });

  it('has no route.ts under app/admin (the layout gates the page; data comes from app/api/admin)', () => {
    const routes: string[] = [];
    const scan = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full);
        else if (/^route\.(ts|tsx|js)$/.test(entry.name)) routes.push(rel(full));
      }
    };
    scan(path.join(ROOT, 'app', 'admin'));
    expect(routes).toEqual([]);
  });
});

// Comments removed, so prose about a rule cannot trip it.
const codeOf = (file: string) =>
  read(file)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('Money M-1 source guards', () => {
  const BAR = path.join(DIR, 'components', 'FinanceFilterBar.tsx');
  const VIEW = path.join(DIR, 'components', 'FinanceView.tsx');
  const HEADER = path.join(DIR, 'components', 'AccountHeader.tsx');
  const SUMMARY = path.join(DIR, 'components', 'AccountSummary.tsx');
  const LINKS = path.join(DIR, 'financeLinks.ts');
  const ACCOUNT = path.join(DIR, 'financeAccount.ts');
  const M1_FILES = [HEADER, SUMMARY, LINKS, ACCOUNT];

  it('scans the new M-1 files (non-vacuity)', () => {
    expect(files.map(rel)).toEqual(expect.arrayContaining(M1_FILES.map(rel)));
  });

  // SA-WR-39, closed by Finance F-4: the local chip renderer is gone; the shared bar renders the chip.
  const CHIP_DEFINED = /function\s+FinanceActiveChip\b|(?:const|let|var)\s+FinanceActiveChip\b/;
  const CHIP_EXPORTED = /export\s+(?:default\s+)?(?:function|const|let|var)\s+FinanceActiveChip\b|export\s*\{[^}]*\bFinanceActiveChip\b/;
  const SHARED_BAR = /import\s*\{[^}]*\bAdminFilterBar\b[^}]*\}\s*from\s*'@\/app\/admin\/components\/layout\/AdminFilterBar'/;
  const SHARED_CHIP = /import\s*\{[^}]*\bbusinessFilterChip\b[^}]*\}\s*from\s*'@\/app\/admin\/components\/layout\/AdminBusinessPicker'/;

  it('SA-WR-39: the chip rules bite (planted)', () => {
    expect(CHIP_EXPORTED.test('export function FinanceActiveChip({ chip }) {}')).toBe(true);
    expect(CHIP_EXPORTED.test('export { FinanceActiveChip };')).toBe(true);
    expect(CHIP_EXPORTED.test('function FinanceActiveChip({ chip }) {}')).toBe(false);
    expect(CHIP_DEFINED.test('const FinanceActiveChip = () => null;')).toBe(true);
    expect(CHIP_DEFINED.test('function FinanceActiveChip({ chip }) {}')).toBe(true);
    expect("import { AdminFilterBar } from '@/app/admin/components/layout/AdminFilterBar';").toMatch(SHARED_BAR);
    expect("import { AdminFilterBar } from '../../components/layout/AdminFilterBar';").not.toMatch(SHARED_BAR);
    expect("import { AdminBusinessPicker, businessFilterChip } from '@/app/admin/components/layout/AdminBusinessPicker';").toMatch(SHARED_CHIP);
  });

  it('F-4 (AC-177): FinanceActiveChip is defined nowhere; FinanceFilterBar.tsx uses the shared AdminFilterBar and businessFilterChip by alias', () => {
    expect(files.filter((file) => CHIP_DEFINED.test(codeOf(file))).map(rel)).toEqual([]);
    for (const file of files) expect({ file: rel(file), exported: CHIP_EXPORTED.test(codeOf(file)) }).toEqual({ file: rel(file), exported: false });
    const bar = codeOf(BAR);
    expect(bar).toMatch(SHARED_BAR);
    expect(bar).toMatch(SHARED_CHIP);
    expect(bar).toMatch(/<AdminFilterBar\b/);
    expect(bar).toMatch(/businessFilterChip\(/);
  });

  // SA-W69: the new M-1 files are held to text-slate-400.
  const DIM_TEXT = /(^|[^a-zA-Z0-9-])text-slate-[56]00([^0-9]|$)/;
  it('the dim-text rule bites (planted)', () => {
    expect(DIM_TEXT.test('className="text-xs text-slate-500"')).toBe(true);
    expect(DIM_TEXT.test('className="hover:text-slate-600"')).toBe(true);
    expect(DIM_TEXT.test('className="text-slate-400 border-slate-500"')).toBe(false);
  });

  it.each(M1_FILES.map(rel))('%s: no text-slate-500 or text-slate-600 (SA-W69)', (file) => {
    expect(DIM_TEXT.test(codeOf(path.join(ROOT, file)))).toBe(false);
  });

  // AC-109: the picked name never reaches the URL or a request.
  /** The argument text of every call to one of the sinks (Finance F-4: the hook's `setFilters(` too). */
  const sinkCalls = (code: string) =>
    [...code.matchAll(/(?:serialiseFinanceUrl|router\.replace|fetch|setFilters)\(([^;]*)/g)].map((m) => m[1]);
  it('the name-sink rule bites (planted)', () => {
    expect(sinkCalls('router.replace(`/x?${serialiseFinanceUrl({ ...q, name: pickedName })}`, { scroll: false });').some((a) => /pickedName/.test(a))).toBe(true);
    expect(sinkCalls('setPickedName({ accountId, name }); setQuery({ ...query, accountId });').some((a) => /pickedName/.test(a))).toBe(false);
    expect(sinkCalls('setFilters({ account, name: pickedName });').some((a) => /pickedName/.test(a))).toBe(true);
  });

  it('AC-109: in FinanceView.tsx, pickedName never appears in a serialiseFinanceUrl(, router.replace(, fetch( or setFilters( call; the hook takes the query string only', () => {
    const view = codeOf(VIEW);
    expect(view).toMatch(/pickedName/);
    expect(sinkCalls(view).length).toBeGreaterThan(0);
    expect(sinkCalls(view).filter((args) => args.length > 0).length).toBeGreaterThanOrEqual(5);
    for (const args of sinkCalls(view)) expect(args).not.toMatch(/pickedName|accountName|chipName/);
    // Finance F-2: the hook takes the query string and nothing else (fallbackError removed).
    expect(view).toMatch(/useFinanceData\(queryString\)/);
  });

  // AC-112: the header and summary select, they never fold.
  it('the reduce rule bites (planted), and neither the header nor the summary reduces', () => {
    expect(/\.reduce\(/.test('lines.reduce((a, l) => a + l.net, 0)')).toBe(true);
    for (const file of [HEADER, SUMMARY]) expect({ file: rel(file), reduce: /\.reduce\(/.test(codeOf(file)) }).toEqual({ file: rel(file), reduce: false });
  });

  // SA-W56: the links file names its paths as literals and imports no other admin page.
  it('financeLinks.ts imports only the wire types (planted control)', () => {
    const importsOf = (code: string) => [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    expect(importsOf("import { ACTIVITY_FILTER_SPEC } from '@/app/admin/business-os-llm/activityFilters';")).toEqual(['@/app/admin/business-os-llm/activityFilters']);
    expect(importsOf(codeOf(LINKS))).toEqual(['@/lib/business-os/finance/financeTypes']);
  });
});

// ── Slice 6a (Money M-3, M3-FR-13, AC-147, SA-Q43) ───────────────────────────
describe('slice 6a source guards (the Accounts tab)', () => {
  const TAB_FILES = ['AccountsTab.tsx', 'AccountEconomicsTable.tsx', 'FinanceTabs.tsx'].map((name) => path.join(DIR, 'components', name));
  const EDITED = [path.join(DIR, 'components', 'AccountSummary.tsx')];

  it('scans the new tab files (non-vacuity)', () => {
    expect(files.map(rel)).toEqual(expect.arrayContaining(TAB_FILES.map(rel)));
  });

  // M3-FR-13: the client formats only.
  const CLIENT_FOLD = /\.(sort|reduce|filter)\(/;
  it('the client-fold rule bites (planted)', () => {
    expect(CLIENT_FOLD.test('rows.sort((a, b) => a.cost - b.cost)')).toBe(true);
    expect(CLIENT_FOLD.test('rows.filter((r) => r.margin)')).toBe(true);
    expect(CLIENT_FOLD.test('rows.map((r) => r.accountId)')).toBe(false);
  });

  it.each(TAB_FILES.map(rel))('%s: no .sort(, .reduce( or .filter( (the server sorts, filters and caps)', (file) => {
    expect(CLIENT_FOLD.test(codeOf(path.join(ROOT, file)))).toBe(false);
  });

  // SA-WR-18 extended to the 6a fields (MONEY_5A itself is not edited).
  const MONEY_6A = '(?:afterTax|planAfterTax|boostsAfterTax|costUsd|marginUsd)';
  const MONEY_6A_ARITHMETIC = new RegExp(`\\b${MONEY_6A}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY_6A}\\b)`);
  it('the 6a money-arithmetic rule bites (planted)', () => {
    expect(MONEY_6A_ARITHMETIC.test('const m = line.afterTax - cost.costUsd;')).toBe(true);
    expect(MONEY_6A_ARITHMETIC.test('line.planAfterTax + line.boostsAfterTax')).toBe(true);
    expect(MONEY_6A_ARITHMETIC.test('formatUsd(margin.marginUsd)')).toBe(false);
  });

  it.each(files.map(rel))('%s: adds or subtracts no two 6a money fields', (file) => {
    expect(MONEY_6A_ARITHMETIC.test(codeOf(path.join(ROOT, file)))).toBe(false);
  });

  // SA-W69 held for the new and edited page files.
  const DIM_TEXT = /(^|[^a-zA-Z0-9-])text-slate-[56]00([^0-9]|$)/;
  it.each([...TAB_FILES, ...EDITED].map(rel))('%s: no text-slate-500 or text-slate-600', (file) => {
    expect(DIM_TEXT.test(codeOf(path.join(ROOT, file)))).toBe(false);
  });

  // SA-Q43: page-local tabs, no new shared export.
  const IMPORTS_TABS = /from\s+['"][^'"]*finance\/components\/FinanceTabs['"]/;
  it('the tabs-export rule bites (planted)', () => {
    expect(IMPORTS_TABS.test("import { FinanceTabs } from '@/app/admin/finance/components/FinanceTabs';")).toBe(true);
  });

  it('FinanceTabs is imported by no file outside app/admin/finance, and nothing is added to the shared layout folder', () => {
    const scan = (dir: string, out: string[] = []): string[] => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) scan(full, out);
        else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
      }
      return out;
    };
    const outside = scan(path.join(ROOT, 'app', 'admin')).filter((file) => !file.startsWith(DIR + path.sep));
    expect(outside.length).toBeGreaterThan(20);
    for (const file of outside) expect({ file: rel(file), imports: IMPORTS_TABS.test(read(file)) }).toEqual({ file: rel(file), imports: false });
    expect(fs.existsSync(path.join(ROOT, 'app', 'admin', 'components', 'layout', 'FinanceTabs.tsx'))).toBe(false);
  });
});

// Fix round 1 (QA B-1): the table links a row only when it is not a platform account AND has a plan row.
describe('fix round 1: which Accounts rows link', () => {
  const TABLE = path.join(DIR, 'components', 'AccountEconomicsTable.tsx');
  const LINK_RULE = /const linked = row\.kind !== 'platform' && !row\.noPlanRow;/;
  it('the link-rule pin bites (planted): the old platform-only rule is caught', () => {
    expect(LINK_RULE.test("const linked = row.kind !== 'platform';")).toBe(false);
    expect(LINK_RULE.test("const linked = row.kind !== 'platform' && !row.noPlanRow;")).toBe(true);
  });
  it('AccountEconomicsTable.tsx links neither platform rows nor "No plan row" accounts, and gates every Link on `linked`', () => {
    const code = codeOf(TABLE);
    expect(code).toMatch(LINK_RULE);
    expect(code.match(/<Link\b/g)).toHaveLength(1);
    expect(code).toMatch(/\{linked && \(\s*<Link\b/);
  });
});

// ── Money M-4 (OV-5, M4-FR-11, AC-158, T12-B) ────────────────────────────────
describe('Money M-4 source guards (the recorded block and the summary line)', () => {
  const LINES = path.join(DIR, 'components', 'RecordedCostLines.tsx');
  const SECTION3 = path.join(DIR, 'components', 'AiCostSection.tsx');
  const SUMMARY = path.join(DIR, 'components', 'AccountSummary.tsx');

  it('scans the new file (non-vacuity)', () => {
    expect(files.map(rel)).toEqual(expect.arrayContaining([rel(LINES)]));
    expect(codeOf(LINES).length).toBeGreaterThan(1000);
  });

  // M4-FR-11 / SA-WR-18 extended to the M-4 fields (MONEY_6A itself is not edited).
  const MONEY_M4 = '(?:recordedUsd|chargedAboveUsd|usd|costUsd)';
  const MONEY_M4_ARITHMETIC = new RegExp(`\\b${MONEY_M4}\\b\\s*(?:[-+]=|[-+]\\s*[\\w.?!()]*\\b${MONEY_M4}\\b)`);
  it('the M-4 money-arithmetic rule bites (planted)', () => {
    expect(MONEY_M4_ARITHMETIC.test('const t = recorded.recordedUsd + f.costUsd;')).toBe(true);
    expect(MONEY_M4_ARITHMETIC.test('const d = recorded.recordedUsd - aiCost.figures.costUsd;')).toBe(true);
    expect(MONEY_M4_ARITHMETIC.test('above.usd + recorded.chargedAboveUsd')).toBe(true);
    expect(MONEY_M4_ARITHMETIC.test('formatUsd(recorded.recordedUsd)')).toBe(false);
  });

  it.each(files.map(rel))('%s: adds or subtracts no two M-4 money fields', (file) => {
    expect(MONEY_M4_ARITHMETIC.test(codeOf(path.join(ROOT, file)))).toBe(false);
  });

  // SA-W69 / LF-1: the new file is held to text-slate-400.
  const DIM_TEXT = /(^|[^a-zA-Z0-9-])text-slate-[56]00([^0-9]|$)/;
  it('RecordedCostLines.tsx: no text-slate-500 or text-slate-600; types only from lib/business-os/finance', () => {
    expect(DIM_TEXT.test(codeOf(LINES))).toBe(false);
    const financeImports = read(LINES).split('\n').filter((line) => /from ['"]@\/lib\/business-os\/finance\//.test(line));
    expect(financeImports.length).toBe(1);
    for (const line of financeImports) expect(line).toMatch(/^import type /);
  });

  // AC-158: one renderer of "Recorded above charged", used by Section 3's block and the summary.
  const DEFINES_RENDERER = /function\s+RecordedAboveValue\b|(?:const|let|var)\s+RecordedAboveValue\b/;
  const READS_STATE = /\baboveCharged\b|\bchargedAboveUsd\b|\bABOVE_NONE\b|\bABOVE_NOT_AVAILABLE\b|\baboveChargedAboveLine\b/;
  it('the one-renderer rules bite (planted)', () => {
    expect(DEFINES_RENDERER.test('function RecordedAboveValue({ recorded }) {}')).toBe(true);
    expect(READS_STATE.test("recorded.aboveCharged.state === 'none' ? ABOVE_NONE : ''")).toBe(true);
    expect(READS_STATE.test('<RecordedAboveValue recorded={aiCost.recorded} testId="x" />')).toBe(false);
  });

  it('AC-158: RecordedAboveValue is defined only in RecordedCostLines.tsx; the summary renders it and reads no state of its own; Section 3 renders the block', () => {
    expect(files.filter((file) => DEFINES_RENDERER.test(codeOf(file))).map(rel)).toEqual([rel(LINES)]);
    // The copy module defines the words; every other page file only renders through RecordedAboveValue.
    for (const file of files.filter((f) => f !== LINES && f !== path.join(DIR, 'financeCopy.ts'))) {
      expect({ file: rel(file), readsState: READS_STATE.test(codeOf(file)) }).toEqual({ file: rel(file), readsState: false });
    }
    expect(codeOf(SUMMARY)).toMatch(/<RecordedAboveValue recorded=\{aiCost\.recorded\}/);
    expect(codeOf(SECTION3)).toMatch(/<RecordedCostLines recorded=\{aiCost\.recorded\} accountId=\{accountId\} chargedShown=\{chargedShown\} \/>/);
  });

  it('SA-W98: Section 3 hands the block to the frame’s unknown slot too, so it shows when the charged read failed', () => {
    expect(codeOf(SECTION3)).toMatch(/alsoWhenUnknown=\{recordedBlock\}/);
    expect(codeOf(path.join(DIR, 'components', 'FinanceSection.tsx'))).toMatch(/\{status === 'unknown' && alsoWhenUnknown\}/);
  });
});

describe('Finance F-2 source guards (header and states)', () => {
  const VIEW = path.join(DIR, 'components', 'FinanceView.tsx');
  const HOOK = path.join(DIR, 'useFinanceData.ts');
  const H1 = /<h1\b/;
  const SHARED_HEADER = /import\s*\{\s*AdminPageHeader\s*\}\s*from\s*'@\/app\/admin\/components\/layout\/AdminPageHeader'/;
  // Finance F-4 (SA-W1): the URL notice is gone, so AdminNotice is no longer required here.
  const SHARED_STATES = /import\s*\{[^}]*\bAdminError\b[^}]*\bAdminLoading\b[^}]*\}\s*from\s*'@\/app\/admin\/components\/layout\/AdminStates'/;
  const HAND_NOTICE = /border-amber-500\/30/;

  it('the detectors bite (planted samples)', () => {
    expect('<h1 className="x">Finance</h1>').toMatch(H1);
    expect("import { AdminPageHeader } from '../../components/layout/AdminPageHeader';").not.toMatch(SHARED_HEADER);
    expect("import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';").toMatch(SHARED_HEADER);
    expect("import { AdminError, AdminLoading, AdminNotice } from '@/app/admin/components/layout/AdminStates';").toMatch(SHARED_STATES);
    expect("import { AdminError, AdminLoading } from '@/app/admin/components/layout/AdminStates';").toMatch(SHARED_STATES);
    expect("import { AdminError, AdminLoading } from '../../components/layout/AdminStates';").not.toMatch(SHARED_STATES);
    expect('<p className="rounded border border-amber-500/30 bg-amber-500/10">').toMatch(HAND_NOTICE);
  });

  it('FinanceView has no own h1 and takes the header and states from the shared folder by alias', () => {
    const view = codeOf(VIEW);
    expect(view).not.toMatch(H1);
    expect(view).toMatch(SHARED_HEADER);
    expect(view).toMatch(SHARED_STATES);
    expect(view).not.toMatch(HAND_NOTICE);
    expect(view).toMatch(/<AdminPageHeader\b/);
  });

  it('the hook has no caller fallback any more; its defensive catch uses the shared sentence', () => {
    const hook = codeOf(HOOK);
    expect(hook).not.toMatch(/fallbackError/);
    expect(hook).toMatch(/export function useFinanceData\(queryString: string\): FinanceData/);
    expect(hook).toMatch(/setError\(adminReadFallback\(FINANCE_WHAT\)\)/);
  });
});

// ── Finance F-5 (AC-179): the tiles are the shared admin tile; Health's styles are not used ──
describe('Finance F-5 source guards (the KPI tiles)', () => {
  /** Every file under app/admin/finance, tests included, except this guard (which names the pattern). */
  function walkAll(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walkAll(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  }
  const ALL = walkAll(DIR).filter((file) => path.basename(file) !== 'source.guard.test.ts');
  const HEALTH_STYLES = /components\/health\/HealthTile|STATUS_STYLES/;
  const STRIP = path.join(DIR, 'components', 'FinanceKpiStrip.tsx');

  it('scans the strip, the view and the tests (non-vacuity)', () => {
    const names = ALL.map(rel);
    expect(names).toEqual(
      expect.arrayContaining([
        'app/admin/finance/components/FinanceKpiStrip.tsx',
        'app/admin/finance/components/FinanceView.tsx',
        'app/admin/finance/__tests__/financePage.render.test.tsx',
        'app/admin/finance/__tests__/financeTiles.pin.render.test.tsx',
      ])
    );
  });

  it('the Health-styles rule bites (planted)', () => {
    expect(HEALTH_STYLES.test("import { STATUS_STYLES } from '@/app/admin/components/health/HealthTile';")).toBe(true);
    expect(HEALTH_STYLES.test("import { KpiTile } from '@/app/admin/components/layout/KpiStrip';")).toBe(false);
  });

  it.each(ALL.map(rel))('%s: names neither Health’s tile file nor its STATUS_STYLES (AC-179)', (file) => {
    expect({ file, hit: HEALTH_STYLES.test(read(path.join(ROOT, file))) }).toEqual({ file, hit: false });
  });

  it('FinanceKpiStrip.tsx renders the shared KpiStrip / KpiTile, imported by the alias (S-1)', () => {
    const code = codeOf(STRIP);
    expect(code).toMatch(/import \{ KpiStrip, KpiTile[^}]*\} from '@\/app\/admin\/components\/layout\/KpiStrip'/);
    expect(code).toMatch(/<KpiStrip>/);
    expect(code.match(/<KpiTile\b/g)).toHaveLength(5);
  });
});
