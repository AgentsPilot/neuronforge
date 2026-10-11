/**
 * C-14: the shared admin layout folder guard and the migrated-pages registry
 * (Admin Layout Standard §6.1, S-1 to S-10).
 *
 * Pure `fs` reads inside the existing Jest gate: no script, no workflow (S-10).
 * The folder is WALKED, so a file added later is covered before anyone
 * remembers this guard. Every pattern carries a "no dead regex" self-test: a
 * rule that cannot match looks exactly like a rule that found nothing.
 *
 * Part (a): the shared-folder rules. The import allow-list (S-3) applies to
 * source files only (SA W-1): tests import testing libraries, `fs` and `path`.
 * The special-file-name rule (S-2) applies to every file, tests included.
 *
 * Part (b): the registry of migrated pages. Each entry lists the page's FILES
 * (Health renders through `HealthGrid.tsx`, re-check R-1).
 *
 * Amended by L-1b: the green rule is tightened (L-1a code review CR-1, SA
 * M-3: only an ALL-CAPS constant whose initializer is a plain string or object
 * literal counts) and asserts EXACTLY one green constant, in `StatusChip.tsx`
 * (RC-5, SA Q-9); `KpiStrip.tsx`, `StatusChip.tsx` and `adminDialog.ts` join
 * the expected files; Scheduled jobs & queues joins the registry.
 *
 * Amended by L-1c: `DatePresets.tsx`, `adminWindow.ts` and `useAdminFilters.ts`
 * join the expected files (G-1); the one named S-3 exception,
 * `@/app/admin/components/adminWindowPresets`, joins the allow-list (G-2, SA
 * ruling on L-1b Q-13 / L-1c Q-2) with a check that the file it names imports
 * nothing and is not a client module (G-3) and near-miss self-tests (G-4); S-6
 * is made non-vacuous: `useAdminFilters.ts` must write history and no file may
 * call `pushState` (G-5); Audit trail part 1 joins the registry (G-6).
 *
 * Amended by L-1d: `AdminDrawer.tsx`, `OpenRowButton.tsx` and `adminTable.ts`
 * join the expected files (G-1); the Audit trail registry entry drops "part 1"
 * from its label (its files are unchanged). No rule changes: the drawer's
 * sections are `div role="group"`, never `<section` (S-8), and the new tones
 * are sky and amber, never green (S-7).
 *
 * Amended by L-1e: `AdminBusinessPicker.tsx` joins the expected files; a new
 * rule, L-1e F-1 (SA M-3; named apart from the L-1c G-3), allows a `fetch` call
 * in that one file only, so the shared helpers stay fetch-free and a second
 * fetching component needs a deliberate edit here; the Audit trail registry
 * comment notes the original picker left the page.
 *
 * Amended by L-2a: AI cost & usage (part a) joins the registry with its five
 * files. No new shared file, so the expected files and part (a) are unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = process.cwd();
const LAYOUT_DIR = 'app/admin/components/layout';
const ALIAS = '@/app/admin/components/layout/';

const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy or trip it (as in `health.source.guard`). */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Every file under the folder, as repo-relative forward-slash paths. */
function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walk(relative));
    else found.push(relative);
  }
  return found.sort();
}

const ALL_FILES = walk(LAYOUT_DIR);
const isTest = (file: string) => file.includes('/__tests__/');
const SOURCE_FILES = ALL_FILES.filter((f) => !isTest(f) && /\.tsx?$/.test(f));
const TSX_SOURCES = SOURCE_FILES.filter((f) => f.endsWith('.tsx'));

const EXPECTED_SOURCES = [
  'AdminBusinessPicker.tsx',
  'AdminDrawer.tsx',
  'AdminFilterBar.tsx',
  'AdminPageHeader.tsx',
  'AdminStates.tsx',
  'DatePresets.tsx',
  'KpiStrip.tsx',
  'OpenRowButton.tsx',
  'StatusChip.tsx',
  'adminDialog.ts',
  'adminFormat.ts',
  'adminTable.ts',
  'adminWindow.ts',
  'readAdminResponse.ts',
  'readJsonBody.ts',
  'useAdminFilters.ts',
].map((name) => `${LAYOUT_DIR}/${name}`);

