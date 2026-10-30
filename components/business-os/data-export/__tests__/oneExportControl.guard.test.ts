/**
 * One export control, one browser seam, no JSON route (data export DE-9,
 * workplan §6.3; SA DE-9 "guards approved", C-7, C-11).
 *
 * Pure file reads, CRLF-safe (#394: lines are split on /\r?\n/ and every
 * pattern is line-ending agnostic). Each check is a function over (file,
 * source) so the negative controls below run the SAME code on planted input.
 *
 *   1. No application file names `/api/user/data-export` or imports
 *      `downloadUserDataExport` (code only; a comment recording the
 *      retirement does not count).
 *   2. The JSON route and the old helper do not exist.
 *   3. Each of the four entry files imports DownloadMyDataButton, renders it,
 *      and has no fetch to an export path (the ZIP routes or, from MX-1b, the
 *      module export route), no `export_success` / `export_error` key and no
 *      `downloadUserDataExport`.
 *   4. Outside app/api/, no file names `/api/business-os/data-exports` (the
 *      ZIP route, deleted in MX-3.1) or `/api/business-os/export-requests`,
 *      except lib/client/businessOsDataExport.ts for the module route (one
 *      client seam). From MX-3.1 the seam itself no longer names the ZIP
 *      route (SA MX-3.1 required change 4).
 *   5. EXPORT_LIMITS has no JSON_BODY_MAX_BYTES (C-11 done) and, from MX-3.1,
 *      none of the ZIP's ceilings (SA Q-3).
 *   6. The ZIP routes and the ZIP sweep cron do not exist (MX-3.1, SA Q-8).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { EXPORT_LIMITS } from '@/lib/business-os/data-export/limits';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'];
const CODE_FILE = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

const RETIRED_ROUTE_FILE = 'app/api/user/data-export/route.ts';
const RETIRED_HELPER_FILE = 'lib/client/downloadUserDataExport.ts';
const CLIENT_SEAM = 'lib/client/businessOsDataExport.ts';
/** MX-3.1 (SA Q-8): the ZIP routes and the ZIP sweep cron, deleted. */
const RETIRED_ZIP_DIRS = ['app/api/business-os/data-exports', 'app/api/admin/users/[id]/data-exports', 'app/api/cron/data-export'];
/** MX-3.1 (SA Q-3): the ZIP's ceilings, removed from EXPORT_LIMITS with the builder. */
const RETIRED_ZIP_LIMITS = [
  'FILE_BYTES_CEILING',
  'FILE_COUNT_CEILING',
  'ZIP_BYTES_CEILING',
  'BUILD_MS_CEILING',
  'NEAR_CEILING_RATIO',
  'FILE_WALK_MAX_MS',
  'FILE_WALK_MAX_CALLS',
  'FILE_DOWNLOAD_CONCURRENCY',
  'FILE_ROWS_MAX',
];
const ENTRY_FILES = [
  'app/business-os/settings/page.tsx',
  'components/business-os/purge/DangerZonePanel.tsx',
  'components/settings/SecurityTab.tsx',
  'components/v2/settings/SecurityTabV2.tsx',
];

type Source = { file: string; source: string };

function walk(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '__tests__' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (CODE_FILE.test(name) && !/\.(test|spec)\.[jt]sx?$/.test(name)) out.push(full);
  }
  return out;
}

/**
 * Code only: block comments (JSX `{/* … *\/}` included) and whole-line `//` or
 * ` * ` comment lines removed. A trailing `//` is kept on purpose, so a URL
 * such as `https://…` is never cut.
 */
