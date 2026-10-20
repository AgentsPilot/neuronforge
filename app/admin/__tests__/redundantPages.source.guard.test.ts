/**
 * Money M-8 (finance health requirement §11J, BD-34, SA-RR-M8, E-71): the old
 * AgentsPilot Platform dashboard and the Exchange rates admin pages are kept,
 * marked redundant in code comments only, and nothing in the product links to
 * them. The dashboard's API route is marked the same way (its only caller is
 * the dashboard).
 *
 *   G-1 (RP-1, AC-237) the exact REDUNDANT header line is in the three files,
 *       and both pages still start with 'use client';
 *   G-2 (RP-2, AC-233) the sidebar file names neither route, comments included;
 *   G-3 (RP-4, AC-236, M8-R1) neither page shows a redundant notice: no
 *       `redundant-page-notice` and no `AdminNotice` import;
 *   G-4 (RP-5, AC-234) no non-test file under app/, lib/, components/ or hooks/
 *       names either page route in code (comments stripped), and only the
 *       dashboard page names its API route;
 *   G-5 (RP-7, AC-240) Exchange rates logs through Pino, never `console.`.
 *   G-6 (FF-1a, FU-M8-1, BQ-20 answered 2026-10-18) Exchange rates is read
 *       only: no write, RPC, rate service or outside fetch, and its only
 *       Supabase calls are SELECTs on the two rate tables.
 *
 * Amended by Admin Exchange Rates slice 1a (BD-55, SA-R3, workplan SA O-2 /
 * O-4, 2026-10-19): the Exchange rates page is a maintained admin tool again,
 * so it leaves G-1, G-3 and G-5, and G-6 is REPLACED by the Exchange rates
 * guard below, which walks every non-test file under app/admin/exchange-rates/
 * (the page and its components): no Supabase client import, no `.from(`, no
 * `CurrencyService`, no outside host, every `fetch(` targets
 * /api/admin/exchange-rates, no `console.`, and the module logger
 * `AdminExchangeRates`. The Platform dashboard keeps G-1, G-3 and G-5
 * unchanged. G-2, G-4 and the sidebar UNLISTED entry stay (D-6: URL only);
 * G-4's page-route matcher now ignores a match preceded by `/api`, because
 * /api/admin/exchange-rates contains /admin/exchange-rates (SA O-2).
 *
 * Every rule is a pure function run on the real files AND on a planted control
 * that must trip it (M8-R3): a rule that cannot match looks exactly like a rule
 * that found nothing.
 */

import * as fs from 'fs';
import * as path from 'path';

import { stripComments } from '@/tests/helpers/source-scan';

const ROOT = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(ROOT, file), 'utf8');

const DASHBOARD_PAGE = 'app/admin/platform-dashboard/page.tsx';
const EXCHANGE_PAGE = 'app/admin/exchange-rates/page.tsx';
const DASHBOARD_ROUTE = 'app/api/admin/dashboard/route.ts';
const SIDEBAR = 'app/admin/components/AdminSidebar.tsx';

const EXCHANGE_DIR = 'app/admin/exchange-rates';

// Slice 1a: only the dashboard is still a redundant page (G-1, G-3).
const PAGES = [DASHBOARD_PAGE];
const MARKED = [DASHBOARD_PAGE, DASHBOARD_ROUTE];

const HEADER =
  '// REDUNDANT (BD-34, 2026-10-16): superseded by the Money area; kept, not deleted; do not extend or link.';

const PAGE_ROUTES = ['/admin/platform-dashboard', '/admin/exchange-rates'];
const API_ROUTE = '/api/admin/dashboard';
const API_CALLER = DASHBOARD_PAGE;

const WALK_ROOTS = ['app', 'lib', 'components', 'hooks'];
const SKIP_DIRS = new Set(['__tests__', '__snapshots__', 'node_modules']);

// ── The rules, as pure functions ────────────────────────────────────────────

/** G-1: the raw file carries the exact header line. */
const hasHeader = (raw: string): boolean => raw.split(/\r?\n/).some((line) => line === HEADER);

/** G-1: the directive is still the first statement. */
const startsUseClient = (raw: string): boolean => raw.trimStart().startsWith("'use client'");

/** G-2: route fragments a file names anywhere, comments included. */
const sidebarRouteHits = (raw: string): string[] =>
  ['platform-dashboard', 'exchange-rates'].filter((fragment) => raw.includes(fragment));