// ── Rule helpers (each proved by a self-test below) ─────────────────────────

/** S-2: a Next special-file name would make a shared file a render entry or a route. */
const SPECIAL_NAMES = ['page', 'layout', 'template', 'default', 'loading', 'error', 'not-found', 'global-error', 'route'];
function hasSpecialName(file: string): boolean {
  const base = path.posix.basename(file).split('.')[0];
  return SPECIAL_NAMES.includes(base);
}

/** Every module specifier: `import … from`, `import '…'`, `export … from` (type-only included). */
function specifiersOf(code: string): string[] {
  const found: string[] = [];
  for (const m of code.matchAll(/(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) found.push(m[1]);
  return found;
}

/** S-3 allow-list. */
const ALLOWED_EXACT = new Set([
  'react',
  'lucide-react',
  'next/link',
  'next/navigation',
  '@/components/ui/sheet',
  '@/components/ui/dialog',
  '@/lib/logger/client',
  // The one named exception (G-2, SA ruling on L-1b Q-13 / L-1c Q-2): the
  // shared window presets stay where they are because a `lib/` module and the
  // finance route import them too, so they cannot move into this folder. Safe
  // only because the file imports nothing and is not a client module (G-3).
  '@/app/admin/components/adminWindowPresets',
]);

/** The file the G-2 exception names. */
const PRESETS_FILE = 'app/admin/components/adminWindowPresets.ts';
function isAllowedImport(spec: string): boolean {
  if (ALLOWED_EXACT.has(spec)) return true;
  if (spec.startsWith('./') && !spec.includes('../')) return true;
  return spec.startsWith(ALIAS) && !spec.includes('../');
}

/** S-4: named refusals, so a failure names the rule even though S-3 covers them. */
function isRefusedImport(spec: string): boolean {
  return (
    spec.startsWith('@/lib/business-os') ||
    spec.startsWith('@/lib/repositories') ||
    /supabase/i.test(spec) ||
    spec === 'server-only'
  );
}

/** S-5. */
const V2_TOKEN = /var\(--v2-/;
const DARK_VARIANT = /(?<![\w-])dark:/;
const CONSOLE = /console\./;

/** S-6. */
const JSON_CALL = /\.json\(/;
const HISTORY_WRITE = /history\.(?:pushState|replaceState)/;
const PUSH_STATE = /history\.pushState/;

/**
 * L-1e F-1 (SA M-3): a call to `fetch`, bare or as a member (`window.fetch(`),
 * not part of a longer name (`refetch(`, `prefetch(`). Run on comment-stripped
 * code. Only `FETCHING_FILE` may match.
 */
const FETCH_CALL = /(?<![A-Za-z0-9_$])fetch\s*\(/;
const FETCHING_FILE = 'AdminBusinessPicker.tsx';

/** S-8. */
const SECTION = /<section\b/;
const REGION_ROLE = /role=\{?["']region["']/;

/** S-7 / RC-5: the 13 colour prefixes of the Health guard, followed by green or emerald. */
const GREEN_PREFIXES = [
  'bg', 'text', 'border', 'from', 'to', 'via', 'shadow', 'outline',
  'decoration', 'divide', 'ring', 'fill', 'stroke',
];
const GREEN_CLASS = new RegExp(`(?<![\\w-])(?:${GREEN_PREFIXES.join('|')})-(?:green|emerald)-`, 'g');

/** CR-1: a green constant's name is ALL-CAPS (letters, digits, underscores, starting with a capital). */
const CONSTANT_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * CR-1 / SA M-3: a declaration counts as a green constant only when its
 * initializer is a plain literal, so the green cannot be built at runtime or
 * rendered by a component: it starts with a single or double quote (a string)
 * or `{` (an object literal), never a backtick (a template literal can embed
 * any expression); and the span to the next `;` holds no `(` (a call, or an
 * arrow's parameters), no `=>` and no `<` (JSX).
 */
function isLiteralConstant(name: string, initializer: string): boolean {
  if (!CONSTANT_NAME.test(name)) return false;
  const first = initializer.trimStart().charAt(0);
  if (first !== "'" && first !== '"' && first !== '{') return false;
  return !initializer.includes('(') && !initializer.includes('=>') && !initializer.includes('<');
}

/**
 * Every green match must sit inside one `const NAME = <literal>;` declaration
 * (`isLiteralConstant`). Returns the names of the green-holding constants
 * across ALL given files (SA W-7), the files that hold them, and the green
 * matches found anywhere else, each with its file.
 */
function greenVerdict(files: Array<{ file: string; code: string }>): {
  names: Set<string>;
  files: Set<string>;
  outside: string[];
} {
  const names = new Set<string>();
  const holders = new Set<string>();
  const outside: string[] = [];
  for (const { file, code } of files) {
    const decls = [...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*(=?)/g)].map((m) => {
      const start = m.index ?? 0;
      const semicolon = code.indexOf(';', start);
      const end = semicolon < 0 ? code.length : semicolon;
      const hasInitializer = m[2] === '=';
      const initializer = hasInitializer ? code.slice(start + m[0].length, end) : '';
      return { name: m[1], start, end, literal: hasInitializer && isLiteralConstant(m[1], initializer) };
    });
    for (const match of code.matchAll(GREEN_CLASS)) {
      const at = match.index ?? 0;
      const owner = decls.filter((d) => d.start <= at && at <= d.end).pop();
      if (owner && owner.literal) {
        names.add(owner.name);
        holders.add(file);
      } else {
        outside.push(`${file}: ${match[0]}`);
      }
    }
  }
  return { names, files: holders, outside };
}

// ── Part (a) ────────────────────────────────────────────────────────────────

describe('C-14 part (a): the shared admin layout folder', () => {
  it('finds the expected files (the scan cannot be empty)', () => {
    for (const file of EXPECTED_SOURCES) {
      expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
      expect(SOURCE_FILES).toContain(file);
    }
  });

  it.each(ALL_FILES)('%s has no Next special-file name (S-2)', (file) => {
    expect(hasSpecialName(file)).toBe(false);
  });

  it.each(TSX_SOURCES)("%s starts with 'use client'", (file) => {
    expect(read(file).trimStart().startsWith("'use client'")).toBe(true);
  });

  it.each(SOURCE_FILES)('%s imports only from the allow-list (S-3)', (file) => {
    const specs = specifiersOf(codeOf(read(file)));
    expect({ file, refused: specs.filter((s) => !isAllowedImport(s)) }).toEqual({ file, refused: [] });
  });

  it.each(SOURCE_FILES)('%s imports no Business OS module, repository, Supabase or server-only (S-4)', (file) => {
    const specs = specifiersOf(codeOf(read(file)));
    expect({ file, refused: specs.filter(isRefusedImport) }).toEqual({ file, refused: [] });
  });

  it.each(SOURCE_FILES)('%s has no --v2- token, no dark: variant and no console (S-5)', (file) => {
    const code = codeOf(read(file));
    expect(code).not.toMatch(V2_TOKEN);
    expect(code).not.toMatch(DARK_VARIANT);
    expect(code).not.toMatch(CONSOLE);
  });

  it.each(SOURCE_FILES)('%s calls .json( only if it is readJsonBody.ts, and writes history only in useAdminFilters.ts (S-6)', (file) => {
    const code = codeOf(read(file));
    const base = path.posix.basename(file);
    if (base !== 'readJsonBody.ts') expect(code).not.toMatch(JSON_CALL);
    if (base !== 'useAdminFilters.ts') expect(code).not.toMatch(HISTORY_WRITE);
  });

  it('readJsonBody.ts is the one file that reads the body (S-6 is not vacuous)', () => {
    expect(codeOf(read(`${LAYOUT_DIR}/readJsonBody.ts`))).toMatch(JSON_CALL);
  });

  it('useAdminFilters.ts writes history, and no file in the folder calls pushState (S-6 is not vacuous, G-5)', () => {
    expect(codeOf(read(`${LAYOUT_DIR}/useAdminFilters.ts`))).toMatch(HISTORY_WRITE);
    for (const file of SOURCE_FILES) {
      expect({ file, push: PUSH_STATE.test(codeOf(read(file))) }).toEqual({ file, push: false });
    }
  });

  it.each(SOURCE_FILES)('%s calls fetch only if it is AdminBusinessPicker.tsx (L-1e F-1)', (file) => {
    if (path.posix.basename(file) !== FETCHING_FILE) expect(codeOf(read(file))).not.toMatch(FETCH_CALL);
  });

  it('AdminBusinessPicker.tsx is the one file that fetches (L-1e F-1 is not vacuous)', () => {
    expect(codeOf(read(`${LAYOUT_DIR}/${FETCHING_FILE}`))).toMatch(FETCH_CALL);
    const fetching = SOURCE_FILES.filter((file) => FETCH_CALL.test(codeOf(read(file))));
    expect(fetching).toEqual([`${LAYOUT_DIR}/${FETCHING_FILE}`]);
  });

  it('the one S-3 exception names a file with no imports that is not a client module (G-3)', () => {
    const source = read(PRESETS_FILE);
    expect(specifiersOf(codeOf(source))).toEqual([]);
    expect(source.trimStart().startsWith("'use client'")).toBe(false);
    expect(source.trimStart().startsWith('"use client"')).toBe(false);
  });

  it('holds exactly one green constant across the folder, in StatusChip.tsx, and no green outside it (S-7, RC-5)', () => {
    const verdict = greenVerdict(SOURCE_FILES.map((file) => ({ file, code: codeOf(read(file)) })));
    expect(verdict.outside).toEqual([]);
    expect(verdict.names.size).toBe(1);
    // SA Q-9: pin the file and the count, not the name (Q-3 may reshape the constant).
    expect([...verdict.files]).toEqual([`${LAYOUT_DIR}/StatusChip.tsx`]);
  });

  it.each(SOURCE_FILES)('%s renders no landmark region (S-8)', (file) => {
    const code = codeOf(read(file));
    expect(code).not.toMatch(SECTION);
    expect(code).not.toMatch(REGION_ROLE);
  });
});

describe('C-14 part (a) self-tests (no dead regex)', () => {
  it('S-2 catches every special name, in any extension, and passes the real names', () => {
    for (const name of SPECIAL_NAMES) {
      expect(hasSpecialName(`${LAYOUT_DIR}/${name}.tsx`)).toBe(true);
      expect(hasSpecialName(`${LAYOUT_DIR}/__tests__/${name}.test.ts`)).toBe(true);
    }
    expect(hasSpecialName(`${LAYOUT_DIR}/AdminError.tsx`)).toBe(false);
    expect(hasSpecialName(`${LAYOUT_DIR}/AdminStates.tsx`)).toBe(false);
  });

  it('the specifier reader sees from-imports, side-effect imports, re-exports and type-only imports', () => {
    const code = [
      "import { a } from 'react';",
      "import type { B } from '@/lib/admin/x';",
      "import './side';",
      "export { c } from '../up';",
      "export * from '@/lib/business-os/y';",
    ].join('\n');
    expect(specifiersOf(code).sort()).toEqual(['../up', './side', '@/lib/admin/x', '@/lib/business-os/y', 'react'].sort());
  });

  it('S-3 refuses lib, parent paths and other app paths; passes the allow-list', () => {
    expect(isAllowedImport('@/lib/admin/health/healthTypes')).toBe(false);
    expect(isAllowedImport('../jobs/jobsFormat')).toBe(false);
    expect(isAllowedImport('./x/../../y')).toBe(false);
    expect(isAllowedImport('@/app/admin/components/jobs/jobsFormat')).toBe(false);
    expect(isAllowedImport('@/components/ui/button')).toBe(false);
    expect(isAllowedImport('react')).toBe(true);
    expect(isAllowedImport('./readJsonBody')).toBe(true);
    expect(isAllowedImport(`${ALIAS}adminFormat`)).toBe(true);
    expect(isAllowedImport('@/lib/logger/client')).toBe(true);
  });

  it('G-4: the presets exception is exact; near misses and other app paths are refused', () => {
    expect(isAllowedImport('@/app/admin/components/adminWindowPresets')).toBe(true);
    expect(isAllowedImport('@/app/admin/components/adminWindowPresetsX')).toBe(false);
    expect(isAllowedImport('@/app/admin/components/adminWindowPresets/x')).toBe(false);
    expect(isAllowedImport('@/app/admin/components/health/HealthTile')).toBe(false);
  });

  it('S-4 refuses Business OS, repositories, Supabase and server-only', () => {
    expect(isRefusedImport('@/lib/business-os/entitlements/catalog')).toBe(true);
    expect(isRefusedImport('@/lib/repositories/UserRepository')).toBe(true);
    expect(isRefusedImport('@/lib/supabaseServer')).toBe(true);
    expect(isRefusedImport('@supabase/supabase-js')).toBe(true);
    expect(isRefusedImport('server-only')).toBe(true);
    expect(isRefusedImport('react')).toBe(false);
  });

  it('S-5 catches a --v2- token, a dark: variant and console; [color-scheme:dark] is not a dark: variant', () => {
    expect('style={{ color: "var(--v2-primary)" }}').toMatch(V2_TOKEN);
    expect('className="dark:bg-slate-900"').toMatch(DARK_VARIANT);
    expect('className="md:dark:text-white"').toMatch(DARK_VARIANT);
    expect('className="min-h-screen [color-scheme:dark] bg-slate-900"').not.toMatch(DARK_VARIANT);
    expect('console.log(x)').toMatch(CONSOLE);
  });

  it('S-6 catches a body read and a history write', () => {
    expect('await response.json()').toMatch(JSON_CALL);
    expect('window.history.replaceState(null, "", url)').toMatch(HISTORY_WRITE);
    expect('window.history.pushState(null, "", url)').toMatch(HISTORY_WRITE);
    expect('window.history.pushState(null, "", url)').toMatch(PUSH_STATE);
    expect('window.history.replaceState(null, "", url)').not.toMatch(PUSH_STATE);
  });

  it('L-1e F-1 catches fetch(, fetch ( and window.fetch(; ignores refetch(, prefetch( and a commented fetch(', () => {
    expect('const r = await fetch(url);').toMatch(FETCH_CALL);
    expect('const r = await fetch (url);').toMatch(FETCH_CALL);
    expect('const r = await window.fetch(url);').toMatch(FETCH_CALL);
    expect('const r = refetch(url);').not.toMatch(FETCH_CALL);
    expect('router.prefetch(url);').not.toMatch(FETCH_CALL);
    const commented = ['// fetch(url)', '/* await fetch(url) */', 'const a = 1;'].join(String.fromCharCode(10));
    expect(codeOf(commented)).not.toMatch(FETCH_CALL);
    // The comments themselves would match: the strip is what keeps them out.
    expect(commented).toMatch(FETCH_CALL);
  });

  it('S-8 catches a section and a region role in either quote', () => {
    expect('<section aria-label="x">').toMatch(SECTION);
    expect('<div role="region">').toMatch(REGION_ROLE);
    expect("<div role='region'>").toMatch(REGION_ROLE);
    expect('<div role="status">').not.toMatch(REGION_ROLE);
  });

  it('S-7 / RC-5: one green constant passes; green outside a constant fails', () => {
    const one = greenVerdict([{ file: 'a.tsx', code: "const GREEN = { card: 'bg-emerald-500/10 text-green-300' };" }]);
    expect(one.outside).toEqual([]);
    expect([...one.names]).toEqual(['GREEN']);

    const stray = greenVerdict([{ file: 'a.tsx', code: "const A = 1;\nreturn <p className=\"text-green-300\" />" }]);
    expect(stray.outside).toHaveLength(1);
  });

  it('CR-1 / M-3: green that is not a literal ALL-CAPS constant is reported outside, with its file', () => {
    const notConstants = [
      // (a) the arrow component from CR-1
      'const Badge = () => <span className="bg-green-500" />;',
      // (b) an ALL-CAPS arrow
      "const OK = () => 'bg-green-500';",
      // (c) a camelCase constant
      "const okStyle = 'bg-green-500';",
      // (d) an ALL-CAPS constant built by a call
      "const OK = make('bg-green-500');",
      // (g) SA M-3: a call inside an object literal
      "const GREEN = { a: make('bg-green-500') };",
      // SA M-3: a template literal can embed any expression
      'const GREEN = `bg-green-500 ${x}`;',
    ];
    for (const code of notConstants) {
      const verdict = greenVerdict([{ file: 'x.tsx', code }]);
      expect({ code, names: [...verdict.names] }).toEqual({ code, names: [] });
      expect({ code, outside: verdict.outside }).toEqual({ code, outside: ['x.tsx: bg-green-'] });
    }
  });

  it('CR-1: a literal ALL-CAPS string or object constant is counted', () => {
    // (e)
    const str = greenVerdict([{ file: 'x.tsx', code: "const OK_TONE = 'border-emerald-500/40';" }]);
    expect(str.outside).toEqual([]);
    expect([...str.names]).toEqual(['OK_TONE']);
    expect([...str.files]).toEqual(['x.tsx']);
    // (f)
    const obj = greenVerdict([{ file: 'x.tsx', code: "const GREEN = { card: 'bg-emerald-500/10' };" }]);
    expect(obj.outside).toEqual([]);
    expect([...obj.names]).toEqual(['GREEN']);
    // A double-quoted string counts too.
    expect([...greenVerdict([{ file: 'x.tsx', code: 'const OK2 = "ring-green-400";' }]).names]).toEqual(['OK2']);
  });

  it('S-7 / RC-5: two green constants in two files count across the folder (SA W-7)', () => {
    const two = greenVerdict([
      { file: 'a.tsx', code: "const GREEN_A = 'bg-green-500';" },
      { file: 'b.tsx', code: "const GREEN_B = 'ring-emerald-400';" },
    ]);
    expect(two.outside).toEqual([]);
    expect(two.names.size).toBe(2);
  });

  it('the green pattern catches every prefix and ignores slate', () => {
    for (const prefix of GREEN_PREFIXES) {
      expect(`${prefix}-green-500`).toMatch(new RegExp(GREEN_CLASS.source));
      expect(`hover:${prefix}-emerald-300`).toMatch(new RegExp(GREEN_CLASS.source));
      expect(`${prefix}-slate-800`).not.toMatch(new RegExp(GREEN_CLASS.source));
    }
  });
});

// ── Part (b): the migrated-pages registry ───────────────────────────────────

const MIGRATED_PAGES = [
  {
    page: '/admin (Health)',
    files: [
      'app/admin/page.tsx',
      'app/admin/components/health/HealthGrid.tsx',
      'app/admin/components/health/HealthTile.tsx',
    ],
  },
  {
    // The Jobs guard's CLIENT_FILES (Admin Layout Standard L-1b).
    page: '/admin/jobs-queues (Scheduled jobs & queues)',
    files: [
      'app/admin/jobs-queues/page.tsx',
      'app/admin/components/jobs/JobsQueuesView.tsx',
      'app/admin/components/jobs/QueueItemsPanel.tsx',
      'app/admin/components/jobs/DrainNowDialog.tsx',
      'app/admin/components/jobs/CancelQueueItemDialog.tsx',
      'app/admin/components/jobs/RetryQueueItemDialog.tsx',
    ],
  },
  {
    // G-6. The original `BusinessAccountPicker.tsx` is deliberately not listed:
    // it is unmigrated (it still calls `.json(`), and since L-1e it is no longer
    // on this page (the shared `AdminBusinessPicker` replaced it). It stays in
    // the folder for Activity and Finance until L-8 deletes it (R-11).
    page: '/admin/audit-trail (Audit trail)',
    files: ['app/admin/audit-trail/page.tsx', 'app/admin/audit-trail/auditTrailFilters.ts'],
  },
  {
    // L-2a (part a): header, KPI strip, filter bar, states, URL. The table and
    // drawers in page.tsx are L-2b.
    page: '/admin/analytics (AI cost & usage)',
    files: [
      'app/admin/analytics/page.tsx',
      'app/admin/analytics/analyticsTypes.ts',
      'app/admin/analytics/analyticsFilters.ts',
      'app/admin/analytics/components/AnalyticsKpis.tsx',
      'app/admin/analytics/components/AnalyticsFilterBar.tsx',
    ],
  },
] as const;

const PAGE_HEADER_IMPORT = /import\s*\{[^}]*\bAdminPageHeader\b[^}]*\}\s*from\s*['"]@\/app\/admin\/components\/layout\/AdminPageHeader['"]/;
const H1 = /<h1\b/;

/** A relative specifier from `file` that lands in the shared folder (S-1 wants the alias). */
function reachesLayoutRelatively(file: string, spec: string): boolean {
  if (!spec.startsWith('.')) return false;
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
  return target === LAYOUT_DIR || target.startsWith(`${LAYOUT_DIR}/`);
}

describe('C-14 part (b): migrated pages', () => {
  describe.each(MIGRATED_PAGES.map((entry) => [entry.page, entry.files] as const))('%s', (_page, files) => {
    it('lists files that exist', () => {
      for (const file of files) expect(fs.existsSync(path.join(ROOT, file))).toBe(true);
    });

    it('imports AdminPageHeader from the shared folder', () => {
      expect(files.some((file) => PAGE_HEADER_IMPORT.test(codeOf(read(file))))).toBe(true);
    });

    it.each(files)('%s has no own <h1 and no direct .json(', (file) => {
      const code = codeOf(read(file));
      expect(code).not.toMatch(H1);
      expect(code).not.toMatch(JSON_CALL);
    });

    it.each(files)('%s reaches the shared folder only through the alias (S-1)', (file) => {
      const specs = specifiersOf(codeOf(read(file)));
      expect({ file, relative: specs.filter((s) => reachesLayoutRelatively(file, s)) }).toEqual({ file, relative: [] });
    });
  });
});

describe('C-14 part (b) self-tests (no dead regex)', () => {
  it('the header import pattern matches the alias import and refuses a relative one', () => {
    expect("import { AdminPageHeader } from '@/app/admin/components/layout/AdminPageHeader';").toMatch(PAGE_HEADER_IMPORT);
    expect("import { AdminPageHeader } from '../layout/AdminPageHeader';").not.toMatch(PAGE_HEADER_IMPORT);
  });

  it('the h1 pattern catches an own h1', () => {
    expect('<h1 className="text-xl">Health</h1>').toMatch(H1);
    expect('<h2>x</h2>').not.toMatch(H1);
  });

  it('a relative import into the shared folder is caught; the alias and a sibling are not', () => {
    const file = 'app/admin/components/health/HealthGrid.tsx';
    expect(reachesLayoutRelatively(file, '../layout/AdminStates')).toBe(true);
    expect(reachesLayoutRelatively(file, `${ALIAS}AdminStates`)).toBe(false);
    expect(reachesLayoutRelatively(file, './HealthTile')).toBe(false);
  });
});
