/**
 * PERF-2 + BR-2: the phone library stays out of the first download, on owner
 * pages and on the public website.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS HOLDS
 *
 * PERF-2 (owner side): the contact modal, the old and new contact drawers'
 * phone fields and the booking modal read `react-phone-number-input` through
 * `usePhoneLib`, which fetches `components/crm/phoneLib.ts` after first paint
 * (docs/requirements/PERFORMANCE_IMPROVEMENT_SCOPING.md §11.2, PC-2).
 *
 * BR-2 (public side): the website contact-form block does the same, so every
 * public site and contact page paints without the library
 * (docs/requirements/PERFORMANCE_BUSINESS_ROUND_REQUIREMENT.md §4). Its phone
 * row shows `PublicPhoneFieldPlaceholder` until the library arrives, and
 * `WebsiteCountrySelect` is reached only through the `phoneLib` barrel.
 *
 * One static import of the library, or of `phoneLib.ts`, in any of them puts
 * the whole library back into the first download of every page that reaches
 * that component. So:
 *   - nothing in the source tree statically imports `phoneLib.ts`;
 *   - the converted components import no VALUE from the library (type
 *     imports and the stylesheet are fine: neither is JavaScript at runtime);
 *   - they do not reach it the long way round either, through `phoneField.ts`,
 *     `SearchableCountrySelect.tsx` or `WebsiteCountrySelect.tsx`, which import
 *     the library themselves;
 *   - the two modules the public block DOES import at first render
 *     (`publicFormCountry.ts`, `PublicPhoneFieldPlaceholder.tsx`) carry none of
 *     it;
 *   - no public-surface file imports it at all, apart from the allow-list.
 *
 * `BusinessProfileSection` keeps its static import by decision (PERF-2
 * AC-2.5): the field is visible as soon as that section is, and the section
 * now lives in the lazily loaded configuration dialog (PERF-1).
 *
 * WHY A SOURCE GUARD: bundle size is only measurable with `next build`, which
 * no PR check reads for size. Comments are stripped before matching.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks'];

/** Owner-side components converted in PERF-2. */
const OWNER_CONVERTED = [
  'components/crm/CRMContactModal.tsx',
  'components/crm/CRMContactDrawer.tsx',
  'components/crm/contact-drawer/ClientDetailsSection.tsx',
  'components/scheduling/SchedulingBookingModal.tsx',
];

/** The public website contact-form block, converted in BR-2. */
const PUBLIC_BLOCK = 'components/website/blocks/ContactFormBlock.tsx';

/** Every converted component: none may import a value that carries the library. */
const CONVERTED = [...OWNER_CONVERTED, PUBLIC_BLOCK];

/**
 * Modules the public block imports at FIRST render, before the library
 * arrives, so they must be library-free too (BR-2 RC-5).
 */
const PUBLIC_FIRST_RENDER = [
  'components/crm/publicFormCountry.ts',
  'components/website/blocks/PublicPhoneFieldPlaceholder.tsx',
];

/** Directories whose files make up the public website and contact pages. */
const PUBLIC_SURFACE_DIRS = ['components/website', 'components/public', 'app/site', 'app/c'];

/**
 * Public-surface files allowed to import the library statically, each with
 * its reason. Anything else on the public surface that does is a regression.
 */
const PUBLIC_ALLOW_LIST: Record<string, string> = {
  // Not served by any route (PERF-3 found no importer). Out of BR-2's scope
  // (requirement §4.8); a separate clean-up candidate.
  'app/site/[subdomain]/book/BookingWidget.tsx': 'unreferenced legacy widget',
  // It IS a library consumer, by design. It is reached only through the
  // `phoneLib` barrel, which is fetched on demand; the importer check pins it.
  'components/website/blocks/WebsiteCountrySelect.tsx': 'reached only through phoneLib',
};

/** Modules that pull the library in at runtime when imported as a value. */
const HEAVY_FOR_CONVERTED = [
  'react-phone-number-input',
  'react-phone-number-input/locale/en',
  'components/crm/phoneField',
  'components/crm/SearchableCountrySelect',
  'components/crm/phoneLib',
  'components/website/blocks/WebsiteCountrySelect',
];

