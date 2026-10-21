/**
 * PERF-1: the configuration and scheduling dialogs stay out of the first download.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOLDS
 *
 * `ConfigurationDialog` and `SchedulingDialog` are loaded through
 * `components/business-os/lazyDialogs.tsx` (a retrying loader, nothing server-rendered), so
 * neither chunk is part of a Business OS page's First Load JS
 * (docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md §11.2, PC-1).
 *
 * ONE static import anywhere undoes that for every page that reaches it: a
 * bundler keeps a module in the page chunk if ANY path to it is static. The
 * provider's import alone put the configuration dialog on every owner page,
 * and it also rode along into `/scheduling` through `SchedulingBookingModal`'s
 * use of the provider's hooks. So this scans the whole source tree, not the
 * five sites that were changed.
 *
 * WHY A SOURCE GUARD: the bundle is only measurable with `next build`, which
 * no PR check reads for size. A source rule is the cheap, early version of the
 * same fact. Type-only imports are allowed: they erase at build time.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'];

const LAZY_MODULE = 'components/business-os/lazyDialogs.tsx';
const HEAVY_MODULES = [
  'components/business-os/ConfigurationDialog',
  'components/business-os/SchedulingDialog',
];

/** Every non-test .ts/.tsx file under the scanned directories. */
function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
  };
  for (const dir of SCAN_DIRS) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return out;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

/** The module a specifier points at, as a repo-relative path without extension. */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  let absolute: string;
  if (specifier.startsWith('@/')) absolute = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) absolute = path.resolve(path.dirname(fromFile), specifier);
  else return null;
  return path.relative(ROOT, absolute).replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
}

/**
 * Specifiers imported as VALUES: `import x from`, `import { x } from`,
 * `export … from`, bare `import '…'` and `require('…')`. `import type` is
 * excluded; dynamic `import('…')` is not matched at all, which is the point.
 */
function staticValueSpecifiers(code: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /(?:^|\n)\s*import\s+(?!type\s)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s+(?!type\s)[^'";]*?\sfrom\s+['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code))) specs.push(match[1]);
  }
  return specs;
}

describe('PERF-1: configuration and scheduling dialogs load lazily', () => {
  const files = sourceFiles();

  it('scans a real tree (a silently empty walk would pass everything)', () => {
    expect(files.length).toBeGreaterThan(500);
    expect(files.map(f => path.relative(ROOT, f).replace(/\\/g, '/'))).toContain(LAZY_MODULE);
  });

  it('has no static value import of either dialog anywhere in the source tree', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const specifier of staticValueSpecifiers(code)) {
        const target = resolveSpecifier(file, specifier);
        if (target && HEAVY_MODULES.includes(target)) {
          offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * Through the retrying loader, not `next/dynamic`. `next/dynamic` caches
   * whatever its loader resolves to for the life of the page, so a fallback for
   * a failed chunk became a permanently dead dialog
   * (docs/workplans/PERF_1_LAZY_DIALOG_FAILURE_FIX.md). The loader's behaviour —
   * retry, visible error, nothing cached, nothing server-rendered — is pinned in
   * `lazyDialogLoader.test.tsx`.
   */
  it('loads both dialogs through the retrying loader, not next/dynamic', () => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, LAZY_MODULE), 'utf8'));
    expect(code).toContain("import('@/components/business-os/ConfigurationDialog')");
    expect(code).toContain("import('@/components/business-os/SchedulingDialog')");
    expect(code.match(/createLazyDialog</g)?.length).toBe(2);
    expect(code).not.toContain('next/dynamic');
    expect(code).not.toMatch(/\.catch\(/);
  });

  it.each([
    ['components/business-os/ConfigurationDialogProvider.tsx', 'LazyConfigurationDialog'],
    ['components/business-os/BusinessOSHeader.tsx', 'LazySchedulingDialog'],
    ['app/business-os/page.tsx', 'LazyConfigurationDialog'],
    ['app/business-os/page.tsx', 'LazySchedulingDialog'],
    ['app/business-os/website/page.tsx', 'LazyConfigurationDialog'],
    ['components/business-os/WebsiteSetupWizard.tsx', 'LazyConfigurationDialog'],
    ['app/onboarding-build/page.tsx', 'LazyConfigurationDialog'],
  ])('%s renders %s', (file, component) => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));
    expect(code).toContain(`<${component}`);
  });

  it('keeps a closed, always-mounted instance on onboarding-build, which is outside the layout that warms it', () => {
    const code = stripComments(fs.readFileSync(path.join(ROOT, 'app/onboarding-build/page.tsx'), 'utf8'));
    expect(code).toMatch(/<LazyConfigurationDialog isOpen=\{false\}/);
  });
});
