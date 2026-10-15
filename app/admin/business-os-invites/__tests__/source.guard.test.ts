/**
 * The properties of the Invites screen that no rendering test can reach
 * (modelled on `business-os-tiers/__tests__/source.guard.test.ts`):
 *
 *   1. It imports nothing from outside its own folder (packages aside): no
 *      config, no invite module, no repository, no `LanguageContext` (C-8).
 *      Every option arrives in the payload.
 *   2. It adds no guard of its own: `app/admin/layout.tsx` protects it (C-5).
 *   3. It names no plan, price or plan id, and logs nothing.
 *
 * Amended by Admin Layout Standard L-6 (each edit deliberate, named in the PR):
 *   G-1  the exact file list gains `components/InviteKpis.tsx` and loses
 *        `components/EnforcementNote.tsx` (deleted by user decision D-18, SA M-1);
 *   G-2  the import rule is lifted into `escapes()` with one line first: the
 *        shared admin layout folder, through the alias with its trailing slash
 *        (SA Q-3). Packages other than React and lucide are still refused;
 *   G-3  a negative control for `escapes()`;
 *   G-4  SA-R-5 (1): the filter has exactly its four keys;
 *   G-5  SA-R-5 (2): the create form and the link panel never name the shared
 *        URL hook;
 *   G-6  SA-R-5 (3): no Invites file names the URL hook, the search-params hook,
 *        the router or `next/navigation`;
 *   G-7  the transitive walk (SA Q-10, M-4): nothing any Invites file pulls in,
 *        at any depth, writes the URL, history or storage, and the URL hook is
 *        never reached. Its own fixture self-test proves the walker can see.
 * The storage and history rule below is unchanged in text and scope (SA-R-5).
 *
 * Amended by Admin Layout Follow-ups LF-3a (New invite in a drawer, Revoke in a
 * dialog; one named amendment, SA-C10):
 *   G-8  `escapes()` lets exactly `@/components/ui/dialog` into exactly
 *        `components/RevokeDialog.tsx`, the screen's one dialog. Every other
 *        file, and every other `@/components/ui/` specifier (`button`, `sheet`,
 *        look-alikes), is still refused. Negative controls and a liveness check
 *        below. The drawer arrives through the shared folder's `AdminDrawer`;
 *   G-7  the positive control gains `components/ui/sheet.tsx` and
 *        `components/ui/dialog.tsx`, so the walk is proven to reach both and the
 *        per-file URL and storage ban runs over them.
 * The exact file list is unchanged: no file was added or removed.
 *
 * Amended by Admin Layout Follow-ups LF-7 (shared `AdminConfirmDialog`, SA
 * approval of the LF-7 workplan):
 *   G-8  the exception line is removed from `escapes()`: `RevokeDialog.tsx` now
 *        renders the shared dialog, so every file, that one included, is refused
 *        `@/components/ui/dialog` and its look-alikes, and no file names
 *        `@/components/ui/`. Liveness: `RevokeDialog.tsx` imports the shared
 *        dialog, so the refusal is not vacuous;
 *   G-7  the positive control gains `AdminConfirmDialog.tsx`; the primitive is
 *        still reached, now through it.
 * The exact file list is unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';

import { EMPTY_INVITE_FILTER } from '../inviteFilter';

const ROOT = 'app/admin/business-os-invites';

function screenFiles(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) continue;
      found.push(full.replace(process.cwd() + path.sep, '').split(path.sep).join('/'));
    }
  };
  walk(path.join(process.cwd(), ROOT));
  return found.sort();
}

const allFiles = screenFiles();
const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** LF-7 G-8: the screen's dialog file, the primitive no file may import, and the shared dialog it uses instead. */
const DIALOG_FILE = `${ROOT}/components/RevokeDialog.tsx`;
const DIALOG_PRIMITIVE = '@/components/ui/dialog';
const SHARED_CONFIRM = '@/app/admin/components/layout/AdminConfirmDialog';

/** Packages this screen may use. Anything else outside the folder is refused. */
const ALLOWED_PACKAGES = ['react', 'lucide-react'];