/** True for a resolved specifier that loads library JavaScript (the stylesheet does not). */
function isLibraryValue(target: string): boolean {
  if (target.endsWith('.css')) return false;
  return (
    target === 'react-phone-number-input' ||
    target.startsWith('react-phone-number-input/') ||
    HEAVY_FOR_CONVERTED.includes(target)
  );
}

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
const relative = (file: string) => path.relative(ROOT, file).replace(/\\/g, '/');

describe('PERF-2 + BR-2: the phone library loads on demand', () => {
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

  it.each(OWNER_CONVERTED)('%s draws the field from usePhoneLib, with a placeholder while it loads', file => {
    const code = read(file);
    expect(code).toContain("import { usePhoneLib } from '@/components/crm/usePhoneLib'");
    expect(code).toContain('<phoneLib.PhoneInput');
    expect(code).toContain('<phoneLib.SearchableCountrySelect');
    expect(code).toContain('<PhoneFieldPlaceholder');
    // The stylesheet stays static, so the cascade is what it was.
    expect(code).toContain("import 'react-phone-number-input/style.css'");
  });

  it('the public contact-form block draws its whole phone row from usePhoneLib (BR-2)', () => {
    const code = read(PUBLIC_BLOCK);
    expect(code).toMatch(/import \{[^}]*\busePhoneLib\b[^}]*\} from '@\/components\/crm\/usePhoneLib'/);
    expect(code).toContain('<phoneLib.PhoneInput');
    expect(code).toContain('<phoneLib.WebsiteCountrySelect');
    expect(code).toContain('<PublicPhoneFieldPlaceholder');
    expect(code).toContain('.isValidPhoneNumber(');
    // The starting country comes from the library-free module.
    expect(code).toContain("import { publicFormCountry } from '@/components/crm/publicFormCountry'");
    // The stylesheet stays static, so there is no unstyled frame (C-8).
    expect(code).toContain("import 'react-phone-number-input/style.css'");
  });

  it.each(PUBLIC_FIRST_RENDER)('%s, used at the first render, carries no library value', file => {
    const offenders = staticValueSpecifiers(read(file))
      .map(specifier => resolveSpecifier(path.join(ROOT, file), specifier))
      .filter(isLibraryValue);
    expect(offenders).toEqual([]);
  });

  it('publicFormCountry.ts imports from the library for types only', () => {
    const code = read('components/crm/publicFormCountry.ts');
    const fromLibrary = code.match(/^\s*import\b[^;]*from\s+'react-phone-number-input[^']*'/gm) ?? [];
    expect(fromLibrary.length).toBeGreaterThan(0);
    for (const statement of fromLibrary) expect(statement).toMatch(/^\s*import\s+type\s/);
  });

  it('no public-surface file imports the library statically, apart from the allow-list', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (!PUBLIC_SURFACE_DIRS.some(dir => rel.startsWith(`${dir}/`))) continue;
      if (rel in PUBLIC_ALLOW_LIST) continue;
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const specifier of staticValueSpecifiers(code)) {
        if (isLibraryValue(resolveSpecifier(file, specifier))) offenders.push(`${rel} -> ${specifier}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('WebsiteCountrySelect is imported only by the phoneLib barrel and the unreferenced BookingWidget', () => {
    const importers: string[] = [];
    for (const file of files) {
      const code = stripComments(fs.readFileSync(file, 'utf8'));
      for (const specifier of staticValueSpecifiers(code)) {
        if (resolveSpecifier(file, specifier) === 'components/website/blocks/WebsiteCountrySelect') {
          importers.push(relative(file));
        }
      }
    }
    expect(importers.sort()).toEqual(
      ['app/site/[subdomain]/book/BookingWidget.tsx', 'components/crm/phoneLib.ts'].sort()
    );
  });

  it('the barrel carries what the public block needs', () => {
    const code = read('components/crm/phoneLib.ts');
    expect(code).toMatch(/export \{[^}]*\bisValidPhoneNumber\b[^}]*\} from 'react-phone-number-input'/);
    expect(code).toContain("export { WebsiteCountrySelect } from '@/components/website/blocks/WebsiteCountrySelect'");
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
