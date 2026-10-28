/**
 * Source guards for client payments in approximate US dollars (FIN BD-56,
 * slice 1a; SA-RR-CPU SA-Q-2, SA-Q-6, CPU-3, CPU-8; SA-WP-CPU1A W-2, W-4).
 * Workplan docs/workplans/CLIENT_PAYMENTS_USD_1A_WORKPLAN.md §6.1.
 *
 * CUR-3 in finance.source.guard is NOT loosened (that file is unedited). These
 * POSITIVE pins fix the one way rates enter Finance and the one converter:
 *
 *   G-a  ExchangeRatesRepository is imported only by the three exchange-rates
 *        routes, the repositories barrel (a re-export) and the wiring; nothing
 *        imports it FROM the barrel.
 *   G-b  The wiring and the converter are imported only by the finance route,
 *        once each (the wiring may import the converter's TYPES only).
 *   G-c  Outside rateMath.ts, only the rate sync (ecbRates.ts) and the
 *        converter use divideHalfUp.
 *   G-d  The converter is pure.
 *   G-e  The wiring's log calls carry no rate or code.
 *   G-f  finance.source.guard's CUR-3 rule and its three exchange-rate bans
 *        on our own money files are still there.
 *   L-1  Leak scan (EX-2, EX-4, EX-6): the section's names, its access path
 *        and typed `usd` use appear only in the allowed files, never in the
 *        strip, our revenue, account economics, the snapshot, the export, the
 *        audit trail, the chat, the briefing, insights, app/api/business-os
 *        or the business drawer. L-1′: each named zone exists.
 *
 * Every rule is a pure function run on the real files AND on a planted control.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
/** Comments stripped once per file: the leak scan walks every file under app/ and lib/ many times. */
const CODE_CACHE = new Map<string, string>();
const codeOf = (file: string): string => {
  let code = CODE_CACHE.get(file);
  if (code === undefined) {
    code = stripComments(read(file));
    CODE_CACHE.set(file, code);
  }
  return code;
};

