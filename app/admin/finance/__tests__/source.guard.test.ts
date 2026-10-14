/**
 * @jest-environment node
 *
 * The finance page's source guards (slice 1a, T14): no repository import (the
 * page reads only through its admin route), no `console.`, `useSearchParams`
 * inside a Suspense boundary, `router.replace` not `push`, and no `route.ts`
 * anywhere under `app/admin` (the page is gated by the admin layout).
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

  it('writes the URL with router.replace and scroll false, never push', () => {
    const view = read(path.join(DIR, 'components', 'FinanceView.tsx'));
    expect(view).toMatch(/router\.replace\([^)]*\{ scroll: false \}\)/);
    expect(view).not.toMatch(/router\.push\(/);
    expect(view).toMatch(/useSearchParams\(\)/);
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

  // SA-WR-39: the local chip renderer.
  const CHIP_DEFINED = /function\s+FinanceActiveChip\b|(?:const|let|var)\s+FinanceActiveChip\b/;
  const CHIP_EXPORTED = /export\s+(?:default\s+)?(?:function|const|let|var)\s+FinanceActiveChip\b|export\s*\{[^}]*\bFinanceActiveChip\b/;

  it('SA-WR-39: the chip rules bite (planted)', () => {
    expect(CHIP_EXPORTED.test('export function FinanceActiveChip({ chip }) {}')).toBe(true);
    expect(CHIP_EXPORTED.test('export { FinanceActiveChip };')).toBe(true);
    expect(CHIP_EXPORTED.test('function FinanceActiveChip({ chip }) {}')).toBe(false);
    expect(CHIP_DEFINED.test('const FinanceActiveChip = () => null;')).toBe(true);
  });

  it('SA-WR-39: FinanceActiveChip is defined only in FinanceFilterBar.tsx, never exported, renders the shared chip object unchanged, and names M-6', () => {
    const definers = files.filter((file) => CHIP_DEFINED.test(codeOf(file))).map(rel);
    expect(definers).toEqual(['app/admin/finance/components/FinanceFilterBar.tsx']);
    for (const file of files) expect({ file: rel(file), exported: CHIP_EXPORTED.test(codeOf(file)) }).toEqual({ file: rel(file), exported: false });
    const bar = codeOf(BAR);
    for (const field of ['chip.label', 'chip.title', 'chip.testId', 'chip.removeLabel', 'chip.onRemove']) expect(bar).toContain(field);
    expect(bar).toMatch(/businessFilterChip\(/);
    expect(read(BAR)).toMatch(/M-6/);
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
  /** The argument text of every call to one of the three sinks. */
  const sinkCalls = (code: string) =>
    [...code.matchAll(/(?:serialiseFinanceUrl|router\.replace|fetch)\(([^;]*)/g)].map((m) => m[1]);
  it('the name-sink rule bites (planted)', () => {
    expect(sinkCalls('router.replace(`/x?${serialiseFinanceUrl({ ...q, name: pickedName })}`, { scroll: false });').some((a) => /pickedName/.test(a))).toBe(true);
    expect(sinkCalls('setPickedName({ accountId, name }); setQuery({ ...query, accountId });').some((a) => /pickedName/.test(a))).toBe(false);
  });

  it('AC-109: in FinanceView.tsx, pickedName never appears in a serialiseFinanceUrl(, router.replace( or fetch( call; the hook takes the query string only', () => {
    const view = codeOf(VIEW);
    expect(view).toMatch(/pickedName/);
    expect(sinkCalls(view).length).toBeGreaterThan(0);
    for (const args of sinkCalls(view)) expect(args).not.toMatch(/pickedName|accountName|chipName/);
    expect(view).toMatch(/useFinanceData\(queryString,/);
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
