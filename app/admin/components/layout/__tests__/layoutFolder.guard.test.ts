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
 *
 * Amended by L-3: Archiving joins the registry; no rule change. Its two shared
 * exports (the `neutral` StatusChip tone and the `badge` prop of
 * AdminPageHeader) add no file, no import outside the folder and no green.
 *
 * Amended by L-5: Plans & entitlements joins the registry; no rule change and
 * no shared source change.
 *
 * Amended by L-6: Signup Invites joins the registry; no rule change and no
 * shared source change. Its `EnforcementNote.tsx` is not listed: the user
 * removed the note (D-18), so the file no longer exists.
 *
 * Amended by L-7: Messages joins the registry; no rule change and no shared
 * source change. Its `messagesTypes.ts` is not listed: no markup and no read.
 *
 * Amended by L-8b: `useDrawerResource.ts` joins the expected files (E-10); no
 * rule change. The hook never fetches and never reads a body (the page's own
 * `read` does both, SA Q-9), so L-1e F-1 and S-6 hold for it unchanged. The
 * Business OS AI page does not join the registry yet (deferred to L-10, SA Q-3).
 *
 * Amended by L-10: Business OS AI joins the registry as one entry for its
 * three tabs; no rule change and no shared source change. The parked
 * `LedgerCheckPanel.tsx` (still `.json(`, F-123) and `Chip.tsx` are left out
 * by name, with the reason beside the entry.
 *
 * Amended by L-12: Admin users joins the registry; no rule change and no
 * shared source change.
 *
 * Amended by LF-7 (Admin Layout Follow-ups): `AdminConfirmDialog.tsx`, the
 * shared confirmation dialog, joins the expected files. No rule change: its
 * imports (`react`, `lucide-react`, `@/components/ui/dialog` and siblings
 * through `./`) were already on the S-3 allow-list, and it never fetches. The
 * Messages registry entry drops `MessagesConfirmDialog.tsx`, deleted by LF-7.
 *
 * Amended by Finance F-2: Finance joins the registry (SA-W2) with its page, its
 * view and its hook; F-4 and F-5 extend the entry. No rule change. The one
 * shared source change is `readAdminResponse.ts` exporting `adminReadFallback`
 * (SA-W1), which adds no import.
 *
 * Amended by Finance F-5: the Finance entry gains the KPI strip (now the
 * shared `KpiStrip` / `KpiTile`) and the section frame (the tiles' anchor
 * targets). No rule change: `StatusChip.tsx` still holds the one green
 * constant (now the object `OK_GREEN`, SA Q-3), and `KpiStrip.tsx` adds only
 * `next/link` and `./StatusChip`, both on the S-3 allow-list.
 *
 * Amended by Exchange rates 1c.2: the Exchange rates entry gains its filter
 * spec `exchangeRatesFilters.ts` (as `usersFilters.ts` and `costsFilters.ts`
 * sit in theirs). Registration only: no rule change and no shared source change.
 *
 * Amended by Admin Exchange Rates slice 2b (SQ-22): the Exchange rates page is
 * deleted (its old URL redirects to Finance's Exchange rates tab), so its entry
 * is removed and its five non-page files move to the Finance entry, listed
 * there and only there. Registration only: no rule change and no shared source
 * change.
 *
 * Amended by Money MK-3a (SA-WP-MK3 condition 7, ruled): `BlockKpi.tsx` joins
 * the expected files (promoted from Finance, SA-Q-MK3-8; it imports its
 * siblings only, both on the S-3 allow-list, and never fetches). Charge checks
 * became the AI cost page: its entry `/admin/finance/charges (Charge checks)`
 * is renamed `/admin/ai-cost (AI cost)`, the deleted page and `CostsKpis.tsx`
 * leave it, and the new page, `AiCostKpis.tsx` and `RecordedSection.tsx` join.
 * MK-3b adds the Calls tab's files to the same entry.
 *
 * Amended by Money MK-3b (ruled): the AI calls & usage entry is removed and its
 * files, less the deleted page and `AnalyticsKpis.tsx`, join the AI cost entry
 * with `CallsTab.tsx`, `CallsSummary.tsx` and the page's view, tabs, spec and
 * report read. No rule change and no shared source change.
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
  'AdminConfirmDialog.tsx',
  'AdminDrawer.tsx',
  'AdminFilterBar.tsx',
  'AdminPageHeader.tsx',
  'AdminStates.tsx',
  // Money MK-3 (SA-Q-MK3-8, MK-1 ruling): the block KPI, promoted from Finance; imports siblings only.
  'BlockKpi.tsx',
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
  // Money MK-10 (SA-Q-MK10-1, option A): the shared D-17 row click; pure, no fetch.
  'rowOpenClick.ts',
  'useAdminFilters.ts',
  'useDrawerResource.ts',
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
    // The Jobs guard's CLIENT_FILES (Admin Layout Standard L-1b), except
    // `ReconcileTopUpsDialog.tsx` (follow-ups LF-4c), deliberately NOT listed:
    // a money dialog moved from Businesses that still reads its route with
    // `.json(` (L-4b SA Q-5, SA-C12 precedent). The Jobs guard pins its request.
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
    // G-6. The original `BusinessAccountPicker.tsx` was deleted in Money M-1
    // (finance health §11D, M1-FR-2): Finance moved to the shared
    // `AdminBusinessPicker`, as Audit trail (L-1e) and Activity (L-8a) had.
    page: '/admin/audit-trail (Audit trail)',
    files: ['app/admin/audit-trail/page.tsx', 'app/admin/audit-trail/auditTrailFilters.ts'],
  },
  {
    // L-3: header with the Runs off badge, KPI strip, Refresh-only bar, states,
    // the run history table and the confirm dialog class.
    page: '/admin/archiving (Archiving)',
    files: [
      'app/admin/archiving/page.tsx',
      'app/admin/archiving/components/ArchiveConfirmDialog.tsx',
      'app/admin/archiving/components/ArchivingKpis.tsx',
    ],
  },
  {
    // L-4a (the list) and L-4b (the row detail in the drawer, SA L-4a Q-8).
    // Follow-ups LF-4a.2 adds the drawer layout: BusinessOsPanel joins because
    // its two reads now go through `readJsonBody` (SA-C12) with the request
    // unchanged, plus the strip, the folds and the "All products" block, which
    // read nothing. The credit, top-up and delete components are deliberately
    // NOT listed (L-4b SA Q-5, the G-6 precedent): CreditsBlock,
    // CreditFormDialog, BoostBlock, BoostCapDialog and DeleteBusinessDialog
    // each still read their own route with `.json(`, and their error copy is
    // pinned by their own render and contract tests. Converting them is money
    // work, not a layout change (LF-4b). The reconcile dialog left this folder
    // in LF-4c (now `app/admin/components/jobs/ReconcileTopUpsDialog.tsx`).
    page: '/admin/users (Businesses)',
    files: [
      'app/admin/users/page.tsx',
      'app/admin/users/usersFilters.ts',
      'app/admin/users/useBusinessDetails.ts',
      'app/admin/users/usersFormat.ts',
      'app/admin/users/components/BusinessesKpis.tsx',
      'app/admin/users/components/BusinessDetail.tsx',
      'app/admin/users/components/BusinessAuditSection.tsx',
      'app/admin/users/components/BusinessOsPanel.tsx',
      'app/admin/users/components/BusinessSummaryStrip.tsx',
      'app/admin/users/components/drawerFolds.tsx',
      'app/admin/users/components/AllProductsUsage.tsx',
      // Follow-ups LF-4d: the section and part boxes (BD-16); reads nothing.
      'app/admin/users/components/DrawerBox.tsx',
    ],
  },
  {
    // L-5: header with the Read-only badge, KPI strip, Refresh-only bar, states,
    // the plan-card chips (the plans read through readAdminResponse) and the
    // snapshot table, which the Businesses drawer renders. The account lookup
    // was removed in follow-ups LF-2. `types.ts` is not listed: it is
    // untouched and has no markup.
    page: '/admin/business-os-tiers (Plans & entitlements)',
    files: [
      'app/admin/business-os-tiers/page.tsx',
      'app/admin/business-os-tiers/components/PlansKpis.tsx',
      'app/admin/business-os-tiers/components/EntitlementSnapshot.tsx',
      'app/admin/business-os-tiers/components/PlanCard.tsx',
      'app/admin/business-os-tiers/components/NotBuiltPanel.tsx',
      'app/admin/business-os-tiers/components/EnforcementBanner.tsx',
    ],
  },
  {
    // L-6: header with "New invite" and the plan-enforcement badge, the KPI
    // strip (no-target tiles), the filter bar with page-held filters (never the
    // URL, D-7 (a)), states, the standard table and chips; the create and
    // revoke reads on `readJsonBody`. `types.ts` and `inviteFilter.ts` are not
    // listed: no markup and no read (the L-5 precedent).
    page: '/admin/business-os-invites (Signup Invites)',
    files: [
      'app/admin/business-os-invites/page.tsx',
      'app/admin/business-os-invites/components/InviteKpis.tsx',
      'app/admin/business-os-invites/components/InviteFilters.tsx',
      'app/admin/business-os-invites/components/InviteList.tsx',
      'app/admin/business-os-invites/components/RevokeDialog.tsx',
      'app/admin/business-os-invites/components/CreateInviteForm.tsx',
      'app/admin/business-os-invites/components/CreatedLinkPanel.tsx',
    ],
  },
  {
    // L-7: header with Mark All Read, the filter bar (Status in the URL, Search
    // page-held), states, the standard table and chips, the page-level drawer;
    // the Reply control removed (D-14 (b)). The list's 200 is read with
    // `readJsonBody` (F-111). `messagesTypes.ts` is not listed: no markup, no read.
    page: '/admin/messages (Messages)',
    files: [
      'app/admin/messages/page.tsx',
      'app/admin/messages/messagesFilters.ts',
      'app/admin/messages/messagesFormat.ts',
      'app/admin/messages/components/MessagesTable.tsx',
      'app/admin/messages/components/MessageDetail.tsx',
    ],
  },
  {
    // L-8a / L-8b (header, tabs, Activity), L-10 (Settings): one entry for the
    // page's tabs (SA L-10 Q-10). The Costs & credits tab (L-9a / L-9b) moved
    // to Charge checks in Money M-5, and its files moved to that entry below.
    // The filter-spec modules are listed because they import the shared folder
    // (SA L-10 M-4). Deliberately NOT listed (the G-6 precedent):
    // `components/LedgerCheckPanel.tsx`, parked since 2026-09-24 and not
    // mounted, still reads with `.json(` (F-123, slice 3 re-mounts and
    // converts it; the page's own source guard G-8 pins that it stays off
    // screen); `components/Chip.tsx`, now used only by Activity's
    // `RecordStateMarker` (F-116); and modules with no markup and no read
    // (`types.ts`, `copy.ts`, the `*Copy.ts` and `*Types.ts` files, `format.ts`,
    // `costFormat.ts`, `markers.ts`, `areaState.ts`, `activityPresets.ts`).
    page: '/admin/business-os-llm (Business OS AI)',
    files: [
      'app/admin/business-os-llm/page.tsx',
      'app/admin/business-os-llm/activityFilters.ts',
      'app/admin/business-os-llm/tabWindowFilter.ts',
      'app/admin/business-os-llm/components/SettingsKpis.tsx',
      'app/admin/business-os-llm/components/AreaCard.tsx',
      'app/admin/business-os-llm/components/CallRow.tsx',
      'app/admin/business-os-llm/components/ExcludedCallRow.tsx',
      'app/admin/business-os-llm/components/StoredRowPanel.tsx',
      'app/admin/business-os-llm/components/LastChangedLine.tsx',
      'app/admin/business-os-llm/components/Marker.tsx',
      'app/admin/business-os-llm/components/activity/ActivityTab.tsx',
      'app/admin/business-os-llm/components/activity/ActivityKpis.tsx',
      'app/admin/business-os-llm/components/activity/ActivityFilterBar.tsx',
      'app/admin/business-os-llm/components/activity/ActivityTable.tsx',
      'app/admin/business-os-llm/components/activity/ActivityCountLine.tsx',
      'app/admin/business-os-llm/components/activity/ActivityDrillDown.tsx',
      'app/admin/business-os-llm/components/activity/DrillDownCharges.tsx',
      'app/admin/business-os-llm/components/activity/AuditSummaryLine.tsx',
      'app/admin/business-os-llm/components/activity/CutoverNotice.tsx',
      'app/admin/business-os-llm/components/activity/DeletedAccountsBucket.tsx',
      'app/admin/business-os-llm/components/activity/RecordStateMarker.tsx',
    ],
  },
  {
    // L-12: header with the Read-only badge, the Refresh-only bar, shared
    // states, the read on readAdminResponse (F-85). No strip (D-5 (a)), no
    // filters, no table, no drawer, no dialog: the page is read-only.
    page: '/admin/settings (Admin users)',
    files: ['app/admin/settings/page.tsx'],
  },
  {
    // Admin environment view EC-2 (FR-11, as L-12): header with the Read-only
    // badge, the Refresh-only bar, shared states, the read on readAdminResponse,
    // tables on the shared adminTable constants. No strip, no filters, no
    // drawer, no dialog: the page is read-only.
    page: '/admin/environment (Environment)',
    files: [
      'app/admin/environment/page.tsx',
      'app/admin/environment/components/EnvironmentView.tsx',
      'app/admin/environment/environmentDisplay.ts',
    ],
  },
  {
    // Finance F-2: the shared header (h1 "Finance") and states; the read on
    // readAdminResponse since F-3. Finance F-4: the shared filter bar and the
    // URL hook; DV-1 ended in F-4 (Refresh moved from the header to the bar).
    // Finance F-5: the KPI strip on the shared tiles (BD-29, BD-31).
    page: '/admin/finance (Finance)',
    files: [
      'app/admin/finance/page.tsx',
      'app/admin/finance/components/FinanceView.tsx',
      'app/admin/finance/useFinanceData.ts',
      'app/admin/finance/components/FinanceFilterBar.tsx',
      'app/admin/finance/financeFilters.ts',
      // Finance F-5: the shared KPI tiles, and the sections they jump to.
      'app/admin/finance/components/FinanceKpiStrip.tsx',
      'app/admin/finance/components/FinanceSection.tsx',
      // Admin Exchange Rates slice 2b (SQ-22): the Exchange rates tab. The view
      // stays in app/admin/exchange-rates/ (SA-R13) and is listed here, and only here.
      'app/admin/exchange-rates/exchangeRatesFilters.ts',
      'app/admin/exchange-rates/components/ExchangeRatesView.tsx',
      'app/admin/exchange-rates/components/ExchangeRatesKpis.tsx',
      'app/admin/exchange-rates/components/ExchangeRatesTable.tsx',
      'app/admin/exchange-rates/components/RateHistoryTable.tsx',
    ],
  },
  {
    // Money M-5 (finance health §11H.4, AC-200): the cost report and its Leak
    // check (L-9a / L-9b), moved from the Business OS AI page's Costs & credits
    // tab. The page imports the header; the report's files stay where they are
    // (SA-Q59) and are listed here, and only here. Money MK-3a (ruled): Charge
    // checks became the AI cost page's Summary & checks content, so the entry is
    // the AI cost page's, with its strip (A-K1 to A-K5) and the recorded block (C-7).
    // Money MK-3b (ruled): the AI calls & usage entry (L-2a / L-2b) joins it as the Calls tab: its
    // page file is deleted (the old address redirects), `AnalyticsKpis.tsx` is deleted (its figures are
    // `CallsSummary.tsx`), and the tab body is `CallsTab.tsx`. The page's view, tabs, spec and read join.
    // Money MK-8b (ruled): the two drawers (business, billing period), their row opener, read and words.
    page: '/admin/ai-cost (AI cost)',
    files: [
      'app/admin/ai-cost/page.tsx',
      'app/admin/ai-cost/components/AiCostView.tsx',
      'app/admin/ai-cost/components/AiCostTabs.tsx',
      'app/admin/ai-cost/aiCostFilters.ts',
      'app/admin/ai-cost/useCostReport.ts',
      'app/admin/ai-cost/components/AiCostDrawers.tsx',
      'app/admin/ai-cost/components/aiCostRowOpen.tsx',
      'app/admin/ai-cost/aiCostDrawerReads.ts',
      'app/admin/ai-cost/aiCostDrawerCopy.ts',
      'app/admin/analytics/analyticsTypes.ts',
      'app/admin/analytics/analyticsFilters.ts',
      'app/admin/analytics/analyticsCall.ts',
      'app/admin/analytics/components/CallsTab.tsx',
      'app/admin/analytics/components/CallsSummary.tsx',
      'app/admin/analytics/components/AnalyticsFilterBar.tsx',
      'app/admin/analytics/components/AnalyticsTable.tsx',
      'app/admin/analytics/components/AnalyticsCallDetails.tsx',
      'app/admin/analytics/components/AnalyticsExecutionCard.tsx',
      'app/admin/analytics/components/AnalyticsSummaryCards.tsx',
      'app/admin/business-os-llm/costsFilters.ts',
      'app/admin/business-os-llm/components/costs/CostsTab.tsx',
      'app/admin/business-os-llm/components/costs/AiCostKpis.tsx',
      'app/admin/business-os-llm/components/costs/RecordedSection.tsx',
      'app/admin/business-os-llm/components/costs/CostsFilterBar.tsx',
      'app/admin/business-os-llm/components/costs/CostsSections.tsx',
      'app/admin/business-os-llm/components/costs/LeakCheckPanel.tsx',
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

describe('C-14 part (b): the registry itself (Money M-5, AC-200)', () => {
  it('lists every file in exactly one page entry', () => {
    const all = MIGRATED_PAGES.flatMap((entry) => [...entry.files]);
    const twice = all.filter((file, index) => all.indexOf(file) !== index);
    expect(twice).toEqual([]);
  });

  it('the AI cost page is registered with its page and the report files (Money MK-3a, ruled)', () => {
    const entry = MIGRATED_PAGES.find((e) => e.page === '/admin/ai-cost (AI cost)');
    expect(entry?.files).toEqual(expect.arrayContaining(['app/admin/ai-cost/page.tsx', 'app/admin/business-os-llm/components/costs/CostsTab.tsx']));
    expect(MIGRATED_PAGES.some((e) => e.page.startsWith('/admin/finance/charges'))).toBe(false);
    const bosAi = MIGRATED_PAGES.find((e) => e.page === '/admin/business-os-llm (Business OS AI)');
    expect(bosAi?.files.some((file) => file.includes('/costs/') || file.endsWith('costsFilters.ts'))).toBe(false);
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