/**
 * Does an import from `relative` leave the screen? (L-6 G-2: lifted out of the
 * `it.each` with the same body, the L-5 shape, plus one line first.)
 *
 * The one exception is the shared admin layout folder, through the alias and
 * with the trailing slash, so a look-alike folder (`layoutX`) cannot ride it.
 * That folder may import no Business OS module (§6.1 S-4), so it is not a second
 * source of truth; G-7 below proves nothing in it writes the URL or storage.
 * Unlike Plans & entitlements, a package must still be on `ALLOWED_PACKAGES`,
 * so `next/link`, `next/navigation` and `@/lib/...` stay refused.
 */
function escapes(relative: string, specifier: string): boolean {
  if (specifier.startsWith('@/app/admin/components/layout/')) return false;
  if (specifier.startsWith('@/')) return !specifier.startsWith(`@/${ROOT}`);
  if (!specifier.startsWith('.')) return !ALLOWED_PACKAGES.includes(specifier);
  const resolved = path.normalize(path.join(path.dirname(relative), specifier)).split(path.sep).join('/');
  return !resolved.startsWith(ROOT);
}

describe('the screen holds no server module and no rule of its own', () => {
  it('finds the page and its components, so the scan cannot fall behind the code', () => {
    expect(allFiles).toEqual(
      [
        `${ROOT}/components/CreateInviteForm.tsx`,
        `${ROOT}/components/CreatedLinkPanel.tsx`,
        `${ROOT}/components/InviteFilters.tsx`,
        `${ROOT}/components/InviteKpis.tsx`,
        `${ROOT}/components/InviteList.tsx`,
        `${ROOT}/components/RevokeDialog.tsx`,
        `${ROOT}/inviteFilter.ts`,
        `${ROOT}/page.tsx`,
        `${ROOT}/types.ts`,
      ].sort()
    );
  });

  it.each(allFiles)('%s imports nothing from outside the screen except React, lucide and the shared layout folder', (relative) => {
    const imports = [...codeOf(read(relative)).matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
    const escaping = imports.filter((specifier) => escapes(relative, specifier));
    expect({ file: relative, escaping }).toEqual({ file: relative, escaping: [] });
  });

  it('G-3: the alias opens exactly the shared layout folder, and the package list is unchanged', () => {
    const page = `${ROOT}/page.tsx`;
    expect(escapes(page, '@/app/admin/components/layout/StatusChip')).toBe(false);
    // A sibling of the shared folder is outside the screen.
    expect(escapes(page, '@/app/admin/components/AdminHeader')).toBe(true);
    // The relative spelling of the shared folder still escapes (the alias only, S-1).
    expect(escapes(page, '../components/layout/StatusChip')).toBe(true);
    // A look-alike folder name cannot ride the alias.
    expect(escapes(page, '@/app/admin/components/layoutX/Foo')).toBe(true);
    // A package that is not React or lucide is still refused.
    expect(escapes(page, 'next/navigation')).toBe(true);
    // …and the screen's own files and allowed packages are not flagged.
    expect(escapes(page, './components/InviteList')).toBe(false);
    expect(escapes(page, 'react')).toBe(false);
  });

  it('G-8 (LF-7): every file, RevokeDialog.tsx included, is refused the dialog primitive and its look-alikes', () => {
    expect(allFiles).toContain(DIALOG_FILE);
    for (const file of allFiles) {
      for (const specifier of [
        DIALOG_PRIMITIVE,
        '@/components/ui/dialogX',
        '@/components/ui/dialog/index',
        '@/components/ui/button',
        '@/components/ui/sheet',
        '../../../../components/ui/dialog',
      ]) {
        expect({ file, specifier, escapes: escapes(file, specifier) }).toEqual({ file, specifier, escapes: true });
      }
    }
  });

  it('G-8 liveness (LF-7): RevokeDialog.tsx imports the shared dialog, and no file names @/components/ui/', () => {
    // The G-7 extractor, defined below (it runs after the module has loaded).
    expect(valueSpecifiersOf(codeOf(read(DIALOG_FILE)))).toContain(SHARED_CONFIRM);
    for (const relative of allFiles) {
      expect({ file: relative, ui: codeOf(read(relative)).includes('@/components/ui/') }).toEqual({ file: relative, ui: false });
    }
  });

  it.each(allFiles)('%s never touches LanguageContext (C-8)', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/LanguageContext|useLanguage/);
  });

  it.each(allFiles)('%s writes down no plan name, price or plan id', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/\bEssentials\b|\bAutopilot\b|\bTest Flight\b|\bFounding Partner\b/);
    expect(code).not.toMatch(/\$\s?\d/);
    expect(code).not.toMatch(/['"`](basic|pro|trial|champion|paid)['"`]/);
  });

  it.each(allFiles)('%s logs through nothing: no console.*', (relative) => {
    expect(read(relative)).not.toMatch(/console\.(log|warn|error|info|debug)\s*\(/);
  });

  it.each(allFiles)('%s uses no `any` and no dangerouslySetInnerHTML', (relative) => {
    const code = codeOf(read(relative));
    expect(code).not.toMatch(/:\s*any\b/);
    expect(code).not.toContain('dangerouslySetInnerHTML');
  });

  it.each(allFiles)('%s never stores the link anywhere it would survive a reload', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/localStorage|sessionStorage|document\.cookie|history\.(push|replace)State/);
  });
});

