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

describe('the Delete… dialog: preview, then a typed confirmation only with a token (admin delete AD-1c / AD-2b; SA SC-9, AC2-5, FR-A1, FR-A3, FR-A6)', () => {
  const DIALOG = `${ROOT}/components/DeleteBusinessDialog.tsx`;
  const DELETION_FILES = [DIALOG, `${ROOT}/deletionCopy.ts`];

  it('is a client component', () => {
    expect(read(DIALOG)).toMatch(/^'use client';/);
  });

  it('calls exactly two URLs: the preview with an empty body, the commit with { token, confirmText }', () => {
    const code = codeOf(read(DIALOG));
    const urls = [...code.matchAll(/`(\/api\/[^`]*)`|'(\/api\/[^']*)'/g)].map((m) => m[1] ?? m[2]);
    expect(urls).toEqual([
      '/api/admin/users/${encodeURIComponent(accountId)}/deletion/preview',
      '/api/admin/users/${encodeURIComponent(accountId)}/deletion/commit',
    ]);
    expect(code.match(/fetch\(/g)).toHaveLength(2);
    expect(code.match(/method: 'POST'/g)).toHaveLength(2);
    expect(code).toContain('JSON.stringify({})');
    expect(code).toContain('JSON.stringify({ token, confirmText })');
  });

  it('the token is held in component state only: never a URL, storage, a cookie or a log (SA AC2-5)', () => {
    const code = codeOf(read(DIALOG));
    expect(code).not.toMatch(/localStorage|sessionStorage|document\.cookie|URLSearchParams|history\.|useRouter|useSearchParams/);
    expect(code).not.toMatch(/logger|createLogger/);
    for (const url of code.matchAll(/`(\/api\/[^`]*)`/g)) expect(url[1]).not.toMatch(/token/i);
  });

  it('the confirmation is offered only with a token, a value to type, and no blocking refusal (FR-A3)', () => {
    const code = codeOf(read(DIALOG));
    const gate = /function confirmableValue\([\s\S]*?\n\}/.exec(code);
    expect(gate).not.toBeNull();
    expect(gate![0]).toContain('if (!preview.commitToken) return null;');
    expect(gate![0]).toMatch(/BLOCKING_STATUSES\.has\(r\.status\)\)\) return null;/);
    // The one input lives in ConfirmField, and ConfirmField is rendered only in the confirmable branch.
    expect(code.match(/<(input|textarea|select|Input|Textarea|Checkbox)\b/g)).toEqual(['<Input']);
    expect(code.match(/<ConfirmField\b/g)).toHaveLength(1);
    const branch = code.indexOf('isConfirmable && preview ? (');
    expect(branch).toBeGreaterThan(-1);
    expect(code.indexOf('<ConfirmField')).toBeGreaterThan(branch);
    expect(code).toMatch(/const isConfirmable = expected !== null && !hasOutcome;/);
  });

  it('without a token the confirm is hard-disabled; with one it is disabled until the text matches', () => {
    const code = codeOf(read(DIALOG));
    const confirms = [...code.matchAll(/<Button[^>]*data-testid="deletion-confirm"[^>]*>/g)].map((m) => m[0]);
    expect(confirms).toHaveLength(2);
    const [submit, hard] = confirms;
    expect(submit).toMatch(/type="submit"/);
    expect(submit).toMatch(/disabled=\{!canSubmit\}/);
    expect(hard).toMatch(/\sdisabled\s/);
    expect(hard).not.toMatch(/disabled=\{/);
    for (const c of confirms) {
      expect(c).not.toMatch(/onClick/);
      expect(c).toMatch(/aria-describedby=\{reasonId\}/);
    }
    // Enter in the field must not submit what the button would not.
    expect(code).toMatch(/event\.preventDefault\(\);[\s\S]{0,120}if \(!canSubmit \|\| !preview\?\.commitToken\) return;/);
  });

  /**
   * Every `message` read in the dialog, by any spelling: `x.message`, `x?.message`,
   * `(x as T)?.message`, `x['message']`, or a destructured `{ message }`. Each is
   * reported with what it was read from, so only the AD-1c refusal rows survive.
   */
  function messageReads(code: string): string[] {
    const reads: string[] = [];
    for (const m of code.matchAll(/([\w)\]]+)\s*\??\.\s*message\b/g)) reads.push(m[1]);
    for (const m of code.matchAll(/\[\s*['"`]message['"`]\s*\]/g)) reads.push(m[0]);
    for (const m of code.matchAll(/\{[^{}]*\bmessage\b[^{}]*\}\s*=/g)) reads.push(m[0]);
    return reads;
  }

  it('the message-read detector sees every spelling (planted samples)', () => {
    expect(messageReads('a = refusal.message;')).toEqual(['refusal']);
    expect(messageReads('a = body?.message;')).toEqual(['body']);
    expect(messageReads('a = (record as Foo)?.message;')).toEqual(['Foo)']);
    expect(messageReads('a = (parsed as Record<string, unknown>).message;')).toEqual([')']);
    expect(messageReads("a = record['message'];")).toEqual(["['message']"]);
    expect(messageReads('const { message } = body;')).toHaveLength(1);
  });

  it('never renders the server’s own text for a commit: the only `message` read is a preview refusal row', () => {
    const code = codeOf(read(DIALOG));
    expect(messageReads(code)).toEqual(['refusal']);
    expect(code).toContain('{refusal.message}');
    // A `details` field read (the `<details>` element and "Technical details" copy are fine).
    expect(code).not.toMatch(/\??\.\s*details\b|\[\s*['"`]details['"`]\s*\]|\{[^{}]*\bdetails\b[^{}]*\}\s*=/);
    // Only the preview's kept-table notes (AD-1c technical expander) are read; never the commit's residue / kept / notes.
    expect([...code.matchAll(/(\w+)\??\.(residue|kept|notes)\b/g)].map((m) => m[0])).toEqual(['t.notes', 't.notes']);
    // postCommit reads only the fields of DeletionCommitRefusalView.
    const post = /async function postCommit\([\s\S]*?\n\}/.exec(code);
    expect(post).not.toBeNull();
    expect(post![0]).not.toMatch(/message|details|residue|notes/);
  });

  it('a second submit while one is running cannot POST twice (an in-flight ref, not only state)', () => {
    const code = codeOf(read(DIALOG));
    expect(code).toMatch(/const inFlight = useRef\(false\);/);
    expect(code).toMatch(/if \(inFlight\.current\) return;\s*inFlight\.current = true;/);
  });

  it.each(DELETION_FILES)('%s renders server text as text only (no dangerouslySetInnerHTML)', (file) => {
    expect(codeOf(read(file))).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('the page opens it from the expanded row only, inside the danger area, and refreshes the list after a deletion', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(page.match(/<DeleteBusinessDialog\b/g)).toHaveLength(1);
    const expanded = page.indexOf('{isExpanded && (');
    const dangerArea = page.indexOf('data-testid="danger-area"');
    expect(expanded).toBeGreaterThan(-1);
    expect(dangerArea).toBeGreaterThan(expanded);
    expect(page.indexOf('<DeleteBusinessDialog')).toBeGreaterThan(dangerArea);
    expect(page.indexOf('data-testid="delete-business-open"')).toBeGreaterThan(dangerArea);
    const dialog = page.slice(page.indexOf('<DeleteBusinessDialog'), page.indexOf('/>', page.indexOf('<DeleteBusinessDialog')));
    expect(dialog).toMatch(/onDeleted=\{\(\) => \{\s*void fetchUsers\(\);\s*\}\}/);
  });
});

describe('the account hard delete in the danger area (AU-1 / AU-2; SA AU-C2 … AU-C5)', () => {
  const PANEL_FILE = 'components/business-os/purge/TestAccountCleanupPanel.tsx';
  const PANEL_IMPORT = "import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';";

  it('AU-C5: the AD-1 Delete… entry is hidden by a constant that is false, gating both the button and the dialog', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(page.match(/const SHOW_AD1_DELETE_ENTRY = (\w+);/g)).toEqual(['const SHOW_AD1_DELETE_ENTRY = false;']);
    const gate = page.indexOf('{SHOW_AD1_DELETE_ENTRY && (');
    expect(gate).toBeGreaterThan(page.indexOf('data-testid="danger-area"'));
    expect(page.indexOf('data-testid="delete-business-open"')).toBeGreaterThan(gate);
    expect(page.indexOf('<DeleteBusinessDialog')).toBeGreaterThan(gate);
    // Both sit before the gate closes, i.e. before the panel that follows it.
    expect(page.indexOf('<DeleteBusinessDialog')).toBeLessThan(page.indexOf('<TestAccountCleanupPanel'));
  });

  it('AU-C2 / AU-C3: the page imports the panel only and mounts it once, after danger-area, keyed by the row, only with an email', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(page).toContain(PANEL_IMPORT);
    expect(page).not.toMatch(/cleanupApiTypes/);
    expect(page.match(/<TestAccountCleanupPanel\b/g)).toHaveLength(1);
    const expanded = page.indexOf('{isExpanded && (');
    const dangerArea = page.indexOf('data-testid="danger-area"');
    expect(dangerArea).toBeGreaterThan(expanded);
    const at = page.indexOf('<TestAccountCleanupPanel');
    expect(at).toBeGreaterThan(dangerArea);
    const panel = page.slice(at, page.indexOf('/>', at));
    expect(panel).toMatch(/key=\{user\.id\}/);
    expect(panel).toMatch(/lockedEmail=\{user\.email\}/);
    expect(panel).toMatch(/onRemoved=\{\(\) => \{\s*void fetchUsers\(\);\s*\}\}/);
    expect(page.slice(dangerArea, at)).toMatch(/\{user\.email \? \(\s*$/);
  });

  it('AU-C4: neither the page nor the panel names the database function, comments included', () => {
    for (const file of [`${ROOT}/page.tsx`, PANEL_FILE]) {
      // Split so this guard does not itself name the function (R-7: only the repository may).
      expect({ file, hit: read(file).includes('operator_test_' + 'account_cleanup') }).toEqual({ file, hit: false });
    }
  });

  it('AU-C7: the panel has no console.*', () => {
    expect(codeOf(read(PANEL_FILE))).not.toMatch(/console\./);
  });
});
