/**
 * PERF-2: the owner-side phone library stays out of the first download.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOLDS
 *
 * The contact modal, the old and new contact drawers' phone fields and the
 * booking modal read `react-phone-number-input` through `usePhoneLib`, which
 * fetches `components/crm/phoneLib.ts` after first paint
 * (docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md §11.2, PC-2).
 *
 * One static import of the library, or of `phoneLib.ts`, in any of them puts
 * the whole library back into the first download of every page that reaches
 * that component. So:
 *   - nothing in the source tree statically imports `phoneLib.ts`;
 *   - the four converted components import no VALUE from the library (type
 *     imports and the stylesheet are fine: neither is JavaScript at runtime);
 *   - they do not reach it the long way round either, through `phoneField.ts`
 *     or `SearchableCountrySelect.tsx`, which import the library themselves.
 *
 * `BusinessProfileSection` keeps its static import by decision (AC-2.5): the
 * field is visible as soon as that section is, and the section now lives in
 * the lazily loaded configuration dialog (PERF-1).
 *
 * WHY A SOURCE GUARD: bundle size is only measurable with `next build`, which
 * no PR check reads for size. Comments are stripped before matching.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'];

const CONVERTED = [
  'components/crm/CRMContactModal.tsx',
  'components/crm/CRMContactDrawer.tsx',
  'components/crm/contact-drawer/ClientDetailsSection.tsx',
  'components/scheduling/SchedulingBookingModal.tsx',
];

/** Modules that pull the library in at runtime when imported as a value. */
const HEAVY_FOR_CONVERTED = [
  'react-phone-number-input',
  'react-phone-number-input/locale/en',
  'components/crm/phoneField',
  'components/crm/SearchableCountrySelect',
  'components/crm/phoneLib',
];

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

/** Repo-relative module path for local specifiers, the bare name for packages. */
function resolveSpecifier(fromFile: string, specifier: string): string {
  let absolute: string;
  if (specifier.startsWith('@/')) absolute = path.join(ROOT, specifier.slice(2));
  else if (specifier.startsWith('.')) absolute = path.resolve(path.dirname(fromFile), specifier);
  else return specifier;
  return path.relative(ROOT, absolute).replace(/\\/g, '/').replace(/\.(tsx?|jsx?)$/, '');
}

/** Specifiers imported as VALUES. `import type` and dynamic `import()` are not matched. */
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

const read = (file: string) => stripComments(fs.readFileSync(path.join(ROOT, file), 'utf8'));

describe('PERF-2: the owner-side phone library loads on demand', () => {
  const files = sourceFiles();

  it('scans a real tree (a silently empty walk would pass everything)', () => {
    expect(files.length).toBeGreaterThan(500);
  });

  it('nothing statically imports components/crm/phoneLib', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const specifier of staticValueSpecifiers(code)) {
        if (resolveSpecifier(file, specifier) === 'components/crm/phoneLib') {
          offenders.push(`${path.relative(ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it.each(CONVERTED)('%s imports no value that carries the library', file => {
    const offenders = staticValueSpecifiers(read(file))
      .map(specifier => resolveSpecifier(path.join(ROOT, file), specifier))
      .filter(target => HEAVY_FOR_CONVERTED.includes(target));
    expect(offenders).toEqual([]);
  });

  it.each(CONVERTED)('%s draws the field from usePhoneLib, with a placeholder while it loads', file => {
    const code = read(file);
    expect(code).toContain("import { usePhoneLib } from '@/components/crm/usePhoneLib'");
    expect(code).toContain('<phoneLib.PhoneInput');
    expect(code).toContain('<phoneLib.SearchableCountrySelect');
    expect(code).toContain('<PhoneFieldPlaceholder');
    // The stylesheet stays static, so the cascade is what it was.
    expect(code).toContain("import 'react-phone-number-input/style.css'");
  });

  it('the loader fetches phoneLib with a dynamic import', () => {
    const code = read('components/crm/usePhoneLib.ts');
    expect(code).toContain("import('@/components/crm/phoneLib')");
  });

  it('pages whose phone surfaces mount only on click start the download themselves', () => {
    expect(read('app/business-os/crm/page.tsx')).toContain('usePhoneLibSettled()');
    expect(read('app/(protected)/scheduling/page.tsx')).toContain('usePrefetchPhoneLib()');
  });

  it('the CRM deep link waits for the library to settle before opening the drawer (AC-2.3)', () => {
    const code = read('app/business-os/crm/page.tsx');
    expect(code).toContain("if (contactId && contacts.length > 0 && phoneLibSettled)");
    expect(code).toContain('[searchParams, contacts, phoneLibSettled]');
  });
});
