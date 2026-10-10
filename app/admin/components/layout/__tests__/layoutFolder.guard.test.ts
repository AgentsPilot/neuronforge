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
  'AdminFilterBar.tsx',
  'AdminPageHeader.tsx',
  'AdminStates.tsx',
  'adminFormat.ts',
  'readAdminResponse.ts',
  'readJsonBody.ts',
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
]);
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

/** S-8. */
const SECTION = /<section\b/;
const REGION_ROLE = /role=\{?["']region["']/;

/** S-7 / RC-5: the 13 colour prefixes of the Health guard, followed by green or emerald. */
const GREEN_PREFIXES = [
  'bg', 'text', 'border', 'from', 'to', 'via', 'shadow', 'outline',
  'decoration', 'divide', 'ring', 'fill', 'stroke',
];
const GREEN_CLASS = new RegExp(`(?<![\\w-])(?:${GREEN_PREFIXES.join('|')})-(?:green|emerald)-`, 'g');

/**
 * Every green match must sit inside one `const NAME = …;` declaration. Returns
 * the names of the green-holding constants across ALL given files (SA W-7) and
 * the green matches found outside any constant.
 */
function greenVerdict(files: Array<{ file: string; code: string }>): { names: Set<string>; outside: string[] } {
  const names = new Set<string>();
  const outside: string[] = [];
  for (const { file, code } of files) {
    const decls = [...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)/g)].map((m) => {
      const start = m.index ?? 0;
      const semicolon = code.indexOf(';', start);
      return { name: m[1], start, end: semicolon < 0 ? code.length : semicolon };
    });
    for (const match of code.matchAll(GREEN_CLASS)) {
      const at = match.index ?? 0;
      const owner = decls.filter((d) => d.start <= at && at <= d.end).pop();
      if (owner) names.add(owner.name);
      else outside.push(`${file}: ${match[0]}`);
    }
  }
  return { names, outside };
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

  it('holds at most one green constant across the folder, and no green outside it (S-7, RC-5)', () => {
    const verdict = greenVerdict(SOURCE_FILES.map((file) => ({ file, code: codeOf(read(file)) })));
    expect(verdict.outside).toEqual([]);
    expect(verdict.names.size).toBeLessThanOrEqual(1);
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
