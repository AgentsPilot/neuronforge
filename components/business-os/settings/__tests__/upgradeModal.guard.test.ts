/**
 * @jest-environment node
 *
 * Source guards for the plan comparison modal (upgrade modal UM-1a, workplan
 * §9.3 (a)–(f), §9.4 (g)–(k)). Each pin has a planted-violation self-test below,
 * as `planPrefetch.guard` does, so a guard that silently stopped matching fails.
 *
 *   (a) C-1 / C-12  the modal imports no island and no Stripe
 *   (b) C-3         the modal and its view take no read
 *   (c) C-2         the flow's state and success predicate live only in usePlanFlow.ts
 *   (d) C-6         no import from lib/business-os/entitlements in the new files
 *   (e) rule 3      no console in the new files
 *   (f) C-8 / C-9 / W-5  no hex / red / white bg / dark: in the modal; the drawer
 *                   button's label on solid --v2-primary-dark; no second base max-w
 *   (g) C-21 / W-9  no capability id and no config row label, as a quoted literal
 *   (h) C-21        the view never sorts, filters or reverses the server's table
 *   (i) C-23        no upgrade_modal.* value reads as a claim about what a plan lacks
 *   (j) C-22        "Current plan" is a span, never a button
 *   (k) C-27        the two-column phone assumption names its tripwire
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { CAPABILITY_IDS } from '@/lib/business-os/entitlements/config/catalog';
import { PLAN_COMPARISON_ROWS } from '@/lib/business-os/entitlements/config/planComparison';

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const DIR = 'components/business-os/settings';
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8');
/** Without comments, so a guard pins code, not prose about it. */
const code = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? '' : line.replace(/\s\/\/\s.*$/, '')))
    .join('\n');

const MODAL = `${DIR}/UpgradeModal.tsx`;
const VIEW = `${DIR}/upgradeModalView.ts`;
const TYPES = `${DIR}/planPayloadTypes.ts`;
const FLOW = `${DIR}/usePlanFlow.ts`;
const TEXT = `${DIR}/planText.tsx`;
const SECTION = `${DIR}/PlanSection.tsx`;
const NEW_FILES = [TYPES, TEXT, FLOW, VIEW, MODAL];

// ── the pins, as functions so the self-tests can feed them a planted source ──

function pinA(modal: string) {
  for (const name of ['PlanPurchase', 'PlanUpgrade', 'PlanEmbeddedCheckout', 'stripeJs', '@stripe/']) {
    expect(modal).not.toMatch(new RegExp(`from\\s+'[^']*${name}`));
  }
}

function pinB(source: string) {
  expect(source).not.toMatch(/readMyPlan|planDrawerReads|\bfetch\(|my-plan/);
}

/** (c) Each flow marker, across the settings product files, only in usePlanFlow.ts. */
const FLOW_MARKERS = ["billing?.state === 'renewing'", 'PROCESSING_REFRESH_LIMIT', 'setUpgradeWatching(', 'setCompletedSession('];
function pinC(sources: Record<string, string>) {
  for (const marker of FLOW_MARKERS) {
    const holders = Object.entries(sources)
      .filter(([, text]) => text.includes(marker))
      .map(([file]) => file);
    expect({ marker, holders }).toEqual({ marker, holders: [FLOW] });
  }
}

function pinD(source: string) {
  expect(source).not.toMatch(/from\s+'[^']*lib\/business-os\/entitlements/);
}

function pinE(source: string) {
  expect(source).not.toMatch(/console\./);
}

