/**
 * The properties of the Businesses screen no rendering test can reach
 * (admin reorganisation slice 2b). Modelled on
 * app/admin/business-os-tiers/__tests__/source.guard.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = 'app/admin/users';

const read = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8');

/** Source with comments removed, so prose about a rule cannot satisfy it. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const SCREEN_FILES = [
  `${ROOT}/page.tsx`,
  `${ROOT}/components/BusinessOsPanel.tsx`,
  `${ROOT}/types.ts`,
  // Slice 4
  `${ROOT}/components/UserNameLine.tsx`,
  `${ROOT}/userName.ts`,
  // Credit deduction slice 8a
  `${ROOT}/components/CreditsLeftCell.tsx`,
];

/**
 * Credit deduction slice 8a (SA C-S8-1, DV-4): the ONE allowed `lib/business-os`
 * import on this screen — the band module, which imports nothing itself — and
 * only in the "Credits left" cell. An exact string, never a prefix.
 */
const BANDS_IMPORT = '@/lib/business-os/credits/creditBands';
const BANDS_FILE = `${ROOT}/components/CreditsLeftCell.tsx`;

/** Every `lib/business-os` module a file imports. */
function businessOsImports(code: string): string[] {
  return [...code.matchAll(/from ['"](@\/lib\/business-os[^'"]*)['"]/g)].map((m) => m[1]);
}

/** The forbidden ones: all of them, except the band module in the cell. */
function forbiddenBusinessOsImports(file: string, code: string): string[] {
  return businessOsImports(code).filter((spec) => !(file === BANDS_FILE && spec === BANDS_IMPORT));
}

describe('the screen is protected by the layout it inherits from', () => {
  it('app/admin/layout.tsx still awaits requireAdminPage() as its FIRST statement', () => {
    const layout = codeOf(read('app/admin/layout.tsx'));
    const opener = /export default async function AdminLayout\s*\([\s\S]*?\)\s*\{/.exec(layout);
    expect(opener).not.toBeNull();

    const body = layout.slice(opener!.index + opener![0].length).trim();
    const end = Math.min(
      ...[body.indexOf(';'), body.indexOf('{')].filter((i) => i >= 0).concat([body.length])
    );
    expect(body.slice(0, end).trim()).toMatch(/await\s+requireAdminPage\s*\(\s*\)/);
  });
});

describe('the Business OS panel carries no server module and no second rule', () => {
  it('the band-module exception is exact (planted samples)', () => {
    const planted = (spec: string) => `import { x } from '${spec}';`;
    expect(forbiddenBusinessOsImports(BANDS_FILE, planted(BANDS_IMPORT))).toEqual([]);
    for (const spec of [
      '@/lib/business-os/credits/creditBandsX',
      '@/lib/business-os/credits/creditBands/index',
      '@/lib/business-os/credits/creditDisplay',
      '@/lib/business-os/entitlements/creditAllowanceView',
    ]) {
      expect(forbiddenBusinessOsImports(BANDS_FILE, planted(spec))).toEqual([spec]);
    }
    // Anywhere but the cell, even the band module is forbidden.
    expect(forbiddenBusinessOsImports(`${ROOT}/page.tsx`, planted(BANDS_IMPORT))).toEqual([BANDS_IMPORT]);
  });

  it('the "Credits left" cell is the one file that imports the band module', () => {
    for (const file of SCREEN_FILES) {
      const imports = businessOsImports(codeOf(read(file)));
      expect({ file, imports }).toEqual({ file, imports: file === BANDS_FILE ? [BANDS_IMPORT] : [] });
    }
  });

  it.each(SCREEN_FILES)('%s imports nothing from lib/business-os (but the pinned band module), the call catalog or a repository', (file) => {
    const code = codeOf(read(file));
    expect(forbiddenBusinessOsImports(file, code)).toEqual([]);
    expect(code).not.toMatch(/callCatalog/);
    expect(code).not.toMatch(/from ['"]@\/lib\/repositories/);
  });

  it.each(SCREEN_FILES)('%s has no console.*', (file) => {
    expect(codeOf(read(file))).not.toMatch(/console\./);
  });

  it('money is USD from the pricing table: no business or display currency is read', () => {
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(panel).not.toMatch(/LanguageContext|currencyCode|businessCurrency/);
    const currencies = [...panel.matchAll(/currency:\s*['"]([A-Z]{3})['"]/g)].map((m) => m[1]);
    expect(currencies).toEqual(['USD']);
  });

  it('the plan is rendered by the Plans & entitlements component, not re-implemented', () => {
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(panel).toContain("from '@/app/admin/business-os-tiers/components/EntitlementSnapshot'");
    expect(panel).toContain('<EntitlementSnapshot');
    expect(panel).not.toMatch(/decidedBy/);
  });

  it('links to the audit trail with the catalogue constant, never a string literal', () => {
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(panel).toContain('AUDIT_EVENTS.BUSINESS_AI_ACTION_FAILED');
    expect(panel).not.toContain("'BUSINESS_AI_ACTION_FAILED'");
  });
});
