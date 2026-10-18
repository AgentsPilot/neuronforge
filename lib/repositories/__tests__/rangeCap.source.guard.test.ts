/**
 * Finance follow-ups FF-1d (SA-WR-FF1, FF1-R1): no single read may ask
 * PostgREST for more than 1,000 rows.
 *
 * Why: PostgREST caps every response at its `max-rows` (1,000 on this project)
 * and does not report the cut. Finance 8.3 C-1 shipped a `.range(0, 5000)` read
 * that silently returned 28 of 89 days. A wider single read looks correct on
 * paper, so this guard checks it mechanically.
 *
 * Rules, each in the literal form AND the constant form (a same-file `const`
 * or object key holding a number, `1_000` underscores read):
 *   R1 `.range(a, b)` whose span b - a + 1 is above 1,000;
 *   R2 `.limit(n)` with n above 1,000;
 *   R3 a page size above 1,000: `const X_PAGE_SIZE = n`, or an object key
 *      `PAGE_SIZE: n` / `X_PAGE_SIZE: n`.
 *
 * Scope: every non-test `.ts` / `.tsx` file under `lib/` and `app/api/`, with
 * comments stripped and string contents blanked (a decoy inside a string or a
 * comment is not code).
 *
 * Limits (stated, not hidden): a value that does not resolve to a number in
 * the same file (a parameter, a loop offset, an import) is NOT judged. Paging
 * loops such as `.range(offset, offset + PAGE - 1)` are therefore left alone,
 * which is the point: they page.
 *
 * BASELINE: offences that existed when the guard landed. It may only shrink.
 * Each entry must still be found exactly as often as listed, so a fixed call
 * forces its entry out. A NEW exemption is an SA ruling, never a quiet edit.
 *
 * CI time: a file walk in the existing Jest job, not on the `next build`
 * critical path.
 */

import * as fs from 'fs';
import * as path from 'path';

