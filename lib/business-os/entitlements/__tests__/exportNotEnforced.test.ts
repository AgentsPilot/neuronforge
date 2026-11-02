/**
 * XC-19 (export redesign requirement §10; export MX-4a, SA ruling Q-3): the
 * data export is never gated by plan. An owner may take their data out in
 * every plan and every lifecycle state, so:
 *
 *   1. no export file is registered as a gate in `ENFORCEMENT_POINTS`, and
 *   2. no export file imports from `lib/business-os/entitlements`.
 *
 * Add-only (S-12): this suite edits neither `ENFORCEMENT_POINTS` nor
 * `KNOWN_NON_GATE_IMPORTERS`. It lives here, in the entitlements job, because
 * that is where whoever adds a gate will see it fail.
 *
 * "Export file" is a path rule, not a list of today's files: the export
 * directories below, plus any path naming `export-request` or `data-export`,
 * so the MX-5 admin send route is caught without being named now.
 */

import * as fs from 'fs';
import * as path from 'path';

import { ENFORCEMENT_POINTS } from '@/lib/business-os/entitlements/config/enforcementPoints';

const ROOT = process.cwd();

/** Where the module export's code lives (repo-relative, forward slashes). */
const EXPORT_DIRS = [
  'app/api/business-os/export-requests/',
  'app/api/cron/data-export-modules/',
  'lib/business-os/data-export/',
  'components/business-os/data-export/',
];
const EXPORT_FILES = ['lib/client/businessOsDataExport.ts'];

/** Is this registry path export code? */
export function isExportFile(file: string): boolean {
  const posix = file.split(path.sep).join('/').replace(/^\.?\//, '');
  return (
    EXPORT_DIRS.some((dir) => posix.startsWith(dir)) ||
    EXPORT_FILES.includes(posix) ||
    /export-request|data-export/i.test(posix)
  );
}

/** Every export file any capability of the registry names as its gate. */
export function exportFilesIn(registry: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.values(registry).flatMap((files) => files.filter(isExportFile));
}

/** The module specifier of every import, re-export, require, dynamic import and side-effect import. */
// A lookbehind instead of a word-boundary escape: no backslash may precede a
// hex digit in a file Tailwind scans (repo hazard).
const SPECIFIER = /(?:(?<![\w$])from\s*|(?<![\w$])require\s*\(\s*|(?<![\w$])import\s*\(\s*|^\s*import\s+)['"`]([^'"`]+)['"`]/gm;

const ENTITLEMENTS_DIR = 'lib/business-os/entitlements';

/**
 * The specifiers in `source` (a file at repo-relative `file`) that reach the
 * entitlements module: by the `@/` alias, or by a relative path resolved from
 * the file's own directory (`../entitlements/…` from lib/business-os/data-export).
 */
export function entitlementsImports(file: string, source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1];
    let target = specifier;
    if (specifier.startsWith('@/')) target = specifier.slice(2);
    else if (specifier.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
    if (target === ENTITLEMENTS_DIR || target.startsWith(`${ENTITLEMENTS_DIR}/`)) out.push(specifier);
  }
  return out;
}

function walk(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(full);
    return /\.(ts|tsx|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

/** The export's product source files (tests are exempt, as in the importer guard). */
function exportSourceFiles(): string[] {
  const files = [
    ...EXPORT_DIRS.flatMap((dir) => walk(path.join(ROOT, dir))),
    ...EXPORT_FILES.map((file) => path.join(ROOT, file)).filter((full) => fs.existsSync(full)),
  ];
  return files.map((full) => path.relative(ROOT, full).split(path.sep).join('/'));
}

describe('XC-19: the data export is never gated by plan', () => {
  it('no export file is registered in ENFORCEMENT_POINTS', () => {
    expect(exportFilesIn(ENFORCEMENT_POINTS)).toEqual([]);
  });

  it('non-vacuity: a planted registry naming an export file is caught, an unrelated gate is not', () => {
    // Made-up capability ids: only the file lists matter here.
    const planted = {
      'planted.unrelated': ['app/api/business-os/invoices/route.ts'],
      'planted.one': ['app/api/business-os/export-requests/route.ts', 'lib/business-os/data-export/moduleExportWorker.ts'],
      // The shape an MX-5 admin send route could take: caught by name, not by directory.
      'planted.two': ['app/api/admin/business-os/accounts/[id]/export-requests/route.ts'],
    };
    expect(exportFilesIn(planted)).toEqual([
      'app/api/business-os/export-requests/route.ts',
      'lib/business-os/data-export/moduleExportWorker.ts',
      'app/api/admin/business-os/accounts/[id]/export-requests/route.ts',
    ]);
    expect(isExportFile('lib/client/businessOsDataExport.ts')).toBe(true);
    expect(isExportFile('components/business-os/data-export/ExportDrawer.tsx')).toBe(true);
    expect(isExportFile('app/api/business-os/invoices/route.ts')).toBe(false);
  });

  it('the scan actually reads the export code', () => {
    const files = exportSourceFiles();
    expect(files).toEqual(
      expect.arrayContaining([
        'app/api/business-os/export-requests/route.ts',
        'lib/business-os/data-export/moduleExportWorker.ts',
        'lib/client/businessOsDataExport.ts',
      ])
    );
    expect(files.some((file) => file.startsWith('components/business-os/data-export/'))).toBe(true);
    expect(files.some((file) => file.startsWith('app/api/cron/data-export-modules/'))).toBe(true);
  });

  it('no export file imports from lib/business-os/entitlements', () => {
    const offenders = exportSourceFiles()
      .map((file) => ({ file, imports: entitlementsImports(file, fs.readFileSync(path.join(ROOT, file), 'utf8')) }))
      .filter((found) => found.imports.length > 0);
    expect(offenders).toEqual([]);
  });

  const WORKER = 'lib/business-os/data-export/moduleExportWorker.ts';
  it.each([
    ['an alias import', "import { decide } from '@/lib/business-os/entitlements/decide';", true],
    ['a type-only import', "import type { Labels } from '@/lib/business-os/entitlements';", true],
    ['a multi-line import', "import {\n  ENFORCEMENT_POINTS,\n} from '@/lib/business-os/entitlements/config/enforcementPoints';", true],
    ['a relative import from the export directory', "import { check } from '../entitlements/check';", true],
    ['a relative import of the module root', "import * as e from '../entitlements';", true],
    ['a re-export', "export { decide } from '@/lib/business-os/entitlements/decide';", true],
    ['a require', "const e = require('@/lib/business-os/entitlements');", true],
    ['a dynamic import', "const e = await import('@/lib/business-os/entitlements/decide');", true],
    ['a side-effect import', "import '@/lib/business-os/entitlements/register';", true],
    ['a comment that only names the module', '// Nothing here imports lib/business-os/entitlements (XC-19).', false],
    ['a sibling import', "import { MODULE_EXPORT_POLICY } from './moduleExportPolicy';", false],
    ['a look-alike directory', "import { x } from '@/lib/business-os/entitlements-legacy/x';", false],
  ])('non-vacuity of the import scan (planted in %s)', (_name, source, expected) => {
    expect(entitlementsImports(WORKER, source).length > 0).toBe(expected);
  });
});
