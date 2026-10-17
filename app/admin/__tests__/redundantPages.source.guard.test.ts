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

const PAGES = [DASHBOARD_PAGE, EXCHANGE_PAGE];
const MARKED = [DASHBOARD_PAGE, EXCHANGE_PAGE, DASHBOARD_ROUTE];

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

/** G-4: guarded routes a file names in code (comments stripped). */
const linkHits = (raw: string): string[] => {
  const code = stripComments(raw);
  return [...PAGE_ROUTES, API_ROUTE].filter((route) => code.includes(route));
};

/** G-5: a console call in code. */
const hasConsole = (raw: string): boolean => /\bconsole\./.test(stripComments(raw));

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

describe('G-5: Exchange rates logs through Pino (RP-7, AC-240)', () => {
  it('has no console call and uses its module logger', () => {
    const raw = read(EXCHANGE_PAGE);
    expect(hasConsole(raw)).toBe(false);
    expect(stripComments(raw)).toMatch(/createLogger\(\{ module: 'AdminExchangeRates' \}\)/);
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
    expect(linkHits("router.push('/admin/platform-dashboard');")).toEqual(['/admin/platform-dashboard']);
    expect(linkHits('await fetch(`/api/admin/dashboard?period=7`);')).toEqual(['/api/admin/dashboard']);
    expect(linkHits('// see /admin/exchange-rates and /api/admin/dashboard\nconst z = 1;')).toEqual([]);
  });

  it('G-5 trips on a planted console call, and ignores one in a comment', () => {
    expect(hasConsole("    console.error('Error loading history:', err);")).toBe(true);
    expect(hasConsole('// the old console.error is gone\nlogger.error({ err }, "x");')).toBe(false);
  });
});