import { blankStringLiterals, stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const ROOTS = ['lib', 'app/api'];
const CAP = 1000;

interface Offence {
  rule: 'R1' | 'R2' | 'R3';
  file: string;
  /** The call or declaration text, whitespace removed. */
  text: string;
}

/**
 * Baseline at main `f7429b57` (2026-10-18). All are `.limit` reads outside the
 * finance module, left for their owners (FF-3). SA-WR-FF1 listed three literal
 * ones; the guard's own scan found 8 literal call sites in 6 files (D-1) and 12
 * constant-form call sites in 6 more files (D-2). None is R1 or R3.
 */
const BASELINE: ReadonlyArray<{ file: string; text: string; count: number }> = [
  // FF-3: Business OS stats route reads 2,000 rows in one call; page it or lower it.
  { file: 'app/api/business-os/stats/route.ts', text: '.limit(2000)', count: 1 },
  // FF-3: chat budget telemetry reads 20,000 rows in one call; page it or aggregate in SQL.
  { file: 'lib/business-os/bizql/telemetry/ChatBudget.ts', text: '.limit(20000)', count: 1 },
  // FF-3: insight detector reads 5,000 rows in one call; page it.
  { file: 'lib/business-os/insight/detectors/catalog/AcqLowConversionDetector.ts', text: '.limit(5000)', count: 1 },
  // FF-3: shared insight detector base reads 2,000 rows in one call; page it.
  { file: 'lib/business-os/insight/detectors/catalog/BaseDetector.ts', text: '.limit(2000)', count: 1 },
  // FF-3: shared insight detector base reads 5,000 rows in one call; page it.
  { file: 'lib/business-os/insight/detectors/catalog/BaseDetector.ts', text: '.limit(5000)', count: 1 },
  // FF-3: insight detector reads 2,000 rows in each of two calls; page them.
  { file: 'lib/business-os/insight/detectors/catalog/ConvServiceRateDropDetector.ts', text: '.limit(2000)', count: 2 },
  // FF-3: insight detector reads 2,000 rows in one call; page it.
  { file: 'lib/business-os/insight/detectors/catalog/ConvStageDropoffDetector.ts', text: '.limit(2000)', count: 1 },
  // Constant form (D-2): found only once same-file constants are resolved.
  // FF-3: payments money route, GROUPING_CAP = 2000, three calls; page them or lower the cap.
  { file: 'app/api/payments/money/route.ts', text: '.limit(GROUPING_CAP)', count: 3 },
  // FF-3: BizQL compiler, AGGREGATE_SCAN_CAP = 5_000 plus one; a cap-plus-one truncation probe
  // above max-rows can never see the extra row, so the truncation flag may never fire.
  { file: 'lib/business-os/bizql/compiler.ts', text: '.limit(AGGREGATE_SCAN_CAP+1)', count: 3 },
  // FF-3: BizQL compiler, ANTI_JOIN_CAP = 10_000 plus one; same cap-plus-one probe problem.
  { file: 'lib/business-os/bizql/compiler.ts', text: '.limit(ANTI_JOIN_CAP+1)', count: 1 },
  // FF-3: insight repository, VISITOR_SCAN_LIMIT = 5000; page it.
  { file: 'lib/business-os/insight/repository/InsightRepository.ts', text: '.limit(VISITOR_SCAN_LIMIT)', count: 1 },
  // FF-3: audit trail repository, OWNER_ACTIVITY_SCAN_CAP = 5000; page it.
  { file: 'lib/repositories/AuditTrailRepository.ts', text: '.limit(OWNER_ACTIVITY_SCAN_CAP)', count: 1 },
  // FF-3: purge repository, VIA_PARENT_CAP = 5000, two calls; a purge that reads a cut list
  // may leave rows behind, so its owner must page it.
  { file: 'lib/repositories/BusinessPurgeRepository.ts', text: '.limit(VIA_PARENT_CAP)', count: 2 },
  // FF-3: smart link repository, local CAP = 20000; page it.
  { file: 'lib/repositories/SmartLinkRepository.ts', text: '.limit(CAP)', count: 1 },
];

/**
 * QA-FF1-1: the baseline size is pinned, so adding an entry, or raising a count, fails.
 * Removing an entry or lowering a count after a fix means LOWERING these pins in
 * the same change. They are never raised without an SA ruling.
 */
const BASELINE_ENTRIES = 14;
const BASELINE_CALL_SITES = 20;

const toNumber = (s: string): number => Number(s.replace(/_/g, ''));

/** Same-file numeric constants: `const X = n`, `const X: number = n`, and `KEY: n` object keys. */
function constantsOf(code: string): Map<string, number> {
  const table = new Map<string, number>();
  const put = (name: string, value: number) => {
    // Two objects may reuse a key name; keep the largest, so the guard errs strict.
    table.set(name, Math.max(value, table.get(name) ?? -Infinity));
  };
  for (const m of code.matchAll(/\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*(\d[\d_]*)\b(?!\s*[.\w])/g)) {
    put(m[1], toNumber(m[2]));
  }
  for (const m of code.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*(\d[\d_]*)\b(?=\s*[,}\r\n])/g)) {
    put(m[1], toNumber(m[2]));
  }
  return table;
}

/**
 * Evaluates `term ([+-] term)*`, a term being a number or an identifier chain
 * (`A`, `LIMITS.A`) resolved by its last segment. Anything else is unjudged.
 */
function evaluate(expr: string, table: Map<string, number>): number | undefined {
  const parts = expr.trim().split(/\s*([+-])\s*/);
  if (parts[0] === '') return undefined;
  let total = 0;
  let sign = 1;
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (i % 2 === 1) {
      sign = part === '-' ? -1 : 1;
      continue;
    }
    let value: number | undefined;
    if (/^\d[\d_]*$/.test(part)) value = toNumber(part);
    else if (/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(part)) value = table.get(part.split('.').pop() as string);
    if (value === undefined) return undefined;
    total += sign * value;
  }
  return total;
}

const squash = (s: string) => s.replace(/\s+/g, '');

/** The three rules on one file's source. Pure, so planted controls run the same code. */
export function offencesIn(file: string, source: string): Offence[] {
  const code = blankStringLiterals(stripComments(source));
  const table = constantsOf(code);
  const found: Offence[] = [];

  for (const m of code.matchAll(/\.range\(([^(),]*),([^(),]*)\)/g)) {
    const from = evaluate(m[1], table);
    const to = evaluate(m[2], table);
    if (from !== undefined && to !== undefined && to - from + 1 > CAP) found.push({ rule: 'R1', file, text: squash(m[0]) });
  }
  for (const m of code.matchAll(/\.limit\(([^(),]*)\)/g)) {
    const n = evaluate(m[1], table);
    if (n !== undefined && n > CAP) found.push({ rule: 'R2', file, text: squash(m[0]) });
  }
  for (const m of code.matchAll(/\b((?:[A-Za-z_$][\w$]*_)?PAGE_SIZE)\s*(?::\s*number\s*)?[:=]\s*([^,;}\r\n]+)/g)) {
    const n = evaluate(m[2], table);
    if (n !== undefined && n > CAP) found.push({ rule: 'R3', file, text: squash(m[0]) });
  }
  return found;
}

function sourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
        walk(rel);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
        files.push(rel);
      }
    }
  };
  ROOTS.forEach(walk);
  return files;
}

const FILES = sourceFiles();
const ALL = FILES.flatMap((file) => offencesIn(file, fs.readFileSync(path.join(ROOT, file), 'utf8')));
const key = (file: string, text: string) => `${file} ${text}`;
const counts = new Map<string, number>();
for (const o of ALL) counts.set(key(o.file, o.text), (counts.get(key(o.file, o.text)) ?? 0) + 1);

describe('FF-1d: no single read above 1,000 rows (FF1-R1)', () => {
  it('walked both roots and found the known paging files (guards the walk itself)', () => {
    expect(FILES).toContain('lib/repositories/BusinessOsFinanceSnapshotReadRepository.ts');
    expect(FILES).toContain('app/api/business-os/stats/route.ts');
    expect(FILES.some((f) => f.includes('__tests__'))).toBe(false);
  });

  it('the baseline cannot grow: pinned at 14 entries and 20 call sites, no duplicate entry (QA-FF1-1)', () => {
    const keys = BASELINE.map((b) => key(b.file, b.text));
    expect({
      entries: BASELINE.length,
      callSites: BASELINE.reduce((sum, b) => sum + b.count, 0),
      distinct: new Set(keys).size,
    }).toEqual({ entries: BASELINE_ENTRIES, callSites: BASELINE_CALL_SITES, distinct: BASELINE_ENTRIES });
  });

  it('finds no offence outside the baseline', () => {
    const allowed = new Set(BASELINE.map((b) => key(b.file, b.text)));
    expect(ALL.filter((o) => !allowed.has(key(o.file, o.text)))).toEqual([]);
  });

  it.each(BASELINE.map((b) => [key(b.file, b.text), b.count] as const))(
    'baseline entry still present exactly as listed (it may only shrink): %s',
    (entry, count) => {
      expect({ entry, found: counts.get(entry) ?? 0 }).toEqual({ entry, found: count });
    },
  );
});

describe('FF-1d planted controls: each rule bites, in both forms', () => {
  const rules = (src: string) => offencesIn('planted.ts', src).map((o) => o.rule);

  it('R1 literal and constant span', () => {
    expect(rules('q.range(0, 5000)')).toEqual(['R1']);
    expect(rules('q.range(0, 1_000)')).toEqual(['R1']);
    expect(rules('const MAX = 5000;\nq.range(0, MAX - 1)')).toEqual(['R1']);
    expect(rules('const L = { ROWS: 2000, };\nq.range(0, L.ROWS)')).toEqual(['R1']);
  });

  it('R2 literal and constant limit', () => {
    expect(rules('q.limit(5000)')).toEqual(['R2']);
    expect(rules('const CAP_ROWS = 20_000;\nq.limit(CAP_ROWS)')).toEqual(['R2']);
    expect(rules('const L = { ROWS: 2000 };\nq.limit(L.ROWS)')).toEqual(['R2']);
  });

  it('R3 page size as a const and as an object key, literal and constant', () => {
    expect(rules('const X_PAGE_SIZE = 5000;')).toEqual(['R3']);
    expect(rules('const L = {\n  PAGE_SIZE: 2_000,\n};')).toEqual(['R3']);
    expect(rules('const L = { LEDGER_PAGE_SIZE: 1001 };')).toEqual(['R3']);
    expect(rules('const BIG = 3000;\nconst PAGE_SIZE = BIG;')).toEqual(['R3']);
  });

  it('at the cap, paging loops, unresolved values, comments and strings are clean', () => {
    expect(rules('q.range(0, 999)')).toEqual([]);
    expect(rules('q.limit(1000)')).toEqual([]);
    expect(rules('const PAGE_SIZE = 1_000;')).toEqual([]);
    expect(rules('const PAGE = 1000;\nq.range(offset, offset + PAGE - 1)')).toEqual([]);
    expect(rules('q.limit(maxRows)')).toEqual([]);
    expect(rules('// q.range(0, 5000)\n/* q.limit(9000) */')).toEqual([]);
    expect(rules("const s = 'q.limit(5000)';")).toEqual([]);
  });
});
