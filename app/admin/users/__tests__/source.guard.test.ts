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
  // Credit deduction slice 11c
  `${ROOT}/components/CreditsBlock.tsx`,
  `${ROOT}/components/CreditFormDialog.tsx`,
  `${ROOT}/creditCopy.ts`,
  // Credit deduction slice 8a
  `${ROOT}/components/CreditsLeftCell.tsx`,
  // Admin delete AD-1c
  `${ROOT}/components/DeleteBusinessDialog.tsx`,
  `${ROOT}/deletionCopy.ts`,
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

describe('the Credits block (credit deduction slice 11c)', () => {
  const CREDIT_FILES = [`${ROOT}/components/CreditsBlock.tsx`, `${ROOT}/components/CreditFormDialog.tsx`, `${ROOT}/creditCopy.ts`];
  const BLOCK = `${ROOT}/components/CreditsBlock.tsx`;

  /** A code line naming both figures: the shape of a combined "remaining" (G11c-1, S11-CR-3). */
  const COMBINED = (code: string) =>
    code.split('\n').filter((line) => line.includes('planLeft') && line.includes('extraCredits'));

  it('the combined-figure rule sees a planted sum', () => {
    expect(COMBINED('const total = usage.planLeft + extra.extraCredits;')).toHaveLength(1);
    expect(COMBINED('const a = usage.planLeft;\nconst b = extra.extraCredits;')).toHaveLength(0);
  });

  it.each(CREDIT_FILES)('%s never puts plan left and extra credits in one expression (no combined figure)', (file) => {
    expect(COMBINED(codeOf(read(file)))).toEqual([]);
  });

  it('the block shows no share, band or running-low line (SA W11c-14)', () => {
    const code = codeOf(read(BLOCK));
    expect(code).not.toContain('%');
    expect(code).not.toMatch(/creditBands/);
    expect(code).not.toMatch(/running low/i);
  });

  it('the block names no decidedBy: it shows the layer the server sent as allowanceLayer', () => {
    const code = codeOf(read(BLOCK));
    expect(code).not.toMatch(/decidedBy/);
    expect(code).toContain('allowanceLayer');
  });

  it.each(CREDIT_FILES)('%s renders free text as text only (no dangerouslySetInnerHTML)', (file) => {
    expect(codeOf(read(file))).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it.each([BLOCK, `${ROOT}/components/CreditFormDialog.tsx`])('%s is a client component', (file) => {
    expect(read(file)).toMatch(/^'use client';/);
  });

  it('the forms post to the existing entitlements route, and add no credit route of their own', () => {
    const dialog = codeOf(read(`${ROOT}/components/CreditFormDialog.tsx`));
    expect(dialog).toContain('/api/admin/business-os/entitlements/accounts/');
    expect(dialog).toContain("op: 'grant_credits'");
    expect(dialog).toContain("op: 'reduce_credit_lot'");
  });

  it('the panel renders the block above the plan, with the business label (user UI fixes, 2026-10-04)', () => {
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(panel).toContain('<CreditsBlock accountId={accountId} businessLabel={businessLabel} />');
    expect(panel.indexOf('<CreditsBlock')).toBeLessThan(panel.indexOf('<EntitlementSnapshot'));
  });

  it('the plan is folded in the panel only: the Plans page component itself is unchanged and has no fold', () => {
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(panel).toMatch(/<details[\s\S]*<EntitlementSnapshot[\s\S]*<\/details>/);
    const snapshot = codeOf(read('app/admin/business-os-tiers/components/EntitlementSnapshot.tsx'));
    expect(snapshot).not.toMatch(/<details|Collapsible/);
  });
});

describe('the Delete… dialog is read-only (admin delete AD-1c; SA SC-9, FR-A1, FR-A3)', () => {
  const DIALOG = `${ROOT}/components/DeleteBusinessDialog.tsx`;
  const DELETION_FILES = [DIALOG, `${ROOT}/deletionCopy.ts`];

  it('is a client component', () => {
    expect(read(DIALOG)).toMatch(/^'use client';/);
  });

  it('calls exactly one URL, the read-only preview route, with POST and an empty body', () => {
    const code = codeOf(read(DIALOG));
    const urls = [...code.matchAll(/`(\/api\/[^`]*)`|'(\/api\/[^']*)'/g)].map((m) => m[1] ?? m[2]);
    expect(urls).toEqual(['/api/admin/users/${encodeURIComponent(accountId)}/deletion/preview']);
    expect(code.match(/fetch\(/g)).toHaveLength(1);
    expect(code).toContain("method: 'POST'");
    expect(code).toContain('JSON.stringify({})');
  });

  it.each(DELETION_FILES)('%s names no commit route and no token', (file) => {
    const code = codeOf(read(file));
    expect(code).not.toMatch(/commit/i);
    expect(code).not.toMatch(/token/i);
  });

  it('offers no confirmation input, and the confirm button is always disabled', () => {
    const code = codeOf(read(DIALOG));
    expect(code).not.toMatch(/<(input|textarea|select|Input|Textarea|Checkbox)\b/);
    const confirm = /<Button[^>]*data-testid="deletion-confirm"[^>]*>/.exec(code);
    expect(confirm).not.toBeNull();
    expect(confirm![0]).toMatch(/\sdisabled\s/);
    expect(confirm![0]).not.toMatch(/disabled=\{/);
    expect(confirm![0]).not.toMatch(/onClick/);
  });

  it.each(DELETION_FILES)('%s renders server text as text only (no dangerouslySetInnerHTML)', (file) => {
    expect(codeOf(read(file))).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('the page opens it from the expanded row only, inside the danger area', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(page.match(/<DeleteBusinessDialog\b/g)).toHaveLength(1);
    const expanded = page.indexOf('{isExpanded && (');
    const dangerArea = page.indexOf('data-testid="danger-area"');
    expect(expanded).toBeGreaterThan(-1);
    expect(dangerArea).toBeGreaterThan(expanded);
    expect(page.indexOf('<DeleteBusinessDialog')).toBeGreaterThan(dangerArea);
    expect(page.indexOf('data-testid="delete-business-open"')).toBeGreaterThan(dangerArea);
  });
});
