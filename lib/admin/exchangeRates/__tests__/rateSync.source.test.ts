/**
 * Source rules for the exchange rate sync (Admin Exchange Rates slice 1e; SA
 * §13.7 SQ-35, SQ-36, SQ-38, step 1e.1-9; §13.8 SQ-49 (3)). Modelled on the
 * price review's `fetchSources.source.test.ts`, which stays unedited.
 *
 *   - One outbound door: `fetch(` appears once, in `ecbFeed.ts`, and in no
 *     other sync file.
 *   - Exactly TWO full URLs in `lib/admin/exchangeRates/**` (non-test): the
 *     fetched feed in `ecbFeed.ts` and the ECB's human page in
 *     `rateSyncRules.ts`, each pinned to its exact value; none in
 *     `exchangeRateRules.ts` or the route.
 *   - SQ-49: G-6 (`redundantPages.source.guard`) bans `https://` text under
 *     `app/admin/exchange-rates/` and says nothing about links; that silence is
 *     on record here. The page may use `ECB_SOURCE_PAGE_URL` only as
 *     `href={ECB_SOURCE_PAGE_URL}` (never in a `fetch(`, which G-6's
 *     `ALLOWED_FETCH` refuses anyway), and neither the feed URL nor `ecbFeed`
 *     is imported anywhere under `app/admin/`. The page's link itself is
 *     proven by the rates render suite (DV-1).
 *   - `ecbFeed.ts` is server-only; the pure modules are not.
 *   - No AI provider, factory or SDK, no `CurrencyService`, no
 *     `lib/business-os/**`, and nothing from `pricing-research/fetchSources`.
 *   - No float on the rate path: no `Number(`, `parseFloat`, `parseInt`,
 *     `Math.`, `toFixed(`, `eval(`, `new Function` or BigInt literal in the
 *     maths, the parser or the route.
 *   - No feed body in a log line of the route.
 *   - The fixture holds no backslash (Tailwind scan hazard, PR #180) and is dated.
 * Every rule has a planted control, so a dead rule cannot pass.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

import { codeOf } from '@/tests/helpers/bos-llm-literal-rules';

const ROOT = process.cwd();
const read = (relative: string) => readFileSync(join(ROOT, relative), 'utf8').replace(/\r\n/g, '\n');

/** Comments out, including trailing `//` comments (URLs inside strings keep their `//`). */
function code(source: string): string {
  return codeOf(source).replace(/(^|[^:'"`])[/][/].*$/gm, '$1');
}

function walk(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const relative = `${dir}/${name}`;
    if (statSync(join(ROOT, relative)).isDirectory()) return name === '__tests__' || name === '__fixtures__' ? [] : walk(relative);
    return /\.(ts|tsx)$/.test(name) ? [relative] : [];
  });
}

const LIB_DIR = 'lib/admin/exchangeRates';
const FEED = `${LIB_DIR}/ecbFeed.ts`;
const MATH = `${LIB_DIR}/rateMath.ts`;
const PARSER = `${LIB_DIR}/ecbRates.ts`;
const RULES = `${LIB_DIR}/exchangeRateRules.ts`;
const SYNC_RULES = `${LIB_DIR}/rateSyncRules.ts`;
const ROUTE = 'app/api/admin/exchange-rates/sync/route.ts';

/** The sync files (C2 and C3), each scanned by name. */
const SYNC_FILES = [FEED, MATH, PARSER, RULES, SYNC_RULES, ROUTE];
const PURE_FILES = [MATH, PARSER, RULES, SYNC_RULES];
const NO_FLOAT_FILES = [MATH, PARSER, ROUTE];
const LIB_FILES = walk(LIB_DIR);
const PAGE_FILES = walk('app/admin/exchange-rates');
const ADMIN_PAGE_FILES = walk('app/admin');

// ── The rules, as functions, so each can be planted ─────────────────────────

const FETCH_CALL = /(?<![A-Za-z0-9_.$])fetch[(]/g;
const fetchCalls = (source: string) => (code(source).match(FETCH_CALL) ?? []).length;

const FULL_URL = /'https:[/][/][^']*'/g;
const fullUrls = (source: string) => code(source).match(FULL_URL) ?? [];

/** Page uses of the page URL constant, with imports removed: all must be the `href`. */
function pageUrlUses(source: string): { uses: number; hrefs: number } {
  const body = code(source).replace(/^import\s[\s\S]*?from\s+'[^']+';$/gm, '');
  return {
    uses: (body.match(/ECB_SOURCE_PAGE_URL/g) ?? []).length,
    hrefs: (body.match(/href=[{]ECB_SOURCE_PAGE_URL[}]/g) ?? []).length,
  };
}

const SERVER_ONLY_IMPORT = /import\s+'server-only'/;

const namesTheFeed =(source: string) => /ECB_DAILY_URL|ecbFeed/.test(code(source));

const BANNED_IMPORTS: ReadonlyArray<readonly [string, RegExp]> = [
  ['provider factory', /from '@[/]lib[/]ai[/]providerFactory'/],
  ['AI provider', /from '@[/]lib[/]ai[/]providers[/]/],
  ['openai SDK', /from 'openai'/],
  ['anthropic SDK', /from '@anthropic-ai[/]/],
  ['groq SDK', /from 'groq-sdk'/],
  ['mistral SDK', /from '@mistralai[/]/],
  ['orchestration', /from '@[/]lib[/]orchestration[/]/],
  ['CurrencyService', /CurrencyService/],
  ['business-os', /from '@[/]lib[/]business-os[/]/],
  ['price review fetch', /pricing-research[/]fetchSources/],
];
const bannedImports = (source: string) => BANNED_IMPORTS.filter(([, pattern]) => pattern.test(code(source))).map(([name]) => name);

const FLOAT_BANS: ReadonlyArray<readonly [string, RegExp]> = [
  ['Number(', /(?<![A-Za-z0-9_.$])Number[(]/],
  ['parseFloat', /parseFloat/],
  ['parseInt', /parseInt/],
  ['Math.', /(?<![A-Za-z0-9_$])Math[.]/],
  ['toFixed(', /[.]toFixed[(]/],
  ['eval(', /(?<![A-Za-z0-9_.$])eval[(]/],
  ['new Function', /new\s+Function\b/],
  ['BigInt literal', /(?<![A-Za-z0-9_$.])[0-9][0-9_]*n\b/],
];
const floatHits = (source: string) => FLOAT_BANS.filter(([, pattern]) => pattern.test(code(source))).map(([name]) => name);

const LOG_CALL = /[Ll]ogger[.](info|warn|error|debug)[(][^;]*;/g;
const BODY_IN_LOG = /[.]text(?![A-Za-z])|(?<![A-Za-z])text:|(?<![A-Za-z'])raw(?![A-Za-z])|[{,] *body(?![A-Za-z])/;
const bodyInLog = (source: string) => (code(source).match(LOG_CALL) ?? []).filter((call) => BODY_IN_LOG.test(call));

// ── The scan ────────────────────────────────────────────────────────────────

it('scans real files', () => {
  for (const file of SYNC_FILES) expect(() => read(file)).not.toThrow();
  expect(LIB_FILES).toEqual(expect.arrayContaining([FEED, MATH, PARSER, RULES, SYNC_RULES]));
  expect(PAGE_FILES.length).toBeGreaterThanOrEqual(5);
  expect(ADMIN_PAGE_FILES.length).toBeGreaterThan(PAGE_FILES.length);
});

describe('one outbound door (SQ-35)', () => {
  it.each(SYNC_FILES)('%s: fetch( only in ecbFeed.ts, exactly once', (file) => {
    expect({ file, calls: fetchCalls(read(file)) }).toEqual({ file, calls: file === FEED ? 1 : 0 });
  });
});

describe('exactly two full URLs in lib/admin/exchangeRates (SQ-49 (3))', () => {
  const EXPECTED: Record<string, string[]> = {
    [FEED]: ["'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'"],
    [SYNC_RULES]: [
      "'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html'",
    ],
  };

  it.each(LIB_FILES)('%s', (file) => {
    expect({ file, urls: fullUrls(read(file)) }).toEqual({ file, urls: EXPECTED[file] ?? [] });
  });

  it('two in total, and none in exchangeRateRules.ts or the route', () => {
    expect(LIB_FILES.flatMap((file) => fullUrls(read(file)))).toHaveLength(2);
    expect(fullUrls(read(RULES))).toEqual([]);
    expect(fullUrls(read(ROUTE))).toEqual([]);
  });
});

describe('the page and the source link (SQ-49 (3))', () => {
  it('the page URL is used at most once under app/admin/exchange-rates, and only as href={ECB_SOURCE_PAGE_URL}', () => {
    const uses = PAGE_FILES.map((file) => ({ file, ...pageUrlUses(read(file)) }));
    for (const entry of uses) expect({ file: entry.file, nonHref: entry.uses - entry.hrefs }).toEqual({ file: entry.file, nonHref: 0 });
    expect(uses.reduce((sum, entry) => sum + entry.uses, 0)).toBeLessThanOrEqual(1);
  });

  it('neither the feed URL nor ecbFeed is named anywhere under app/admin', () => {
    expect(ADMIN_PAGE_FILES.filter((file) => namesTheFeed(read(file)))).toEqual([]);
  });
});

describe('server-only placement', () => {
  it('ecbFeed.ts is server-only', () => {
    expect(read(FEED)).toContain("import 'server-only';");
  });

  it.each(PURE_FILES)('%s is not (the page imports the pure modules)', (file) => {
    expect(code(read(file))).not.toMatch(SERVER_ONLY_IMPORT);
  });
});

describe('banned imports (RR-1, SQ-1, SQ-36, SQ-42)', () => {
  it.each(SYNC_FILES)('%s', (file) => {
    expect({ file, hits: bannedImports(read(file)) }).toEqual({ file, hits: [] });
  });
});

describe('no float on the rate path (SQ-38)', () => {
  it.each(NO_FLOAT_FILES)('%s', (file) => {
    expect({ file, hits: floatHits(read(file)) }).toEqual({ file, hits: [] });
  });
});

describe('no feed body in a log line', () => {
  it('the route logs, and no log call holds .text, body or raw', () => {
    const source = read(ROUTE);
    expect((code(source).match(LOG_CALL) ?? []).length).toBeGreaterThan(0);
    expect(bodyInLog(source)).toEqual([]);
  });

  it('ecbFeed.ts logs nothing at all', () => {
    expect(code(read(FEED)).match(LOG_CALL) ?? []).toEqual([]);
    expect(read(FEED)).not.toMatch(/createLogger|clientLogger/);
  });
});

describe('the fixture', () => {
  const FIXTURE_DIR = `${LIB_DIR}/__fixtures__`;
  const fixtures = readdirSync(join(ROOT, FIXTURE_DIR)).map((file) => `${FIXTURE_DIR}/${file}`);

  it('exists', () => {
    expect(fixtures).toEqual([`${FIXTURE_DIR}/ecb-eurofxref-daily-2026-10-23.xml`]);
  });

  it.each(fixtures)('%s holds no backslash and is dated', (file) => {
    expect(read(file)).not.toContain(String.fromCharCode(92));
    expect(file).toMatch(/-2026-[0-9]{2}-[0-9]{2}[.]xml$/);
  });
});

// ── Planted controls: each rule can match ───────────────────────────────────

describe('planted controls', () => {
  it('fetch( is counted, and refetch( / .fetch( are not', () => {
    expect(fetchCalls("await fetch('x');")).toBe(1);
    expect(fetchCalls('refetch(); window.fetch(a);')).toBe(0);
    expect(fetchCalls("// fetch('x')")).toBe(0);
  });

  it('a full URL literal is found, and one in a comment is not', () => {
    expect(fullUrls("const u = 'https://example.com/a';")).toEqual(["'https://example.com/a'"]);
    expect(fullUrls('// https://example.com')).toEqual([]);
  });

  it('a non-href use of the page URL is caught; an import line is not a use', () => {
    expect(pageUrlUses("import { ECB_SOURCE_PAGE_URL } from '@/x';\n<a href={ECB_SOURCE_PAGE_URL}>")).toEqual({ uses: 1, hrefs: 1 });
    expect(pageUrlUses('fetch(ECB_SOURCE_PAGE_URL);')).toEqual({ uses: 1, hrefs: 0 });
    expect(pageUrlUses('const u = ECB_SOURCE_PAGE_URL;')).toEqual({ uses: 1, hrefs: 0 });
  });

  it('the feed is caught by name', () => {
    expect(namesTheFeed("import { ECB_DAILY_URL } from '@/lib/admin/exchangeRates/ecbFeed';")).toBe(true);
    expect(namesTheFeed("import { x } from './rateSyncRules';")).toBe(false);
  });

  it.each(BANNED_IMPORTS.map(([name]) => name))('banned import %s can match', (name) => {
    const plants: Record<string, string> = {
      'provider factory': "import { getProviderFactory } from '@/lib/ai/providerFactory';",
      'AI provider': "import x from '@/lib/ai/providers/openai';",
      'openai SDK': "import OpenAI from 'openai';",
      'anthropic SDK': "import A from '@anthropic-ai/sdk';",
      'groq SDK': "import G from 'groq-sdk';",
      'mistral SDK': "import M from '@mistralai/mistralai';",
      orchestration: "import o from '@/lib/orchestration/x';",
      CurrencyService: "import { CurrencyService } from '@/lib/services/CurrencyService';",
      'business-os': "import { x } from '@/lib/business-os/finance/x';",
      'price review fetch': "import { fetchLimited } from '@/lib/ai/pricing-research/fetchSources';",
    };
    expect(bannedImports(plants[name])).toEqual([name]);
  });

  it('decimal.ts itself is not a banned import', () => {
    expect(bannedImports("import { parseDecimal } from '@/lib/ai/pricing-research/decimal';")).toEqual([]);
  });

  it.each([
    ['Number(', 'const n = Number(x);'],
    ['parseFloat', 'parseFloat(x)'],
    ['parseInt', 'parseInt(x, 10)'],
    ['Math.', 'Math.max(a, b)'],
    ['toFixed(', 'x.toFixed(2)'],
    ['eval(', 'eval(x)'],
    ['new Function', "new Function('x')"],
    ['BigInt literal', 'const ten = 10n;'],
  ])('float ban %s can match', (name, plant) => {
    expect(floatHits(plant)).toEqual([name]);
  });

  it('BigInt(…) calls and Number.isInteger are allowed', () => {
    expect(floatHits('const ten = BigInt(10); Number.isInteger(p); const v2 = 2;')).toEqual([]);
  });

  it('a body in a log call is caught', () => {
    expect(bodyInLog("requestLogger.info({ text: feed.text }, 'x');")).toHaveLength(1);
    expect(bodyInLog("logger.warn({ body }, 'x');")).toHaveLength(1);
    expect(bodyInLog("logger.warn({ raw }, 'x');")).toHaveLength(1);
    expect(bodyInLog("logger.info({ outcome }, 'x');")).toHaveLength(0);
  });

  it('a server-only import is seen in code, not in prose', () => {
    expect(code("import 'server-only';")).toMatch(SERVER_ONLY_IMPORT);
    expect(code('// no server-only import here')).not.toMatch(SERVER_ONLY_IMPORT);
  });

  it('a backslash is found', () => {
    expect('a\\b').toContain(String.fromCharCode(92));
  });
});
