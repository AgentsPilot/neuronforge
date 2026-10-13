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
  // Admin Layout Standard L-4a
  `${ROOT}/usersFilters.ts`,
  `${ROOT}/components/BusinessesKpis.tsx`,
  // Admin Layout Standard L-4b (the row detail moved into the drawer)
  `${ROOT}/components/BusinessDetail.tsx`,
  `${ROOT}/components/BusinessAuditSection.tsx`,
  `${ROOT}/useBusinessDetails.ts`,
  `${ROOT}/usersFormat.ts`,
  // Admin Layout follow-ups LF-4a.2 (the drawer layout)
  ...LF4A2_FILES(),
  // Admin Layout follow-ups LF-4b (inside the money blocks)
  `${ROOT}/components/moneyBlockUi.ts`,
  // Admin Layout follow-ups LF-4d (a box and a purpose line per section, BD-16)
  `${ROOT}/components/DrawerBox.tsx`,
];

/**
 * LF-4a.2: the summary strip, the folds and the "All products" block. They
 * only show what the drawer already read (BD-1): none of them sends a request.
 * A function, so the list can sit above `SCREEN_FILES` in reading order.
 */
function LF4A2_FILES(): string[] {
  return [
    `${ROOT}/components/BusinessSummaryStrip.tsx`,
    `${ROOT}/components/drawerFolds.tsx`,
    `${ROOT}/components/AllProductsUsage.tsx`,
  ];
}