function pinF(modal: string, section: string) {
  expect(modal).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(modal).not.toMatch(/text-red-|bg-white|\bdark:/);
  // C-8: one width, `sm:` prefixed; dialog.tsx's own base max-w-lg is the only un-prefixed one.
  expect(modal).toContain('sm:max-w-4xl');
  expect(modal).not.toMatch(/["`\s]max-w-(?!\[12rem\])/);
  // W-5: the drawer button's label on SOLID --v2-primary-dark; the gradient is an aria-hidden layer.
  const start = section.indexOf('data-testid="plan-compare-open"');
  expect(start).toBeGreaterThan(-1);
  const button = section.slice(section.lastIndexOf('<button', start), section.indexOf('</button>', start));
  expect(button).toContain('bg-[var(--v2-primary-dark)]');
  expect(button).toContain('text-white');
  const gradient = button.match(/<span[^>]*bg-gradient-to[^>]*>/g) ?? [];
  expect(gradient.length).toBeGreaterThan(0);
  for (const layer of gradient) expect(layer).toContain('aria-hidden="true"');
}

/** (g) W-9: as QUOTED literals only, so "CRM" or "Emails" cannot false-positive on prose or an identifier. */
const ROW_LABELS = PLAN_COMPARISON_ROWS.flatMap((row) => Object.values(row.labels).filter((label): label is string => typeof label === 'string'));
const quoted = (value: string) => new RegExp(`['"\`]${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"\`]`);
function pinG(source: string) {
  for (const id of CAPABILITY_IDS) expect({ id, found: quoted(id).test(source) }).toEqual({ id, found: false });
  for (const label of ROW_LABELS) expect({ label, found: quoted(label).test(source) }).toEqual({ label, found: false });
}

function pinH(view: string) {
  expect(view).not.toMatch(/\.(sort|filter|reverse|splice)\(/);
  // Identity: the server's array is what is returned.
  expect(view).toContain('sections: comparison.sections');
}

/** (i) The `noExclusions` phrasing, as `planCopy.i18n.test.ts` applies it to `plan.*`. */
const exclusionPhrasing = new RegExp(
  [
    String.raw`your plan (does not|doesn't|will not|won't) (include|cover|have)`,
    String.raw`your plan excludes`,
    String.raw`\byou (do not|don't) (have|get)\b`,
    String.raw`\byou lack\b`,
    String.raw`not (included|available) (in|on) your`,
    String.raw`missing from your (plan|account)`,
  ].join('|'),
  'i'
);
function pinI(dictionaries: Record<string, Record<string, string>>) {
  const offenders = Object.entries(dictionaries).flatMap(([language, dictionary]) =>
    Object.entries(dictionary)
      .filter(([key, value]) => key.startsWith('upgrade_modal.') && exclusionPhrasing.test(value))
      .map(([key, value]) => `${language} ${key}: ${value}`)
  );
  expect(offenders).toEqual([]);
}

function pinJ(modal: string) {
  const at = modal.indexOf('data-testid="plan-compare-current-label"');
  expect(at).toBeGreaterThan(-1);
  const open = modal.slice(modal.lastIndexOf('<', at), at);
  expect(open.trim()).toBe('<span');
  const element = modal.slice(at, modal.indexOf('>', at));
  expect(element).not.toMatch(/role=|tabIndex|aria-disabled/);
}

const TRIPWIRE = `${DIR}/__tests__/planComparison.twoPlans.tripwire.test.ts`;
function pinK(modalWithComments: string) {
  expect(modalWithComments).toContain("const PHONE_ROW = 'max-sm:grid max-sm:grid-cols-2';");
  expect(modalWithComments).toContain(TRIPWIRE);
  // Every row uses the one constant, so the assumption has one place to change.
  expect(code(modalWithComments).match(/max-sm:grid-cols-2/g) ?? []).toHaveLength(1);
}

// ── the guards ──

const settingsProductFiles = () =>
  readdirSync(join(process.cwd(), DIR))
    .filter((entry) => /\.(ts|tsx)$/.test(entry))
    .map((entry) => `${DIR}/${entry}`);

const { translations } = jest.requireActual('@/lib/business-os/LanguageContext') as {
  translations: Record<string, Record<string, string>>;
};

describe('upgrade modal source guards', () => {
  it('(a) C-1 / C-12: the modal imports no island and no Stripe', () => pinA(code(read(MODAL))));
  it.each([MODAL, VIEW])('(b) C-3: %s takes no read', (file) => pinB(code(read(file))));
  it('(c) C-2: the flow state and the success predicate live only in usePlanFlow.ts', () => {
    pinC(Object.fromEntries(settingsProductFiles().map((file) => [file, code(read(file))])));
  });
  it.each(NEW_FILES)('(d) C-6: %s imports nothing from the entitlements module', (file) => pinD(code(read(file))));
  it.each(NEW_FILES)('(e) %s writes no console call', (file) => pinE(code(read(file))));
  it('(f) C-8 / C-9 / W-5: tokens only, one sm: width, the drawer button label on solid primary-dark', () => {
    pinF(code(read(MODAL)), code(read(SECTION)));
  });
  it.each([MODAL, VIEW, TYPES])('(g) C-21: %s names no capability id and no config row label', (file) => pinG(code(read(file))));
  it('(h) C-21: the view never re-orders or drops the server table', () => pinH(code(read(VIEW))));
  it('(i) C-23: no upgrade_modal.* value, in any language, claims what a plan lacks', () => {
    // Non-vacuity: the keys exist in every dictionary.
    for (const language of ['en', 'he', 'es']) expect(translations[language]['upgrade_modal.not_included']).toBeTruthy();
    pinI({ en: translations.en, he: translations.he, es: translations.es });
  });
  it('(j) C-22: "Current plan" is a span with no role, tabIndex or aria-disabled', () => pinJ(code(read(MODAL))));
  it('(k) C-27: the two-column phone layout names its tripwire, which exists', () => {
    pinK(read(MODAL));
    expect(existsSync(join(process.cwd(), TRIPWIRE))).toBe(true);
  });
});

describe('negative controls: each pin fails on the violation it exists for', () => {
  const modal = code(read(MODAL));
  const view = code(read(VIEW));
  const section = code(read(SECTION));

  it('(a) an island import', () => {
    expect(() => pinA(`${modal}\nimport { PlanPurchase } from './PlanPurchase';`)).toThrow();
    expect(() => pinA(`${modal}\nimport { getStripePromise } from '@/lib/client/stripeJs';`)).toThrow();
  });
  it('(b) a read', () => {
    expect(() => pinB(`${view}\nvoid fetch('/api/business-os/entitlements/my-plan');`)).toThrow();
    expect(() => pinB(`${modal}\nimport { readMyPlan } from './planDrawerReads';`)).toThrow();
  });
  it('(c) a second copy of the success predicate', () => {
    const sources = Object.fromEntries(settingsProductFiles().map((file) => [file, code(read(file))]));
    expect(() => pinC({ ...sources, [MODAL]: `${modal}\nconst ok = plan.purchase?.billing?.state === 'renewing';` })).toThrow();
  });
  it('(d) an entitlements import, type-only included', () => {
    expect(() => pinD(`import type { CapabilityId } from '@/lib/business-os/entitlements/config/catalog';`)).toThrow();
  });
  it('(e) a console call', () => expect(() => pinE('console.log(plan);')).toThrow());
  it('(f) a hex colour, a dark: override, a base max-w, a gradient behind the drawer label', () => {
    expect(() => pinF(`${modal}\nconst c = '#4F46E5';`, section)).toThrow();
    expect(() => pinF(`${modal}\nconst c = 'dark:bg-slate-900';`, section)).toThrow();
    expect(() => pinF(modal.replace('sm:max-w-4xl', 'sm:max-w-4xl max-w-4xl'), section)).toThrow();
    expect(() => pinF(modal, section.replace('bg-[var(--v2-primary-dark)] rounded', 'bg-gradient-to-r rounded'))).toThrow();
  });
  it('(g) a capability id or a row label as a literal', () => {
    expect(() => pinG(`${view}\nconst x = '${CAPABILITY_IDS[0]}';`)).toThrow();
    expect(() => pinG(`${modal}\nconst x = "${ROW_LABELS[0]}";`)).toThrow();
    // W-9: the bare word in an identifier does not count.
    expect(() => pinG(`${modal}\nconst CRMish = 1;`)).not.toThrow();
  });
  it('(h) a sort, a filter or a rebuilt sections array', () => {
    expect(() => pinH(`${view}\nconst s = comparison.sections.filter(Boolean);`)).toThrow();
    expect(() => pinH(`${view}\nrows.sort();`)).toThrow();
    expect(() => pinH(view.replace('sections: comparison.sections', 'sections: [...comparison.sections]'))).toThrow();
  });
  it('(i) an exclusion sentence', () => {
    expect(() => pinI({ en: { 'upgrade_modal.x': 'This is not included in your plan.' } })).toThrow();
  });
  it('(j) a button for "Current plan"', () => {
    expect(() => pinJ(modal.replace('<span\n        data-testid="plan-compare-current-label"', '<button\n        data-testid="plan-compare-current-label"'))).toThrow();
    expect(() => pinJ(modal.replace('data-testid="plan-compare-current-label"', 'data-testid="plan-compare-current-label" tabIndex={0}'))).toThrow();
  });
  it('(k) a second hard-coded two-column class, or the tripwire pointer gone', () => {
    const raw = read(MODAL);
    expect(() => pinK(`${raw}\nconst other = 'max-sm:grid-cols-2';`)).toThrow();
    expect(() => pinK(raw.split(TRIPWIRE).join('somewhere'))).toThrow();
  });
});