export function codeOf(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

/** Check 1. */
export function namesRetiredExport({ source }: Source): boolean {
  const code = codeOf(source);
  return /\/api\/user\/data-export\b/.test(code) || /\bdownloadUserDataExport\b/.test(code);
}

/** Check 3: the problems of one entry file, [] when it is clean. */
export function entryFileProblems({ source }: Source): string[] {
  const code = codeOf(source);
  const problems: string[] = [];
  if (!/import\s*\{\s*DownloadMyDataButton\s*\}\s*from\s*['"]@\/components\/business-os\/data-export\/DownloadMyDataButton['"]/.test(code)) {
    problems.push('does not import DownloadMyDataButton');
  }
  if (!/<DownloadMyDataButton\b/.test(code)) problems.push('does not render DownloadMyDataButton');
  if (/fetch\(\s*[`'"][^`'"]*data-export/.test(code)) problems.push('fetches an export path itself');
  // MX-1b (SA C-5): the module export route is an export path too.
  if (/fetch\(\s*[`'"][^`'"]*export-requests/.test(code)) problems.push('fetches the module export route itself');
  if (/export_success|export_error/.test(code)) problems.push('has its own export message key');
  if (/\bdownloadUserDataExport\b/.test(code)) problems.push('uses the retired helper');
  return problems;
}

/**
 * Check 4: the ZIP route and, from MX-1b (SA C-5), the module export route.
 * MX-3.1: the seam may name the module route only; nobody outside app/api/
 * may name the deleted ZIP route.
 */
export function namesZipRouteOutsideSeam({ file, source }: Source): boolean {
  if (file.startsWith('app/api/')) return false;
  const code = codeOf(source);
  if (/\/api\/business-os\/data-exports(?![\w-])/.test(code)) return true;
  if (file === CLIENT_SEAM) return false;
  return /\/api\/business-os\/export-requests(?![\w-])/.test(code);
}

const files: Source[] = SCAN_DIRS.filter((dir) => existsSync(join(ROOT, dir)))
  .flatMap((dir) => walk(join(ROOT, dir)))
  .map((full) => ({ file: relative(ROOT, full).split(sep).join('/'), source: readFileSync(full, 'utf8') }));

describe('one "Download my data" control (DE-9)', () => {
  it('scans a meaningful number of files (not vacuous)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map((f) => f.file)).toEqual(expect.arrayContaining([CLIENT_SEAM, ...ENTRY_FILES]));
  });

  it('1. no application file names the JSON route or the old helper', () => {
    expect(files.filter(namesRetiredExport).map((f) => f.file)).toEqual([]);
  });

  it('2. the JSON route and the old helper do not exist', () => {
    expect(existsSync(join(ROOT, RETIRED_ROUTE_FILE))).toBe(false);
    expect(existsSync(join(ROOT, RETIRED_HELPER_FILE))).toBe(false);
  });

  it.each(ENTRY_FILES)('3. %s renders the one control and has no export logic of its own', (file) => {
    const entry = files.find((f) => f.file === file);
    expect(entry).toBeDefined();
    expect(entryFileProblems(entry!)).toEqual([]);
  });

  it('4. outside app/api/, only the client seam names the module export route, and nobody names the ZIP route', () => {
    expect(files.filter(namesZipRouteOutsideSeam).map((f) => f.file)).toEqual([]);
    // Non-vacuity, inverted in MX-3.1 (SA required change 4): the seam names the
    // module export route and no longer names the deleted ZIP route.
    const seam = codeOf(files.find((f) => f.file === CLIENT_SEAM)!.source);
    expect(seam).not.toMatch(/\/api\/business-os\/data-exports/);
    expect(seam).toMatch(/\/api\/business-os\/export-requests/);
  });

  it('5. EXPORT_LIMITS has no JSON body cap (C-11) and none of the ZIP ceilings (MX-3.1, SA Q-3)', () => {
    expect(EXPORT_LIMITS).not.toHaveProperty('JSON_BODY_MAX_BYTES');
    for (const key of RETIRED_ZIP_LIMITS) expect(EXPORT_LIMITS).not.toHaveProperty(key);
    expect(EXPORT_LIMITS).toHaveProperty('ROW_CEILING');
  });

  it('6. the ZIP routes and the ZIP sweep cron do not exist (MX-3.1, SA Q-8)', () => {
    for (const dir of RETIRED_ZIP_DIRS) expect({ dir, exists: existsSync(join(ROOT, dir)) }).toEqual({ dir, exists: false });
    // Non-vacuity: the check looks where the module export lives.
    expect(existsSync(join(ROOT, 'app/api/business-os/export-requests/route.ts'))).toBe(true);
  });
});

describe('the guards themselves (negative controls)', () => {
  const crlf = (text: string) => text.replace(/\n/g, '\r\n');

  it('1 flags a planted route string or helper import, LF and CRLF; a comment does not count', () => {
    for (const planted of [
      "const r = await fetch('/api/user/data-export');",
      "import { downloadUserDataExport } from '@/lib/client/downloadUserDataExport';",
      'const url = `${base}/api/user/data-export?x=1`;',
    ]) {
      expect(namesRetiredExport({ file: 'components/x.tsx', source: planted })).toBe(true);
      expect(namesRetiredExport({ file: 'components/x.tsx', source: crlf(`'use client';\n${planted}\n`) })).toBe(true);
    }
    expect(namesRetiredExport({ file: 'lib/x.ts', source: '// retired: app/api/user/data-export\n/* downloadUserDataExport */\n * GET /api/user/data-export\nconst a = 1;' })).toBe(false);
  });

  it('3 flags an entry file with its own export, and passes a clean one (LF and CRLF)', () => {
    const clean = "import { DownloadMyDataButton } from '@/components/business-os/data-export/DownloadMyDataButton';\nexport const A = () => <DownloadMyDataButton variant=\"row\" />;\n";
    expect(entryFileProblems({ file: 'e.tsx', source: clean })).toEqual([]);
    expect(entryFileProblems({ file: 'e.tsx', source: crlf(clean) })).toEqual([]);
    expect(entryFileProblems({ file: 'e.tsx', source: 'export const A = () => <button>Export</button>;' })).toEqual([
      'does not import DownloadMyDataButton',
      'does not render DownloadMyDataButton',
    ]);
    expect(entryFileProblems({ file: 'e.tsx', source: `${clean}fetch('/api/business-os/data-exports');` })).toContain('fetches an export path itself');
    // MX-1b (SA C-5): the module export route, LF and CRLF.
    expect(entryFileProblems({ file: 'e.tsx', source: `${clean}fetch('/api/business-os/export-requests', { method: 'POST' });` })).toContain(
      'fetches the module export route itself'
    );
    expect(entryFileProblems({ file: 'e.tsx', source: crlf(`${clean}await fetch(\`/api/business-os/export-requests\`);\n`) })).toContain(
      'fetches the module export route itself'
    );
    expect(entryFileProblems({ file: 'e.tsx', source: `${clean}t('settings.security.export_success');` })).toContain('has its own export message key');
    expect(entryFileProblems({ file: 'e.tsx', source: `${clean}await downloadUserDataExport();` })).toContain('uses the retired helper');
  });

  it('4 flags anyone naming the deleted ZIP route, the seam included (MX-3.1); app/api and comments are not code', () => {
    const planted = "await fetch('/api/business-os/data-exports', { method: 'POST' });";
    expect(namesZipRouteOutsideSeam({ file: 'components/other/Exporter.tsx', source: planted })).toBe(true);
    expect(namesZipRouteOutsideSeam({ file: 'hooks/useExport.ts', source: crlf(`x\n${planted}\n`) })).toBe(true);
    expect(namesZipRouteOutsideSeam({ file: CLIENT_SEAM, source: planted })).toBe(true);
    expect(namesZipRouteOutsideSeam({ file: 'app/api/business-os/data-exports/route.ts', source: planted })).toBe(false);
    expect(namesZipRouteOutsideSeam({ file: 'components/other/Doc.tsx', source: '// calls /api/business-os/data-exports' })).toBe(false);
  });

  it('4 also flags a second client naming the module export route (MX-1b, SA C-5), LF and CRLF', () => {
    const planted = "await fetch('/api/business-os/export-requests', { method: 'POST' });";
    expect(namesZipRouteOutsideSeam({ file: 'components/business-os/data-export/ExportDrawer.tsx', source: planted })).toBe(true);
    expect(namesZipRouteOutsideSeam({ file: 'hooks/useExport.ts', source: crlf(`x\n${planted}\n`) })).toBe(true);
    expect(namesZipRouteOutsideSeam({ file: CLIENT_SEAM, source: planted })).toBe(false);
    expect(namesZipRouteOutsideSeam({ file: 'app/api/business-os/export-requests/route.ts', source: planted })).toBe(false);
    expect(namesZipRouteOutsideSeam({ file: 'components/other/Doc.tsx', source: ' * calls /api/business-os/export-requests' })).toBe(false);
  });

  it('codeOf keeps a URL after `//` and drops whole-line comments', () => {
    expect(codeOf("const u = 'https://x.example/api/user/data-export';")).toContain('/api/user/data-export');
    expect(codeOf('   // /api/user/data-export\r\nconst a = 1;')).not.toContain('data-export');
  });
});