describe('the LF-4d boxes add no request (BD-16, AC-4.3)', () => {
  it('DrawerBox.tsx calls no fetch and holds no state', () => {
    const code = codeOf(read(`${ROOT}/components/DrawerBox.tsx`));
    expect(code).not.toContain('fetch(');
    expect(code).not.toMatch(/useState|useEffect/);
  });

  // SA F1 (LF-4d code review, MD6): a box component declared inside a render
  // makes a new component type on every render, so the money blocks remount
  // and re-read without end; the drawer tests then die out of memory after
  // minutes with no message. This guard says why in milliseconds.
  it('the box components are declared once, at module level, in DrawerBox.tsx, and the drawer imports them from there', () => {
    // (a) Column 0: a declaration nested in a function body is indented and cannot match.
    const boxCode = codeOf(read(`${ROOT}/components/DrawerBox.tsx`));
    expect(boxCode).toMatch(/^export function DrawerBox[(]/m);
    expect(boxCode).toMatch(/^export function PartPurpose[(]/m);

    // (b) No other file declares a binding with either name (an import is not a declaration).
    const declares = /(^|[^A-Za-z0-9_$])(function|const|let|var|class)[ ]+(DrawerBox|PartPurpose)([^A-Za-z0-9_$]|$)/m;
    const others = [
      ...fs
        .readdirSync(path.join(process.cwd(), ROOT, 'components'))
        .filter((name) => name.endsWith('.tsx') && name !== 'DrawerBox.tsx')
        .map((name) => `${ROOT}/components/${name}`),
      `${ROOT}/page.tsx`,
    ];
    expect(others.length).toBeGreaterThan(5);
    const offenders = others.filter((file) => declares.test(codeOf(read(file))));
    expect({ declaresDrawerBoxOrPartPurpose: offenders }).toEqual({ declaresDrawerBoxOrPartPurpose: [] });

    // (c) The three drawer files take the components from the one module.
    for (const file of ['BusinessOsPanel.tsx', 'BusinessDetail.tsx', 'BusinessAuditSection.tsx']) {
      const imports = /from '[.][/]DrawerBox';/.test(codeOf(read(`${ROOT}/components/${file}`)));
      expect({ file, importsFromDrawerBox: imports }).toEqual({ file, importsFromDrawerBox: true });
    }
  });

  it('the F1 declaration pattern sees a nested declaration and ignores an import (planted samples)', () => {
    const declares = /(^|[^A-Za-z0-9_$])(function|const|let|var|class)[ ]+(DrawerBox|PartPurpose)([^A-Za-z0-9_$]|$)/m;
    expect(declares.test('  const DrawerBox = (props) => null;')).toBe(true);
    expect(declares.test('function PartPurpose() {}')).toBe(true);
    expect(declares.test("import { DrawerBox, PartPurpose } from './DrawerBox';")).toBe(false);
    expect(declares.test('const DrawerBoxModule = 1;')).toBe(false);
    expect(/^export function DrawerBox[(]/m.test('  export function DrawerBox(')).toBe(false);
  });
});

describe('the LF-4a.2 drawer layout adds no request (BD-1, AC-4.3)', () => {
  it.each(LF4A2_FILES())('%s calls no fetch', (file) => {
    expect(codeOf(read(file))).not.toContain('fetch(');
  });

  it('the strip renders the list cell, not a figure of its own (SQ-9, BD-2)', () => {
    const strip = codeOf(read(`${ROOT}/components/BusinessSummaryStrip.tsx`));
    expect(strip).toContain('<CreditsLeftCell business={business} creditsLeft={creditsLeft} />');
    expect(strip).not.toMatch(/planLeft|extraCredits|creditBands/);
  });
});

/**
 * LF-4b checks, written with string methods only (no regex escapes: the
 * repo's Tailwind-scan note). `flat` joins the lines, trimmed, with one space.
 */
const flat = (code: string) =>
  code
    .split(String.fromCharCode(10))
    .map((line) => line.split(String.fromCharCode(13)).join('').trim())
    .filter((line) => line.length > 0)
    .join(' ');
const occurrences = (code: string, needle: string) => code.split(needle).length - 1;

describe('LF-4b inside the money blocks (BD-14, BD-15)', () => {
  const BLOCK = `${ROOT}/components/CreditsBlock.tsx`;

  it('the money-block helper sends no request', () => {
    expect(codeOf(read(`${ROOT}/components/moneyBlockUi.ts`))).not.toContain('fetch(');
  });

  it('BD-14: the drawer hands refreshList to the panel as onCreditsChanged, the onRemoved shape', () => {
    const detail = flat(codeOf(read(`${ROOT}/components/BusinessDetail.tsx`)));
    expect(detail).toContain('onCreditsChanged={() => { void refreshList(); }}');
    const panel = codeOf(read(`${ROOT}/components/BusinessOsPanel.tsx`));
    expect(occurrences(panel, 'onCreditsChanged={onCreditsChanged}')).toBe(1);
  });

  it('BD-14: the Credits block calls onCreditsChanged exactly once, inside handleSuccess, and in no dependency list', () => {
    const code = codeOf(read(BLOCK));
    expect(occurrences(code, 'onCreditsChanged?.()')).toBe(1);
    const start = code.indexOf('function handleSuccess(');
    expect(start).toBeGreaterThan(-1);
    expect(code.slice(start, code.indexOf('}', start))).toContain('onCreditsChanged?.()');
    let at = code.indexOf('}, [');
    while (at >= 0) {
      expect(code.slice(at, code.indexOf(']', at))).not.toContain('onCreditsChanged');
      at = code.indexOf('}, [', at + 1);
    }
  });

  it.each([`${ROOT}/components/CreditFormDialog.tsx`, `${ROOT}/components/BoostCapDialog.tsx`])(
    'BD-15: %s forwards onCloseAutoFocus to DialogContent as a named handler',
    (file) => {
      const code = codeOf(read(file));
      expect(occurrences(code, '<DialogContent ')).toBe(1);
      const start = code.indexOf('<DialogContent ');
      expect(code.slice(start, code.indexOf('>', start))).toContain('onCloseAutoFocus={onCloseAutoFocus}');
    }
  );
});

/** The drawer body that holds the danger area since L-4b (it was the expanded row in `page.tsx`). */
const DETAIL = `${ROOT}/components/BusinessDetail.tsx`;

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
    // Boost slice 6b adds the take-back wiring props after these two (SA C-5).
    expect(panel).toMatch(/<CreditsBlock\s+accountId=\{accountId\}\s+businessLabel=\{businessLabel\}/);
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

  // L-4b (SA M-3): the expanded row became the drawer body. The page side pins
  // that the body is mounted only inside the one drawer; the detail side keeps
  // the old order and bodies, with `refreshList` (the page passes `fetchUsers`).
  it('the page mounts the detail only inside its one drawer, and names no danger-area part itself', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(page.match(/<AdminDrawer\b/g)).toHaveLength(1);
    expect(page.match(/<BusinessDetail\b/g)).toHaveLength(1);
    const drawer = page.indexOf('<AdminDrawer');
    const detail = page.indexOf('<BusinessDetail');
    expect(detail).toBeGreaterThan(drawer);
    expect(page.indexOf('</AdminDrawer>')).toBeGreaterThan(detail);
    expect(page.slice(drawer, detail)).toContain('open={isOpen && selected !== null}');
    expect(page.match(/refreshList=\{fetchUsers\}/g)).toHaveLength(1);
    // L-2b SA M-4: outside every branch. From the loaded branch's opening to the
    // drawer, every brace and parenthesis is closed again, so the drawer is not
    // inside `{!error && hasLoaded && (` (jsdom cannot tell an unmount from a close).
    const branch = page.slice(page.indexOf('{!error && hasLoaded && ('), drawer);
    expect(branch.length).toBeGreaterThan(0);
    const tally = (text: string, ch: string) => text.split(ch).length - 1;
    expect(tally(branch, '{')).toBe(tally(branch, '}'));
    expect(tally(branch, '(')).toBe(tally(branch, ')'));
    expect(page).not.toMatch(/DeleteBusinessDialog|TestAccountCleanupPanel|SHOW_AD1_DELETE_ENTRY|cleanupApiTypes/);
    expect(page).not.toContain('data-testid="danger-area"');
  });

  it('the detail opens it inside the danger area only, and refreshes the list after a deletion', () => {
    const detail = codeOf(read(DETAIL));
    expect(detail.match(/<DeleteBusinessDialog\b/g)).toHaveLength(1);
    const dangerArea = detail.indexOf('data-testid="danger-area"');
    expect(dangerArea).toBeGreaterThan(-1);
    expect(detail.indexOf('<DeleteBusinessDialog')).toBeGreaterThan(dangerArea);
    expect(detail.indexOf('data-testid="delete-business-open"')).toBeGreaterThan(dangerArea);
    const dialog = detail.slice(detail.indexOf('<DeleteBusinessDialog'), detail.indexOf('/>', detail.indexOf('<DeleteBusinessDialog')));
    expect(dialog).toMatch(/onDeleted=\{\(\) => \{\s*void refreshList\(\);\s*\}\}/);
    // The comment travels with the body, word for word (raw source: codeOf drops comments).
    expect(read(DETAIL)).toMatch(
      /onDeleted=\{\(\) => \{\s*\/\/ FR-A9: after a deletion the row reads "No Business OS business"\.\s*void refreshList\(\);\s*\}\}/,
    );
    // Only the three bodies call it: onDeleted, onRemoved, and onCreditsChanged
    // (LF-4b, BD-14: once after a successful Give or Take back).
    expect(occurrences(detail, 'refreshList(')).toBe(3);
  });
});