describe('Slice 1c: the filter decides no state of its own (C-11)', () => {
  const filterCode = codeOf(read(`${ROOT}/inviteFilter.ts`));

  it('compares no date and parses no timestamp', () => {
    expect(filterCode).not.toMatch(/linkExpiresAt|Date\.|new Date|getTime/);
  });

  it('sends nothing anywhere: no fetch in the filter or its controls', () => {
    expect(filterCode).not.toMatch(/fetch\(/);
    expect(codeOf(read(`${ROOT}/components/InviteFilters.tsx`))).not.toMatch(/fetch\(/);
  });
});

describe('the guard', () => {
  const pageCode = codeOf(read(`${ROOT}/page.tsx`));

  it('is a client page that does not re-implement the layout guard', () => {
    expect(read(`${ROOT}/page.tsx`).trimStart().startsWith("'use client'")).toBe(true);
    expect(pageCode).not.toMatch(/requireAdminPage|requireAdmin\b/);
  });

  it('never decides who is an admin', () => {
    for (const relative of allFiles) {
      expect(codeOf(read(relative))).not.toMatch(/AdminAccessService|profiles\.role|app_metadata|isAdmin/);
    }
  });

  it('the layout that protects it still awaits the guard as its FIRST statement', () => {
    const layout = codeOf(read('app/admin/layout.tsx'));
    const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(layout);
    expect(opener).not.toBeNull();
    const body = layout.slice((opener?.index ?? 0) + (opener?.[0].length ?? 0)).trim();
    const end = Math.min(...[body.indexOf(';'), body.indexOf('{')].filter((index) => index >= 0).concat([body.length]));
    expect(body.slice(0, end).trim()).toMatch(/await\s+requireAdminPage\s*\(\s*\)/);
  });

  it('writes only to its own two admin routes', () => {
    const targets = allFiles.flatMap((relative) =>
      [...codeOf(read(relative)).matchAll(/fetch\(\s*[`'"]([^`'"]+)[`'"]/g)].map((match) => match[1])
    );
    for (const target of targets) expect(target.startsWith('/api/admin/business-os/invites')).toBe(true);
    expect(targets.length).toBeGreaterThanOrEqual(3);
  });
});

// ── L-6: the filters never reach the URL (D-7 (a), SA-R-5) ─────────────────

describe('L-6 G-4 (SA-R-5 (1)): the filter has exactly its four keys', () => {
  // A fifth key (a window, a business) would be a filter that is not on the
  // screen today. The code's names are pinned (SA Q-9): `inviteType` is §7.9's
  // "type" and `query` its search, held in page state and never in the URL.
  const FOUR = ['inviteType', 'issuer', 'query', 'state'];

  it('the empty filter holds exactly state, inviteType, issuer and query', () => {
    expect(Object.keys(EMPTY_INVITE_FILTER).sort()).toEqual(FOUR);
  });

  it('the InviteListFilter interface declares exactly those four fields', () => {
    const match = /export interface InviteListFilter\s*\{([^}]*)\}/.exec(codeOf(read(`${ROOT}/inviteFilter.ts`)));
    expect(match).not.toBeNull();
    const fields = [...(match?.[1] ?? '').matchAll(/^\s*(\w+)\s*\??\s*:/gm)].map((field) => field[1]).sort();
    expect(fields).toEqual(FOUR);
  });
});

const URL_HOOK_SPECIFIER = '@/app/admin/components/layout/useAdminFilters';

describe('L-6 G-5 (SA-R-5 (2)): the create form and the link panel never touch the URL hook', () => {
  it.each([`${ROOT}/components/CreateInviteForm.tsx`, `${ROOT}/components/CreatedLinkPanel.tsx`])(
    '%s never names useAdminFilters and imports nothing from it',
    (relative) => {
      const code = codeOf(read(relative));
      expect(code).not.toContain('useAdminFilters');
      expect(valueSpecifiersOf(code).concat(typeSpecifiersOf(code))).not.toContain(URL_HOOK_SPECIFIER);
    }
  );
});

describe('L-6 G-6 (SA-R-5 (3)): no Invites file reaches for the URL', () => {
  it.each(allFiles)('%s names no URL hook, search params, router or next/navigation', (relative) => {
    expect(codeOf(read(relative))).not.toMatch(/useAdminFilters|useSearchParams|useRouter|next\/navigation/);
  });
});

// ── G-7: the transitive walk (SA Q-10, M-4) ─────────────────────────────────

/**
 * Statement-level `import … from`, `export … from` (multi-line too); group 1 is
 * `type ` on a type-only statement. SA SF-1: a statement also ends at the next
 * `import` / `export` keyword, so a quote-free `export type A = B` with no
 * semicolon cannot swallow the value import after it.
 */
const FROM_STATEMENT =
  /\b(?:import|export)\s+(type\s+)?(?:(?!\b(?:import|export)\b)[^'";])*?\bfrom\s*['"]([^'"]+)['"]/g;
/** Side-effect `import '…'` and dynamic `import('…')`: always values. */
const BARE_IMPORT = /\bimport\s*\(?\s*['"]([^'"]+)['"]/g;

/**
 * Specifiers of every import TypeScript keeps. Only a statement-level
 * `import type` / `export type` is skipped (it is erased); an inline
 * `{ type X, y }` counts as a value import, so the walk over-approximates
 * (fails loud), never under-approximates (passes silently).
 */
function valueSpecifiersOf(code: string): string[] {
  const values = [...code.matchAll(FROM_STATEMENT)].filter((match) => !match[1]).map((match) => match[2]);
  return values.concat([...code.matchAll(BARE_IMPORT)].map((match) => match[1]));
}

/** The skipped ones, for the self-test and G-5. */
function typeSpecifiersOf(code: string): string[] {
  return [...code.matchAll(FROM_STATEMENT)].filter((match) => match[1]).map((match) => match[2]);
}

/**
 * The repository file a specifier names, or null for a package (not ours to
 * walk). An `@/` or relative specifier that resolves to nothing throws: the
 * walk never skips what it cannot see.
 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = specifier.slice(2);
  else if (specifier.startsWith('.')) base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
  else return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  for (const candidate of candidates) {
    const full = path.join(process.cwd(), candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return candidate;
  }
  throw new Error(`G-7: cannot resolve "${specifier}" imported by ${fromFile}`);
}

/** Every repository file reachable from `starts` through value imports, the starts included. */
function reachableFrom(starts: readonly string[]): Set<string> {
  const visited = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    if (visited.has(file)) continue;
    visited.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const specifier of valueSpecifiersOf(codeOf(read(file)))) {
      const target = resolveSpecifier(file, specifier);
      if (target && !visited.has(target)) queue.push(target);
    }
  }
  return visited;
}

/** What may not appear in the code of anything an Invites file pulls in. */
const URL_OR_STORAGE =
  /history\.(push|replace)State|useSearchParams|useRouter|next\/navigation|localStorage|sessionStorage|document\.cookie/;

/**
 * SA SF-2: an import the walker cannot follow. `require(` is not parsed at all,
 * and an `import(` whose argument is not one plain string literal names a
 * module only at run time, so either would let a module in unseen.
 */
const UNWALKABLE_IMPORT = /\brequire\s*\(|\bimport\s*\(\s*(?!(?:'[^'\n]*'|"[^"\n]*")\s*\))/;

describe('L-6 G-7: nothing an Invites file pulls in, at any depth, writes the URL or storage', () => {
  const reached = reachableFrom(allFiles);

  it('walks into the shared folder and beyond it (positive control: an empty walk cannot pass)', () => {
    for (const file of [
      'app/admin/components/layout/AdminFilterBar.tsx',
      'app/admin/components/layout/DatePresets.tsx',
      'app/admin/components/layout/adminWindow.ts',
      'app/admin/components/layout/readJsonBody.ts',
      'app/admin/components/adminWindowPresets.ts',
      // LF-3a (SA-C10): the drawer's sheet and the Revoke dialog's primitive.
      'components/ui/sheet.tsx',
      'components/ui/dialog.tsx',
      // LF-7: the shared dialog Revoke renders, through which the primitive is reached.
      'app/admin/components/layout/AdminConfirmDialog.tsx',
    ]) {
      expect(reached.has(file)).toBe(true);
    }
  });

  it('never reaches the shared URL hook (adminWindow imports it as a type only, which TypeScript erases)', () => {
    expect(reached.has('app/admin/components/layout/useAdminFilters.ts')).toBe(false);
  });

  it.each([...reached].filter((file) => /\.tsx?$/.test(file)).sort())(
    '%s writes no history, reads no search params or router, and touches no storage',
    (file) => {
      expect(codeOf(read(file))).not.toMatch(URL_OR_STORAGE);
    }
  );

  it.each([...reached].filter((file) => /\.tsx?$/.test(file)).sort())(
    '%s has no require( and no import( the walker cannot follow (SA SF-2)',
    (file) => {
      expect(codeOf(read(file))).not.toMatch(UNWALKABLE_IMPORT);
    }
  );

  it('self-test (SF-2): the unwalkable-import rule catches require and computed import(), not a literal import()', () => {
    for (const sample of [
      "const m = require('./x');",
      'const m = require(name);',
      'const m = import(name);',
      'const m = import(`./${name}`);',
      "const m = import('./a' + b);",
    ]) {
      expect(sample).toMatch(UNWALKABLE_IMPORT);
    }
    for (const sample of ["const m = import('./x');", 'const m = import("./x");', "type T = typeof import('./x');"]) {
      expect(sample).not.toMatch(UNWALKABLE_IMPORT);
    }
  });

  it('self-test: the extractor sees every value import form and skips only statement-level type imports', () => {
    const fixture = [
      "import {\n  a,\n  b,\n} from './multiLine';",
      "import './sideEffect';",
      "export { c } from './reExport';",
      "export * from './starExport';",
      "import { type T, d } from './inlineType';",
      "const lazy = import('./dynamic');",
      "import type { U } from './typeOnly';",
      "export type { V } from './typeReExport';",
      "import React from 'react';",
      // SF-1: a quote-free type alias with no semicolon must not swallow the next import.
      'export type A = B',
      "import { e } from './afterTypeAlias';",
    ].join('\n');
    expect(valueSpecifiersOf(fixture).sort()).toEqual(
      ['./afterTypeAlias', './dynamic', './inlineType', './multiLine', './reExport', './sideEffect', './starExport', 'react'].sort()
    );
    expect(typeSpecifiersOf(fixture).sort()).toEqual(['./typeOnly', './typeReExport']);
  });

  it('self-test: the resolver follows @/ and relative specifiers, leaves packages, and throws on what it cannot find', () => {
    const page = `${ROOT}/page.tsx`;
    expect(resolveSpecifier(page, '@/app/admin/components/layout/StatusChip')).toBe(
      'app/admin/components/layout/StatusChip.tsx'
    );
    expect(resolveSpecifier(page, './inviteFilter')).toBe(`${ROOT}/inviteFilter.ts`);
    expect(resolveSpecifier(page, 'react')).toBeNull();
    expect(() => resolveSpecifier(page, './doesNotExist')).toThrow(/cannot resolve/);
    expect(() => resolveSpecifier(page, '@/app/admin/components/layout/NoSuchFile')).toThrow(/cannot resolve/);
  });

  it('self-test: the ban catches each form it names', () => {
    for (const sample of [
      "window.history.replaceState(null, '', '?x=1')",
      'history.pushState({}, "", url)',
      'const params = useSearchParams();',
      'const router = useRouter();',
      "from 'next/navigation'",
      "localStorage.setItem('k', v)",
      "sessionStorage.setItem('k', v)",
      'document.cookie = x',
    ]) {
      expect(sample).toMatch(URL_OR_STORAGE);
    }
  });
});