const SKIP = new Set(['__tests__', '__mocks__', '__fixtures__', '__snapshots__', 'node_modules']);
function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(path.join(ROOT, dir))) return out;
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIP.has(entry.name)) walk(rel, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

const ALL = ['app', 'lib', 'components', 'hooks'].flatMap((root) => walk(root));

const ROUTE = 'app/api/admin/business-os/finance/route.ts';
const WIRING = 'lib/admin/exchangeRates/clientPaymentRates.ts';
const CONVERTER = 'lib/admin/exchangeRates/clientPaymentsUsd.ts';
const TYPES = 'lib/business-os/finance/financeTypes.ts';
const RATE_MATH = 'lib/admin/exchangeRates/rateMath.ts';
const RATE_SYNC_PARSER = 'lib/admin/exchangeRates/ecbRates.ts';
const BARREL = 'lib/repositories/index.ts';
const XR_ROUTES = [
  'app/api/admin/exchange-rates/route.ts',
  'app/api/admin/exchange-rates/sync/route.ts',
  'app/api/admin/exchange-rates/[currencyCode]/route.ts',
];

type Code = (file: string) => string;
const planted = (target: string, extra: string): Code => (file) => (file === target ? `${codeOf(file)}\n${extra}\n` : codeOf(file));

it('scans real files (non-vacuity)', () => {
  expect(ALL.length).toBeGreaterThan(1000);
  for (const file of [ROUTE, WIRING, CONVERTER, TYPES, RATE_MATH, RATE_SYNC_PARSER, BARREL, ...XR_ROUTES]) {
    expect({ file, scanned: ALL.includes(file) }).toEqual({ file, scanned: true });
  }
});

// ── G-a: who imports the rates repository ───────────────────────────────────
const REPO_PATH = /['"][^'"\n]*\/ExchangeRatesRepository['"]/;
const FROM_BARREL = /import\s[^;]*\b(?:exchangeRatesRepository|ExchangeRatesRepository)\b[^;]*from\s+['"]@\/lib\/repositories['"]/;
const repoImporters = (code: Code) => ALL.filter((file) => REPO_PATH.test(code(file))).sort();
const barrelImporters = (code: Code) => ALL.filter((file) => FROM_BARREL.test(code(file))).sort();
const EXPECTED_REPO_IMPORTERS = [...XR_ROUTES, BARREL, WIRING].sort();

describe('G-a: ExchangeRatesRepository importers (CPU-3, SA-Q-1A-5)', () => {
  it('exactly the three exchange-rates routes, the barrel re-export and the wiring', () => {
    expect(repoImporters(codeOf)).toEqual(EXPECTED_REPO_IMPORTERS);
    expect(codeOf(BARREL)).toMatch(/export\s*\{[^}]*\bexchangeRatesRepository\b[^}]*\}\s*from\s*'\.\/ExchangeRatesRepository'/);
  });

  it('nothing imports the repository FROM the barrel', () => {
    expect(barrelImporters(codeOf)).toEqual([]);
  });

  it('G-a′: the wiring calls listAll, and only listAll', () => {
    const calls = [...codeOf(WIRING).matchAll(/\.\s*(listAll|findByCode|listRecentHistory\w*|findLatestChange|updateRate|setEnabled)\s*\(/g)].map((m) => m[1]);
    expect(calls).toEqual(['listAll']);
  });

  it('planted: a finance-lib importer joins the list; a barrel import is caught; a comment is not', () => {
    const lib = 'lib/business-os/finance/financeHealth.ts';
    expect(repoImporters(planted(lib, "import { exchangeRatesRepository } from '@/lib/repositories/ExchangeRatesRepository';"))).toEqual(
      [...EXPECTED_REPO_IMPORTERS, lib].sort()
    );
    expect(barrelImporters(planted(ROUTE, "import { exchangeRatesRepository } from '@/lib/repositories';"))).toEqual([ROUTE]);
    const inComment = (file: string) => (file === lib ? stripComments(`${read(file)}\n// see '@/lib/repositories/ExchangeRatesRepository'\n`) : codeOf(file));
    expect(repoImporters(inComment)).toEqual(EXPECTED_REPO_IMPORTERS);
  });
});

// ── G-b: who imports the wiring and the converter ───────────────────────────
const IMPORT_OF = (module: string) => new RegExp(`^\\s*import\\s+(type\\s+)?[^;]*from\\s+['"][^'"]*\\/?${module}['"];?`, 'gm');
const importsOf = (code: string, module: string) => [...code.matchAll(IMPORT_OF(module))].map((m) => ({ typeOnly: Boolean(m[1]) }));
const importersOf = (code: Code, module: string) =>
  ALL.filter((file) => file !== `lib/admin/exchangeRates/${module}.ts` && importsOf(code(file), module).length > 0).sort();

describe('G-b: the wiring and the converter have one caller, the finance route', () => {
  it('the wiring: imported only by the route, by one statement', () => {
    expect(importersOf(codeOf, 'clientPaymentRates')).toEqual([ROUTE]);
    expect(importsOf(codeOf(ROUTE), 'clientPaymentRates')).toEqual([{ typeOnly: false }]);
  });

  it('the converter: one value import, in the route; the wiring imports its types only', () => {
    expect(importersOf(codeOf, 'clientPaymentsUsd')).toEqual([ROUTE, WIRING].sort());
    expect(importsOf(codeOf(ROUTE), 'clientPaymentsUsd')).toEqual([{ typeOnly: false }]);
    expect(importsOf(codeOf(WIRING), 'clientPaymentsUsd')).toEqual([{ typeOnly: true }]);
  });

  it('planted: a second importer and a duplicate import in the route are caught', () => {
    const page = 'app/admin/finance/components/TakingsSection.tsx';
    expect(importersOf(planted(page, "import { readClientPaymentRates } from '@/lib/admin/exchangeRates/clientPaymentRates';"), 'clientPaymentRates')).toEqual(
      [page, ROUTE].sort()
    );
    expect(importsOf(planted(ROUTE, "import { buildClientPaymentsUsd as again } from '@/lib/admin/exchangeRates/clientPaymentsUsd';")(ROUTE), 'clientPaymentsUsd')).toHaveLength(2);
    expect(importsOf(planted(WIRING, "import { buildClientPaymentsUsd } from './clientPaymentsUsd';")(WIRING), 'clientPaymentsUsd')).toEqual([
      { typeOnly: true },
      { typeOnly: false },
    ]);
  });
});

// ── G-c: who uses divideHalfUp ──────────────────────────────────────────────
const usersOfDivide = (code: Code) => ALL.filter((file) => file !== RATE_MATH && /\bdivideHalfUp\b/.test(code(file))).sort();

describe('G-c: divideHalfUp outside rateMath.ts is the rate sync and the converter only', () => {
  it('exactly ecbRates.ts and the converter', () => {
    expect(usersOfDivide(codeOf)).toEqual([CONVERTER, RATE_SYNC_PARSER].sort());
  });

  it('planted: a finance-lib or our-revenue user is caught', () => {
    for (const file of ['lib/business-os/finance/financeHealth.ts', 'lib/business-os/finance/boostRevenue.ts']) {
      expect(usersOfDivide(planted(file, "import { divideHalfUp } from '@/lib/admin/exchangeRates/rateMath';"))).toContain(file);
    }
  });
});

// ── G-d: the converter is pure ──────────────────────────────────────────────
const IMPURE: ReadonlyArray<readonly [string, RegExp]> = [
  ['server-only', /['"]server-only['"]/],
  ['logger', /createLogger|@\/lib\/logger/],
  ['repository', /@\/lib\/repositories/],
  ['supabase', /supabase/i],
  ['clock', /Date\.now\(|new Date\(/],
  ['fetch', /(?<![A-Za-z0-9_.$])fetch\(/],
];
const impurities = (code: string) => IMPURE.filter(([, re]) => re.test(code)).map(([name]) => name);

describe('G-d: the converter is pure', () => {
  it('no server-only, logger, repository, Supabase, clock or fetch', () => {
    expect(impurities(codeOf(CONVERTER))).toEqual([]);
  });

  it('planted: each impurity is caught', () => {
    for (const [name, sample] of [
      ['server-only', "import 'server-only';"],
      ['logger', "import { createLogger } from '@/lib/logger';"],
      ['repository', "import { x } from '@/lib/repositories/X';"],
      ['supabase', 'const c = supabaseServer;'],
      ['clock', 'const t = Date.now();'],
      ['fetch', "void fetch('/x');"],
    ] as const) {
      expect(impurities(planted(CONVERTER, sample)(CONVERTER))).toEqual([name]);
    }
  });
});

// ── G-e: the wiring logs no rate or code ────────────────────────────────────
const LOG_CALL = /logger\.(?:info|warn|error|debug)\(([^;]*)\);/g;
/** Message strings are blanked: prose saying "Exchange rates" is not a logged rate. */
const leakyLogs = (code: string) => [...code.matchAll(LOG_CALL)].map((m) => m[1].replace(/'[^'\n]*'/g, "''")).filter((args) => /\b(?:rate|rates|rateToUsd|rate_to_usd|code|currencyCode|currency_code)\b/.test(args));

describe('G-e (EX-4): the wiring logs the error or a count only', () => {
  it('its log calls name no rate or code', () => {
    expect([...codeOf(WIRING).matchAll(LOG_CALL)].length).toBeGreaterThanOrEqual(2);
    expect(leakyLogs(codeOf(WIRING))).toEqual([]);
  });

  it('planted: a logged rate is caught', () => {
    expect(leakyLogs(planted(WIRING, "logger.info({ rate: wire.rateToUsd }, 'x');")(WIRING))).toHaveLength(1);
  });
});

// ── G-f: finance.source.guard still holds CUR-3 and the three bans ──────────
const FINANCE_GUARD = 'lib/business-os/finance/__tests__/finance.source.guard.test.ts';
const BAN = 'expect(code).not.toMatch(/exchange_rates|\\bfx\\b|\\brate\\b/i);';
const CUR3 = "it.each(FILES)('%s: no exchange_rates read', (file) => {\n    expect(codeOf(file)).not.toMatch(/exchange_rates/);";
const guardHolds = (text: string) => ({
  cur3: text.includes(CUR3),
  bans: text.split(BAN).length - 1,
  files: ['boostRevenue.ts', 'planRevenue.ts', 'accountEconomics.ts'].every((name) => text.includes(`lib/business-os/finance/${name}`)),
});

describe('G-f (SA-Q-2 (e)): CUR-3 and the exchange-rate bans on our own money are untouched', () => {
  it('the CUR-3 rule and the four ban assertions (boost, plans ×2, account economics) are present', () => {
    expect(guardHolds(read(FINANCE_GUARD))).toEqual({ cur3: true, bans: 4, files: true });
  });

  it('planted: a removed ban or a removed CUR-3 rule is caught', () => {
    const text = read(FINANCE_GUARD);
    expect(guardHolds(text.replace(BAN, '')).bans).toBe(3);
    expect(guardHolds(text.replace(CUR3, '')).cur3).toBe(false);
  });
});

// ── L-1: the leak scan (SA-Q-6, CPU-3, CPU-8, W-2) ──────────────────────────
const TOKENS =
  /\bFinanceClientPaymentsUsd(?:Row)?\b|\bFinanceUsdRowState\b|\bbuildClientPaymentsUsd\b|\breadClientPaymentRates\b|clientPaymentsUsd|clientPaymentRates|\btakings\s*\??\.\s*usd\b|\btakings\s*(?:\?\.\s*)?\[\s*['"`]usd['"`]\s*\]|\[\s*['"`]takings['"`]\s*\]\s*(?:\?\.\s*)?\[\s*['"`]usd['"`]\s*\]|FinanceTakingsSection\s*\[\s*['"`]usd['"`]\s*\]/;
/**
 * W-2 + QA B-1: a file that reaches the takings section at all (it names `takings`, or the
 * `FinanceTakingsSection` / `FinancePayload` types) and reads a `usd` from anything, in any
 * form: member access (`t.usd`, `t?.usd`, so an alias of `data.takings` is caught), a bracket
 * (`t['usd']`), a destructure (`{ usd } =`, `{ usd: alias } =`, nested `{ takings: { usd } } =`)
 * or a declaration (`usd?:`). A file with no takings reach may read an unrelated `usd` (the AI
 * cost `aboveCharged.usd`): that is not this section.
 */
const REACHES_TAKINGS = /\btakings\b|\bFinanceTakingsSection\b|\bFinancePayload\b/;
/**
 * CPU1A-FU-1 (SA-WP-FU FU-C2): the last branch is a TYPED destructure ending a parameter, so a
 * `function` declaration or a method (`f({ usd }: T) {`, no `=` after it) is caught too, nested
 * (`{ takings: { usd } }: FinancePayload`) and not-last (`({ usd }: T, n)`) included. Still ANDed
 * with REACHES_TAKINGS, so it only counts in a file that reaches the takings section.
 */
const READS_USD =
  /\??\.\s*usd\b|\[\s*['"`]usd['"`]\s*\]|\{[^{}]*\busd\b[^{}]*\}(?:\s*\})*\s*(?::[^=;]*)?=|\busd\?\s*:|\{[^{}]*\busd\b[^{}]*\}(?:\s*\})*\s*:[^=;{)]*[,)]/;
const TYPED_USD = (code: string) => REACHES_TAKINGS.test(code) && READS_USD.test(code);
const ALLOWED = [
  TYPES,
  CONVERTER,
  WIRING,
  ROUTE,
  // Slice 1b's UI, ruled ahead in SA-RR-CPU SA-Q-6.
  'app/admin/finance/components/TakingsSection.tsx',
  'app/admin/finance/financeCopy.ts',
];
const holders = (code: Code) => ALL.filter((file) => TOKENS.test(code(file)) || TYPED_USD(code(file))).sort();

/** Each forbidden zone, a real file or folder (W-4: a missing path is fixed, never dropped). */
const ZONES: Record<string, string> = {
  strip: 'app/admin/finance/components/FinanceKpiStrip.tsx',
  ourRevenue: 'lib/business-os/finance/ourRevenue.ts',
  accountEconomics: 'lib/business-os/finance/accountEconomics.ts',
  snapshot: 'lib/business-os/finance/financeSnapshot.ts',
  snapshotJob: 'lib/business-os/finance/financeSnapshotJob.ts',
  drawer: 'app/admin/finance/components/BusinessDrawer.tsx',
  auditService: 'lib/services/AuditTrailService.ts',
  audit: 'lib/audit',
  dataExport: 'lib/business-os/data-export',
  dataExportRoutes: 'app/api/business-os/data-exports',
  bosApi: 'app/api/business-os',
  bizql: 'lib/business-os/bizql',
  briefing: 'lib/business-os/briefing',
  insight: 'lib/business-os/insight',
  insights: 'lib/business-os/insights',
  chat: 'lib/business-os/chat',
  bosLib: 'lib/business-os',
};
const zoneFile = (zone: string): string => {
  const target = ZONES[zone];
  if (/\.(ts|tsx)$/.test(target)) return target;
  const first = ALL.find((file) => file.startsWith(`${target}/`) && file !== TYPES);
  if (!first) throw new Error(`zone ${zone} has no file`);
  return first;
};

describe('L-1: the section never leaves the admin Client payments path', () => {
  it('every holder is an allowed file; the route, the types and the converter hold it (non-vacuity)', () => {
    const found = holders(codeOf);
    expect(found.filter((file) => !ALLOWED.includes(file))).toEqual([]);
    expect(found).toEqual(expect.arrayContaining([ROUTE, TYPES, CONVERTER]));
  });

  it('L-1′ (W-4): every named zone exists and is walked', () => {
    for (const [zone, target] of Object.entries(ZONES)) {
      const exists = fs.existsSync(path.join(ROOT, target));
      const walked = /\.(ts|tsx)$/.test(target) ? ALL.includes(target) : ALL.some((file) => file.startsWith(`${target}/`));
      expect({ zone, target, exists, walked }).toEqual({ zone, target, exists: true, walked: true });
    }
    expect(ALL.filter((file) => file.startsWith('app/api/business-os/')).length).toBeGreaterThan(50);
    expect(ALL.filter((file) => file.startsWith('lib/business-os/data-export/')).length).toBeGreaterThan(3);
  });

  it.each(Object.keys(ZONES))('planted: the section named in the %s zone is caught', (zone) => {
    const file = zoneFile(zone);
    const leaked = holders(planted(file, 'const leak = payload.takings.usd;'));
    expect(leaked).toContain(file);
    expect(holders(planted(file, 'type X = FinanceClientPaymentsUsd;'))).toContain(file);
  });

  /** QA B-1: the five forms the first matcher missed (plus two aliased variants), each in a file importing FinancePayload only. */
  const PAYLOAD_IMPORT = "import type { FinancePayload } from '@/lib/business-os/finance/financeTypes';";
  const MISSED_FORMS: ReadonlyArray<readonly [string, string]> = [
    ['destructure from data.takings', 'const { usd } = data.takings;'],
    ['nested destructure', 'const { takings: { usd } } = data;'],
    ['alias then member', 'const t = data.takings;\nconst v = t.usd?.totalUsd;'],
    ['bracket access', 'const v = data.takings["usd"];'],
    ['indexed payload type', 'type U = FinancePayload["takings"]["usd"];'],
    ['aliased destructure', 'const { usd: approx } = data.takings;'],
    ['typed nested destructure', 'const { takings: { usd } }: FinancePayload = data;'],
    // CPU1A-FU-1 (SA-WP-FU FU-C2): typed destructures in a parameter list, with no `=` after them.
    ['function parameter destructure', 'function f({ usd }: FinancePayload["takings"]) { return usd; }'],
    ['aliased, not-last function parameter', 'function g({ usd: approx }: FinancePayload["takings"], n: number) { return [approx, n]; }'],
    ['method parameter destructure', 'class K { m({ usd }: FinancePayload["takings"]) { return usd; } }'],
    ['nested function parameter destructure', 'function h({ takings: { usd } }: FinancePayload) { return usd; }'],
  ];

  /** CPU1A-FU-1: the four parameter forms above, which the guard before FU-C2 let through. */
  const PARAMETER_FORMS = MISSED_FORMS.filter(([name]) => /parameter/.test(name));
  const READS_USD_BEFORE_FU1 =
    /\??\.\s*usd\b|\[\s*['"`]usd['"`]\s*\]|\{[^{}]*\busd\b[^{}]*\}(?:\s*\})*\s*(?::[^=;]*)?=|\busd\?\s*:/;

  it('CPU1A-FU-1: the parameter forms slipped past the previous matcher, and the new branch is what catches them', () => {
    expect(PARAMETER_FORMS).toHaveLength(4);
    for (const [name, form] of PARAMETER_FORMS) {
      const snippet = `${PAYLOAD_IMPORT}\n${form}`;
      expect({ name, before: READS_USD_BEFORE_FU1.test(snippet), now: READS_USD.test(snippet) }).toEqual({ name, before: false, now: true });
    }
  });

  it('CPU1A-FU-1 precision: no takings reach, no usd, a type literal or a plain parameter is not a leak', () => {
    // A typed parameter destructure in a file that does not reach takings.
    expect(TYPED_USD('function f({ usd }: Other) { return usd; }')).toBe(false);
    // In a file that reaches takings: a destructure with no usd, a type literal holding usd, a plain usd parameter.
    for (const form of [
      'function f({ amount }: FinancePayload["takings"]) { return amount; }',
      'const x: Array<{ usd: number }> = [];',
      'function f(usd: number) { return usd; }',
    ]) {
      const snippet = `${PAYLOAD_IMPORT}\n${form}`;
      expect({ form, caught: TOKENS.test(snippet) || TYPED_USD(snippet) }).toEqual({ form, caught: false });
    }
  });

  it.each(Object.keys(ZONES).flatMap((zone) => MISSED_FORMS.map(([name, form]) => [zone, name, form] as const)))(
    'B-1 planted (%s zone): %s is caught',
    (zone, _name, form) => {
      const file = zoneFile(zone);
      expect(holders(planted(file, `${PAYLOAD_IMPORT}\n${form}`))).toContain(file);
    }
  );

  it('B-1: each missed form is caught by the regexes alone, with no other token in the snippet', () => {
    for (const [name, form] of MISSED_FORMS) {
      const snippet = `${PAYLOAD_IMPORT}\n${form}`;
      expect({ name, caught: TOKENS.test(snippet) || TYPED_USD(snippet) }).toEqual({ name, caught: true });
    }
  });

  it('B-1 precision: an unrelated usd in a file with no takings reach is not a leak', () => {
    for (const snippet of ['const { usd } = other;', 'const v = above.usd;', "const v = finding['usd'];", 'const usd = 1;']) {
      expect({ snippet, caught: TOKENS.test(snippet) || TYPED_USD(snippet) }).toEqual({ snippet, caught: false });
    }
    // A file reaching takings that only names a usd variable (no read from an object) is not a leak either.
    expect(TYPED_USD('const takings = 1; const usd = 2; const s = `${usd}`;')).toBe(false);
  });

  it('W-2 planted: typed access and a destructure through the type import are caught; a bare usd is not', () => {
    const strip = ZONES.strip;
    expect(holders(planted(strip, "type U = FinanceTakingsSection['usd'];"))).toContain(strip);
    expect(
      holders(planted(strip, "import type { FinanceTakingsSection } from '@/lib/business-os/finance/financeTypes';\nconst { usd } = t as FinanceTakingsSection;"))
    ).toContain(strip);
    // An unrelated `usd` in a file with no takings reach is not a leak (e.g. the AI cost `aboveCharged.usd`).
    // QA B-1: the strip reaches `FinancePayload`, so there ANY `usd` read counts (conservative); the
    // precision control therefore uses a zone file that does not reach takings.
    const unrelated = ZONES.auditService;
    expect(REACHES_TAKINGS.test(codeOf(unrelated))).toBe(false);
    expect(holders(planted(unrelated, 'const { usd } = other;'))).not.toContain(unrelated);
    expect(holders(planted(strip, 'const { usd } = other;'))).toContain(strip);
  });
});