describe('the account hard delete in the danger area (AU-1 / AU-2; SA AU-C2 … AU-C5)', () => {
  const PANEL_FILE = 'components/business-os/purge/TestAccountCleanupPanel.tsx';
  const PANEL_IMPORT = "import { TestAccountCleanupPanel } from '@/components/business-os/purge/TestAccountCleanupPanel';";

  it('AU-C5: the AD-1 Delete… entry is hidden by a constant that is false, gating both the button and the dialog', () => {
    const page = codeOf(read(DETAIL));
    expect(page.match(/const SHOW_AD1_DELETE_ENTRY = (\w+);/g)).toEqual(['const SHOW_AD1_DELETE_ENTRY = false;']);
    const gate = page.indexOf('{SHOW_AD1_DELETE_ENTRY && (');
    expect(gate).toBeGreaterThan(page.indexOf('data-testid="danger-area"'));
    expect(page.indexOf('data-testid="delete-business-open"')).toBeGreaterThan(gate);
    expect(page.indexOf('<DeleteBusinessDialog')).toBeGreaterThan(gate);
    // Both sit before the gate closes, i.e. before the panel that follows it.
    expect(page.indexOf('<DeleteBusinessDialog')).toBeLessThan(page.indexOf('<TestAccountCleanupPanel'));
  });

  it('AU-C2 / AU-C3: the detail imports the panel only and mounts it once, after danger-area, keyed by the row, only with an email', () => {
    const page = codeOf(read(DETAIL));
    expect(page).toContain(PANEL_IMPORT);
    expect(page).not.toMatch(/cleanupApiTypes/);
    expect(page.match(/<TestAccountCleanupPanel\b/g)).toHaveLength(1);
    const dangerArea = page.indexOf('data-testid="danger-area"');
    expect(dangerArea).toBeGreaterThan(-1);
    const at = page.indexOf('<TestAccountCleanupPanel');
    expect(at).toBeGreaterThan(dangerArea);
    const panel = page.slice(at, page.indexOf('/>', at));
    expect(panel).toMatch(/key=\{user\.id\}/);
    expect(panel).toMatch(/lockedEmail=\{user\.email\}/);
    expect(panel).toMatch(/onRemoved=\{\(\) => \{\s*void refreshList\(\);\s*\}\}/);
    expect(page.slice(dangerArea, at)).toMatch(/\{user\.email \? \(\s*$/);
    // The comment travels with the body, word for word (raw source: codeOf drops comments).
    expect(read(DETAIL)).toMatch(
      /onRemoved=\{\(\) => \{\s*\/\/ AU-C2: CLEAN only, once the admin clicks Done \(or the panel unmounts\); the row leaves the list\.\s*void refreshList\(\);\s*\}\}/,
    );
  });

  it('AU-C4: neither the page, the detail nor the panel names the database function, comments included', () => {
    for (const file of [`${ROOT}/page.tsx`, DETAIL, PANEL_FILE]) {
      // Split so this guard does not itself name the function (R-7: only the repository may).
      expect({ file, hit: read(file).includes('operator_test_' + 'account_cleanup') }).toEqual({ file, hit: false });
    }
  });

  it('AU-C7: the panel has no console.*', () => {
    expect(codeOf(read(PANEL_FILE))).not.toMatch(/console\./);
  });
});

describe('the dialogs use the shared admin class (Admin Layout Standard L-4a; D-8 (a), F-88, F-103)', () => {
  const DIALOG_FILES = [
    `${ROOT}/components/CreditFormDialog.tsx`,
    `${ROOT}/components/DeleteBusinessDialog.tsx`,
    `${ROOT}/components/BoostCapDialog.tsx`,
    // BoostReconcileDialog.tsx moved to app/admin/components/jobs/ReconcileTopUpsDialog.tsx
    // in Admin Layout LF-4c; the Jobs source guard carries these checks for it (SA-W7).
  ];

  /** What keeps a file off the shared dialog class; empty when it is on it. */
  function dialogClassFindings(code: string): string[] {
    const findings: string[] = [];
    const imported = /import\s*\{[^}]*\bADMIN_DIALOG_CLASS\b[^}]*\}\s*from\s*'@\/app\/admin\/components\/layout\/adminDialog'/;
    if (!imported.test(code)) findings.push('no ADMIN_DIALOG_CLASS import from the alias');
    const contents = [...code.matchAll(/<DialogContent\b[^>]*>/g)].map((m) => m[0]);
    if (contents.length === 0) findings.push('no DialogContent');
    for (const tag of contents) {
      if (!/className=\{(?:ADMIN_DIALOG_CLASS|`\$\{ADMIN_DIALOG_CLASS\}[^`]*`)\}/.test(tag)) findings.push(`not on the class: ${tag}`);
    }
    if (/\bDARK_DIALOG\b/.test(code)) findings.push('DARK_DIALOG');
    return findings;
  }

  it('the matcher sees each way off the class (planted samples)', () => {
    const IMPORT = "import { ADMIN_DIALOG_CLASS } from '@/app/admin/components/layout/adminDialog';";
    const TEMPLATE_CLASS = 'className={`${ADMIN_DIALOG_CLASS} sm:!max-w-2xl`}';
    expect(dialogClassFindings(`${IMPORT} <DialogContent data-testid="x" className={ADMIN_DIALOG_CLASS}>`)).toEqual([]);
    expect(dialogClassFindings(`${IMPORT} <DialogContent ${TEMPLATE_CLASS} aria-busy={b}>`)).toEqual([]);
    expect(dialogClassFindings(`${IMPORT} const DARK_DIALOG = 'x'; <DialogContent className={ADMIN_DIALOG_CLASS}>`)).toEqual([
      'DARK_DIALOG',
    ]);
    expect(dialogClassFindings(`${IMPORT} <DialogContent className={DARK}>`)).toHaveLength(1);
    expect(dialogClassFindings('<DialogContent className={ADMIN_DIALOG_CLASS}>')).toEqual([
      'no ADMIN_DIALOG_CLASS import from the alias',
    ]);
    expect(dialogClassFindings(IMPORT)).toEqual(['no DialogContent']);
  });

  it.each(DIALOG_FILES)('%s passes ADMIN_DIALOG_CLASS to DialogContent and declares no DARK_DIALOG', (file) => {
    expect({ file, findings: dialogClassFindings(codeOf(read(file))) }).toEqual({ file, findings: [] });
  });
});

describe('no dead Advanced Filters panel (Admin Layout Standard L-4a; D-11 (a), F-2)', () => {
  // Words only the panel used. Not "Email Verified" or "Auth Provider": the
  // row detail's user card shows "Email Verified:" and "Auth Providers:".
  const PANEL_WORDS = ['Apply Filters', 'showAdvancedFilters', 'Has Agents', 'All Providers', 'Unverified Only', 'Joined Date'];

  it('page.tsx names none of the panel words', () => {
    const page = codeOf(read(`${ROOT}/page.tsx`));
    expect(PANEL_WORDS.filter((word) => page.includes(word))).toEqual([]);
  });
});