/** G-3: notice markers in a page's code. */
const noticeHits = (raw: string): string[] => {
  const code = stripComments(raw);
  const hits: string[] = [];
  if (code.includes('redundant-page-notice')) hits.push('redundant-page-notice');
  if (/\bAdminNotice\b/.test(code)) hits.push('AdminNotice');
  return hits;
};

/**
 * G-4: guarded routes a file names in code (comments stripped). A page route
 * preceded by `/api` is an API path, not a link to the page (SA O-2).
 */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const linkHits = (raw: string): string[] => {
  const code = stripComments(raw);
  const pageHits = PAGE_ROUTES.filter((route) => new RegExp(`(?<!/api)${escapeRegExp(route)}`).test(code));
  return [...pageHits, ...(code.includes(API_ROUTE) ? [API_ROUTE] : [])];
};

/** G-5: a console call in code. */
const hasConsole = (raw: string): boolean => /\bconsole\./.test(stripComments(raw));

/**
 * G-6 (slice 1a): what an Exchange rates file must not contain, in code
 * (comments stripped). Each name is one rule with its own planted control.
 */
const EXCHANGE_BANS: ReadonlyArray<readonly [string, RegExp]> = [
  ['supabase client', /@\/lib\/supabase(Client|Server|ServerAuth)\b|@supabase\//],
  ['.from(', /\.from\(/],
  ['CurrencyService', /CurrencyService/],
  ['outside host', /https?:\/\//],
  ['console', /\bconsole\./],
];
const exchangeBanHits = (raw: string): string[] => {
  const code = stripComments(raw);
  return EXCHANGE_BANS.filter(([, pattern]) => pattern.test(code)).map(([name]) => name);
};

/**
 * G-6 (slice 1a): every `fetch(` call whose first argument does not start with
 * the admin rates route. `refetch(` / `prefetch(` are not fetch calls;
 * `window.fetch(` is.
 */
const FETCH_CALL = /(?<![\w$])fetch\s*\(/g;
const ALLOWED_FETCH = /^\s*(['"`])\/api\/admin\/exchange-rates(['"`/?]|\$\{)/;
const strayFetches = (raw: string): string[] => {
  const code = stripComments(raw);
  const stray: string[] = [];
  for (const match of code.matchAll(FETCH_CALL)) {
    const rest = code.slice((match.index ?? 0) + match[0].length);
    if (!ALLOWED_FETCH.test(rest)) stray.push(rest.slice(0, 60).split('\n')[0]);
  }
  return stray;
};

const fetchCount = (raw: string): number => [...stripComments(raw).matchAll(FETCH_CALL)].length;

/** G-6 (slice 1a): the module logger the page logs through (SA-R11). */
const MODULE_LOGGER = /clientLogger\.child\(\{ module: 'AdminExchangeRates' \}\)/;

/** Every non-test `.ts` / `.tsx` file under `dir`, recursively. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(...walk(relative));
      continue;
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    found.push(relative);
  }
  return found;
}

// ── The real files ──────────────────────────────────────────────────────────

describe('G-1: the REDUNDANT header (RP-1, AC-237)', () => {
  it.each(MARKED)('%s carries the exact header line', (file) => {
    expect(hasHeader(read(file))).toBe(true);
  });

  it.each(PAGES)('%s still starts with use client', (file) => {
    expect(startsUseClient(read(file))).toBe(true);
  });
});

describe('G-2: the sidebar names neither route (RP-2, AC-233)', () => {
  it('has no route fragment, comments included', () => {
    expect(sidebarRouteHits(read(SIDEBAR))).toEqual([]);
  });
});

describe('G-3: no visible notice (RP-4, AC-236, M8-R1)', () => {
  it.each(PAGES)('%s has no redundant notice', (file) => {
    expect(noticeHits(read(file))).toEqual([]);
  });
});

describe('G-4: nothing in the product links to the pages (RP-5, AC-234)', () => {
  const files = WALK_ROOTS.flatMap((root) => walk(root));

  it('walked every root and found the marked files (guards the walk itself)', () => {
    for (const root of WALK_ROOTS) {
      expect({ root, any: files.some((f) => f.startsWith(`${root}/`)) }).toEqual({ root, any: true });
    }
    for (const file of MARKED) expect(files).toContain(file);
    expect(files.length).toBeGreaterThan(500);
  });

  it('no file names either page route in code', () => {
    const offenders = files
      .map((file) => ({ file, hits: linkHits(read(file)).filter((r) => PAGE_ROUTES.includes(r)) }))
      .filter((entry) => entry.hits.length > 0);
    expect(offenders).toEqual([]);
  });

  it('only the dashboard page names the dashboard API route', () => {
    const callers = files.filter((file) => linkHits(read(file)).includes(API_ROUTE));
    expect(callers).toEqual([API_CALLER]);
  });
});

describe('G-5: the Platform dashboard has no console call (RP-7)', () => {
  it('has no console call', () => {
    expect(hasConsole(read(DASHBOARD_PAGE))).toBe(false);
  });
});

describe('G-6 (slice 1a): Exchange rates reads and writes only through its admin route (SA-R3)', () => {
  const files = walk(EXCHANGE_DIR);

  it('walks the page and its components, never a test (guards the walk itself)', () => {
    expect(files).toContain(EXCHANGE_PAGE);
    expect(files.some((file) => file.startsWith(`${EXCHANGE_DIR}/components/`))).toBe(true);
    expect(files.filter((file) => file.includes('__tests__'))).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(5);
  });

  it('no file has a Supabase client, .from(, CurrencyService, an outside host or a console call', () => {
    const offenders = files.map((file) => ({ file, hits: exchangeBanHits(read(file)) })).filter((e) => e.hits.length > 0);
    expect(offenders).toEqual([]);
  });

  it('every fetch( targets /api/admin/exchange-rates', () => {
    const offenders = files.map((file) => ({ file, stray: strayFetches(read(file)) })).filter((e) => e.stray.length > 0);
    expect(offenders).toEqual([]);
  });

  // Slice 1c.1 (SQ-12): three LITERAL call sites. The one-currency read is its
  // own call, never folded into the plain read with a variable or a `${query}`
  // suffix (the matcher would accept that; this count and review do not).
  it('the folder does fetch (the rule is not vacuous): one read, one per-currency read and one write', () => {
    expect(files.reduce((sum, file) => sum + fetchCount(read(file)), 0)).toBe(3);
  });

  it('logs through the module logger AdminExchangeRates', () => {
    expect(files.some((file) => MODULE_LOGGER.test(stripComments(read(file))))).toBe(true);
  });

  it('the REDUNDANT header is gone from the page', () => {
    expect(hasHeader(read(EXCHANGE_PAGE))).toBe(false);
    expect(read(EXCHANGE_PAGE)).not.toContain('REDUNDANT');
  });
});

// ── Planted controls (M8-R3): each rule must trip ───────────────────────────

describe('planted controls (no dead rule)', () => {
  it('G-1 trips on a missing or altered header, and on a file not starting with use client', () => {
    expect(hasHeader(`'use client';\n\n${HEADER}\n`)).toBe(true);
    expect(hasHeader(`'use client';\r\n\r\n${HEADER}\r\n`)).toBe(true);
    expect(hasHeader("'use client';\n\nimport x from 'y';\n")).toBe(false);
    expect(hasHeader(`'use client';\n${HEADER.replace('do not extend', 'do extend')}\n`)).toBe(false);
    expect(startsUseClient(`${HEADER}\n'use client';\n`)).toBe(false);
  });

  it('G-2 trips on a sidebar naming a route, in code or in a comment', () => {
    expect(sidebarRouteHits("href: '/admin/platform-dashboard',")).toEqual(['platform-dashboard']);
    expect(sidebarRouteHits('// see /admin/exchange-rates')).toEqual(['exchange-rates']);
    expect(sidebarRouteHits("href: '/admin/finance',")).toEqual([]);
  });

  it('G-3 trips on a planted notice', () => {
    const planted =
      "import { AdminNotice } from '@/app/admin/components/layout/AdminStates';\n" +
      'const x = <AdminNotice testId="redundant-page-notice">Redundant</AdminNotice>;';
    expect(noticeHits(planted)).toEqual(['redundant-page-notice', 'AdminNotice']);
    expect(noticeHits('// an AdminNotice would go here, redundant-page-notice\nconst y = 1;')).toEqual([]);
  });

  it('G-4 trips on a link or a fetch in a planted file, and ignores comments', () => {
    expect(linkHits('<Link href="/admin/exchange-rates">Rates</Link>')).toEqual(['/admin/exchange-rates']);
    expect(linkHits("router.push('/admin/exchange-rates?x=1');")).toEqual(['/admin/exchange-rates']);
    expect(linkHits("router.push('/admin/platform-dashboard');")).toEqual(['/admin/platform-dashboard']);
    expect(linkHits('await fetch(`/api/admin/dashboard?period=7`);')).toEqual(['/api/admin/dashboard']);
    expect(linkHits('// see /admin/exchange-rates and /api/admin/dashboard\nconst z = 1;')).toEqual([]);
  });

  it('G-4 (SA O-2) ignores the admin rates API path, read or write, and still trips on the page beside it', () => {
    expect(linkHits("await fetch('/api/admin/exchange-rates', { cache: 'no-store' });")).toEqual([]);
    expect(linkHits('await fetch(`/api/admin/exchange-rates/${code}`, { method: "PATCH" });')).toEqual([]);
    expect(linkHits("await fetch('/api/admin/exchange-rates');\nconst href = '/admin/exchange-rates';")).toEqual([
      '/admin/exchange-rates',
    ]);
  });

  it('G-5 trips on a planted console call, and ignores one in a comment', () => {
    expect(hasConsole("    console.error('Error loading history:', err);")).toBe(true);
    expect(hasConsole('// the old console.error is gone\nlogger.error({ err }, "x");')).toBe(false);
  });

  it('G-6 (slice 1a) trips on each planted ban, and ignores one in a comment', () => {
    const planted: Record<string, string[]> = {
      'supabase client': [
        "import { supabase } from '@/lib/supabaseClient';",
        "import { supabaseServer } from '@/lib/supabaseServer';",
        "import { createClient } from '@supabase/supabase-js';",
      ],
      '.from(': ["const { data } = await client.from('exchange_rates').select('*');"],
      CurrencyService: [
        "import { createCurrencyService } from '@/lib/services/CurrencyService';",
        'const service = createCurrencyService(client);',
      ],
      'outside host': ["const url = 'https://api.exchangerate-api.com/v4/latest/USD';"],
      console: ["console.error('Error loading rates', err);"],
    };
    for (const [name] of EXCHANGE_BANS) {
      for (const line of planted[name]) {
        expect({ line, hits: exchangeBanHits(line) }).toEqual({ line, hits: [name] });
      }
    }
    expect(exchangeBanHits('// no supabaseClient, .from(, CurrencyService, https:// or console. here\nconst a = 1;')).toEqual([]);
    expect(exchangeBanHits("import { readAdminResponse } from '@/app/admin/components/layout/readAdminResponse';")).toEqual([]);
  });

  it('G-6 (slice 1a) passes the admin rates route and trips on any other fetch target', () => {
    expect(strayFetches("await fetch('/api/admin/exchange-rates', { cache: 'no-store' });")).toEqual([]);
    expect(strayFetches('await fetch(`/api/admin/exchange-rates/${encodeURIComponent(code)}`, { method: "PATCH" });')).toEqual([]);
    expect(strayFetches("await fetch('/api/admin/exchange-ratesX');")).toHaveLength(1);
    expect(strayFetches("await fetch('/api/admin/finance');")).toHaveLength(1);
    expect(strayFetches("await window.fetch('/api/admin/dashboard');")).toHaveLength(1);
    expect(strayFetches('await fetch(url);')).toHaveLength(1);
    expect(strayFetches("await fetch ( '/api/other' );")).toHaveLength(1);
    expect(strayFetches("refetch(); prefetch('/x');")).toEqual([]);
    expect(strayFetches("// fetch('/api/other') was removed\nconst a = 1;")).toEqual([]);
    expect(fetchCount("await fetch('/api/admin/exchange-rates'); refetch();")).toBe(1);
  });

  it('G-6 (slice 1c.1, SQ-12, SA W-4) passes the per-currency read and trips on the same query to another path', () => {
    expect(
      strayFetches('await fetch(`/api/admin/exchange-rates?currency=${encodeURIComponent(code)}`, { cache: "no-store" });')
    ).toEqual([]);
    expect(strayFetches('await fetch(`/api/other?currency=${c}`);')).toHaveLength(1);
  });

  it('G-6 (slice 1a) module logger pattern matches the real form only', () => {
    expect(MODULE_LOGGER.test("const logger = clientLogger.child({ module: 'AdminExchangeRates' });")).toBe(true);
    expect(MODULE_LOGGER.test("const logger = clientLogger.child({ module: 'AdminOther' });")).toBe(false);
  });
});
