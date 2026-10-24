/**
 * @jest-environment node
 *
 * Source guards for the plan comparison modal (upgrade modal UM-1a, workplan
 * §9.3 (a)–(f), §9.4 (g)–(k)). Each pin has a planted-violation self-test below,
 * as `planPrefetch.guard` does, so a guard that silently stopped matching fails.
 *
 *   (a) C-12        UM-1b: the islands are imported by the modal ONLY, never by
 *                   PlanSection; the modal imports no Stripe itself
 *   (b) C-3         the modal and its view take no read
 *   (c) C-2         the flow's state and success predicate live only in usePlanFlow.ts
 *   (d) C-6         no import from lib/business-os/entitlements in the new files
 *   (e) rule 3      no console in the new files
 *   (f) C-8 / LF-1  no hex / red / white bg / dark: / gradient / --v2-primary-dark in
 *                   the modal; the drawer button is the app's primary button
 *                   (`bg-[var(--v2-primary)] text-white`, no gradient); no second base max-w
 *   (g) C-21 / W-9  no capability id and no config row label, as a quoted literal
 *   (h) C-21        the view never sorts, filters or reverses the server's table
 *   (i) C-23        no upgrade_modal.* value reads as a claim about what a plan lacks
 *   (j) C-22        "Current plan" is a span, never a button
 *   (k) C-27        the phone grid (two or three columns, LF-2) names its tripwire
 *   (l) SA Q-2      `autoStart` is passed only by PlanPurchase (never the holding
 *                   screen or the harness)
 *   (m) C-13        no `text-red-` in PlanPurchase / PlanUpgrade; PlanEmbeddedCheckout
 *                   keeps its own (it also renders outside the theme provider)
 *   (n) UM-FR11     the busy gate: the owner's close is refused while busy, Escape and
 *                   outside presses are prevented behind the same flag; the hand-off
 *                   close (SA W-2) does not consult it
 *   (o) UM-1a Q-6   the interim view-only note is gone from every dictionary and file
 *   (p) UM-SA8 / X-7  UM-2: `readMyPlan` is called only by the reads module, the flow,
 *                   PlanSection, the standalone window and the demo; never the provider
 *   (q) C-4         UM-2: the provider, the window and the context use no URL, no
 *                   window event, no message channel
 *   (r) C-4         UM-2: the context union is exactly the three members
 *   (s) UM-SA2      UM-2: PlanSection registers as the inline host AFTER the
 *                   `[language]` effect (alongside P-G8)
 *   (t) LF-1        (replaces UM-3 U3-a, which required the darker shade the live theme
 *                   never sets): no --v2-primary-dark in the modal, the islands or the
 *                   drawer, and every white-text class string in the modal and the islands
 *                   is the app's primary button (`bg-[var(--v2-primary)]`)
 *   (u) A-4         UM-3 U3-b: no `--v2-text-muted` text in the modal or the islands (Y-4)
 *   (v) §6 / UM-FR10  UM-3 U3-c: no upgrade_modal.* value, in any language, carries a
 *                   digit, a currency sign, or an urgency / social-proof / "cancel
 *                   anytime" phrase; whole words, `{…}` slots stripped first (Y-6)
 *   (w) UM-D3       the Settings decision is `planSurfaceFor` (the view's `hasActions`, no
 *                   other offer test), taken by `usePlanSurface`; the Settings pop-up
 *                   registers as the inline host (D3-1, D3-10)
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';

import { CAPABILITY_IDS } from '@/lib/business-os/entitlements/config/catalog';
import { PLAN_COMPARISON_ROWS } from '@/lib/business-os/entitlements/config/planComparison';

jest.mock('@/lib/supabaseClient', () => ({ supabase: {} }));

const DIR = 'components/business-os/settings';
// Line endings normalised: a Windows checkout (core.autocrlf) must not hide a '\n' pattern (jest flake note).
const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n');
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
const PURCHASE = `${DIR}/PlanPurchase.tsx`;
const UPGRADE = `${DIR}/PlanUpgrade.tsx`;
const EMBEDDED = 'components/business-os/billing/PlanEmbeddedCheckout.tsx';
const HOLDING = 'app/invite/awaiting-payment/HeldPaymentCheckout.tsx';
const HARNESS = 'components/test-business-os/PlanCheckoutPanel.tsx';
const CONTEXT = `${DIR}/upgradeModalContext.ts`;
const PROVIDER = `${DIR}/UpgradeModalProvider.tsx`;
const STANDALONE = `${DIR}/StandaloneUpgradeModal.tsx`;
const STATUS = `${DIR}/PlanFlowStatus.tsx`;
const DEMO_PAGE = 'app/business-os/upgrade-modal-demo/page.tsx';
const DEMO = 'app/business-os/upgrade-modal-demo/UpgradeModalDemo.tsx';
// UM-D3: the session moved out of the lazily loaded window; the Settings pop-up and its decider.
const SESSION = `${DIR}/UpgradeSession.tsx`;
const SETTINGS_MODAL = `${DIR}/SettingsPlanModal.tsx`;
const SURFACE = `${DIR}/usePlanSurface.ts`;
// UM-2: the contract, the window, the moved status lines and the demo (C-6, rule 3, C-21). UM-D3: + 3.
const NEW_FILES = [TYPES, TEXT, FLOW, VIEW, MODAL, CONTEXT, PROVIDER, STANDALONE, STATUS, DEMO_PAGE, DEMO, SESSION, SETTINGS_MODAL, SURFACE];

// ── the pins, as functions so the self-tests can feed them a planted source ──

/** (a) UM-1b, inverted from UM-1a: the islands only in the modal (C-12), no Stripe import in the modal itself. */
function pinA(modal: string, section: string) {
  for (const name of ['PlanEmbeddedCheckout', 'stripeJs', '@stripe/']) {
    expect(modal).not.toMatch(new RegExp(`from\\s+'[^']*${name}`));
  }
  for (const island of ['PlanPurchase', 'PlanUpgrade']) {
    expect(modal).toMatch(new RegExp(`from\\s+'\\./${island}'`));
    expect(section).not.toMatch(new RegExp(`from\\s+'[^']*${island}'`));
    expect(section).not.toMatch(new RegExp(`<${island}\\b`));
  }
}

function pinB(source: string) {
  expect(source).not.toMatch(/readMyPlan|planDrawerReads|\bfetch\(|my-plan/);
}

/** (c) Each flow marker, across the settings product files, only in usePlanFlow.ts. */
const FLOW_MARKERS = [
  "billing?.state === 'renewing'",
  'PROCESSING_REFRESH_LIMIT',
  'setUpgradeWatching(',
  'setCompletedSession(',
  // UM-1b §8.3 / SA W-3: the start gates and the key check, defined once.
  'const checkoutAllowed =',
  'const upgradeAllowed =',
  'const paymentsConfigured =',
  '!upgradeWatching && !upgradeSucceeded',
];
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
  // LF-1 (live test 2026-10-20): the admin theme rewrites --v2-primary / --v2-secondary only,
  // so the darker shade and the gradient painted indigo-to-orange with white words on it.
  expect(modal).not.toMatch(/primary-dark|gradient/);
  // The drawer button is the app's own primary button (was W-5: solid primary-dark + a gradient layer).
  const start = section.indexOf('data-testid="plan-compare-open"');
  expect(start).toBeGreaterThan(-1);
  const button = section.slice(section.lastIndexOf('<button', start), section.indexOf('</button>', start));
  expect(button).toContain('bg-[var(--v2-primary)]');
  expect(button).toContain('text-white');
  expect(button).not.toMatch(/primary-dark|gradient/);
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
  // LF-2: two columns, or three when the account's own plan leads (C-27, raised with the tripwire).
  expect(modalWithComments).toContain("const PHONE_ROW: Record<2 | 3, string> = {");
  expect(modalWithComments).toContain("2: 'max-sm:grid max-sm:grid-cols-2',");
  expect(modalWithComments).toContain("3: 'max-sm:grid max-sm:grid-cols-3',");
  expect(modalWithComments).toContain(TRIPWIRE);
  // Every row uses the one constant, so the assumption has one place to change.
  for (const columns of [2, 3]) {
    expect(code(modalWithComments).match(new RegExp(`max-sm:grid-cols-${columns}\\b`, 'g')) ?? []).toHaveLength(1);
  }
  expect(code(modalWithComments)).not.toMatch(/max-sm:grid-cols-[4-9]/);
}

function pinL(sources: Record<string, string>) {
  const passers = Object.entries(sources)
    .filter(([, text]) => /\bautoStart=/.test(text))
    .map(([file]) => file);
  expect(passers).toEqual([PURCHASE]);
}

function pinM(purchase: string, upgrade: string, embedded: string) {
  expect(purchase).not.toMatch(/text-red-/);
  expect(upgrade).not.toMatch(/text-red-/);
  expect(purchase).toContain('text-[var(--v2-error-text)]');
  expect(upgrade).toContain('text-[var(--v2-error-text)]');
  // C-13: PlanEmbeddedCheckout untouched in colour.
  expect(embedded).toContain('text-red-700');
}

function pinN(modal: string) {
  expect(modal).toMatch(/const requestOpenChange = \(next: boolean\) => \{\s*if \(!next && busy\) return;/);
  expect(modal).toMatch(/onEscapeKeyDown=\{\(event\) => \{\s*if \(busy\) event\.preventDefault\(\);/);
  expect(modal).toMatch(/onInteractOutside=\{\(event\) => \{[\s\S]*?if \(busy \|\| frameOpen\) event\.preventDefault\(\);/);
  expect(modal).toContain('<Dialog open={open} onOpenChange={requestOpenChange}>');
  // W-2: the hand-off close does not go through the gate.
  const handOff = modal.slice(modal.indexOf('const handOff = () => {'), modal.indexOf('};', modal.indexOf('const handOff = () => {')));
  expect(handOff).toContain('onOpenChange(false)');
  expect(handOff).not.toMatch(/busy/);
}

function pinO(sources: Record<string, string>, dictionaries: Record<string, Record<string, string>>) {
  for (const [file, text] of Object.entries(sources)) expect({ file, found: text.includes('view_only_note') }).toEqual({ file, found: false });
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    expect({ language, found: 'upgrade_modal.view_only_note' in dictionary }).toEqual({ language, found: false });
  }
}

/** (p) UM-SA8 / X-7: who may call the read. */
// UM-D3: STANDALONE → SESSION (the read moved with the session, unchanged).
const READ_CALLERS = [`${DIR}/planDrawerReads.ts`, FLOW, SECTION, SESSION, DEMO];
function pinP(sources: Record<string, string>) {
  const callers = Object.entries(sources)
    .filter(([, text]) => /\breadMyPlan\(/.test(text))
    .map(([file]) => file)
    .sort();
  expect(callers).toEqual([...READ_CALLERS].sort());
  expect(sources[PROVIDER] ?? '').not.toMatch(/readMyPlan|planDrawerReads|\bfetch\(/);
}

/** (q) C-4: no URL parameter, no window event, no message channel. */
function pinQ(source: string) {
  expect(source).not.toMatch(/useSearchParams|window\.location|addEventListener|CustomEvent|dispatchEvent|postMessage/);
}

/** (r) C-4: exactly the three members, no other field. */
function pinR(context: string) {
  const union = context.slice(context.indexOf('export type UpgradeModalContext ='), context.indexOf('export const SETTINGS_CONTEXT'));
  const members = union.match(/\{[^}]*\}/g) ?? [];
  expect(members.map((member) => member.replace(/\s+/g, ' ').trim())).toEqual([
    "{ kind: 'settings' }",
    "{ kind: 'locked_feature'; planId: string }",
    "{ kind: 'founding_partner' }",
  ]);
}

/** (s) UM-SA2: the inline host is registered after the `[language]` effect. */
function pinS(section: string) {
  const languageEnd = section.indexOf('}, [language]);');
  const host = section.indexOf('useUpgradeModalInlineHost();');
  expect(languageEnd).toBeGreaterThan(-1);
  expect(host).toBeGreaterThan(languageEnd);
  expect(section.match(/useUpgradeModalInlineHost\(\);/g) ?? []).toHaveLength(1);
}

/**
 * (t) LF-1: no darker shade anywhere, and every quoted class string (template
 * literals included) that sets white text is the app's primary (`bg-[var(--v2-primary)]`).
 */
const ON_PRIMARY = /bg-\[var\(--v2-primary\)\]/;
function pinT(sources: Record<string, string>) {
  const offenders = Object.entries(sources).flatMap(([file, text]) => [
    ...(text.includes('primary-dark') ? [`${file}: --v2-primary-dark`] : []),
    ...(text.match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? [])
      .filter((literal) => literal.includes('text-white') && !ON_PRIMARY.test(literal))
      .map((literal) => `${file}: ${literal}`),
  ]);
  expect(offenders).toEqual([]);
}

/** (u) U3-b. */
function pinU(sources: Record<string, string>) {
  for (const [file, text] of Object.entries(sources)) expect({ file, muted: text.includes('text-[var(--v2-text-muted)]') }).toEqual({ file, muted: false });
}

/**
 * (v) U3-c. Whole words and phrases (Y-6): a letter on either side means it is
 * part of another word. Hebrew and Spanish equivalents beside the English.
 */
const PRESSURE_PHRASES = [
  'limited', 'limited time', 'only today', 'today only', 'hurry', 'last chance', 'ends soon', 'countdown',
  'popular', 'most popular', 'businesses already', 'join thousands', 'cancel anytime', 'cancel any time',
  'מוגבל', 'לזמן מוגבל', 'רק היום', 'מהרו', 'הזדמנות אחרונה', 'פופולרי', 'בטלו בכל עת', 'ביטול בכל עת',
  'limitado', 'tiempo limitado', 'solo hoy', 'date prisa', 'última oportunidad', 'más popular', 'cancela cuando quieras', 'cancela en cualquier momento',
];
const escapeRe = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PRESSURE = new RegExp(`(?<!\\p{L})(?:${PRESSURE_PHRASES.map(escapeRe).join('|')})(?!\\p{L})`, 'iu');
function pinV(dictionaries: Record<string, Record<string, string>>) {
  const offenders = Object.entries(dictionaries).flatMap(([language, dictionary]) =>
    Object.entries(dictionary)
      .filter(([key]) => key.startsWith('upgrade_modal.'))
      .filter(([, value]) => {
        const text = value.replace(/\{[^}]*\}/g, '');
        return /\d/.test(text) || /[$€£₪¥]/.test(text) || PRESSURE.test(text);
      })
      .map(([key, value]) => `${language} ${key}: ${value}`)
  );
  expect(offenders).toEqual([]);
}

/** (w) UM-D3 D3-1 / D3-10. */
function pinW(view: string, surface: string, settingsModal: string) {
  const start = view.indexOf('export function planSurfaceFor(');
  expect(start).toBeGreaterThan(-1);
  const body = view.slice(start, view.indexOf('\n}', start));
  // The offer predicate is the view's own; nothing else in the body judges an offer.
  expect(body).toContain('view.available && view.hasActions');
  expect(body).not.toMatch(/purchase|offer|tiers|planId|kind ===|endsFreeAccess/);
  expect(surface).toMatch(/planSurfaceFor\(plan, false\)/);
  expect(surface).not.toMatch(/hasActions|purchase\.|\.tiers/);
  expect(settingsModal).toContain('useUpgradeModalInlineHost();');
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
  it('(a) C-12: the islands are imported by the modal only, never by PlanSection; no Stripe in the modal', () => pinA(code(read(MODAL)), code(read(SECTION))));
  it.each([MODAL, VIEW])('(b) C-3: %s takes no read', (file) => pinB(code(read(file))));
  it('(c) C-2: the flow state and the success predicate live only in usePlanFlow.ts', () => {
    pinC(Object.fromEntries(settingsProductFiles().map((file) => [file, code(read(file))])));
  });
  it.each(NEW_FILES)('(d) C-6: %s imports nothing from the entitlements module', (file) => pinD(code(read(file))));
  it.each(NEW_FILES)('(e) %s writes no console call', (file) => pinE(code(read(file))));
  it('(f) C-8 / LF-1: tokens only, one sm: width, no darker shade or gradient, the drawer button is the app primary', () => {
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
  it('(k) C-27 / LF-2: the two- or three-column phone grid names its tripwire, which exists', () => {
    pinK(read(MODAL));
    expect(existsSync(join(process.cwd(), TRIPWIRE))).toBe(true);
  });
  it('(l) SA Q-2: autoStart is passed only by PlanPurchase', () => {
    pinL(Object.fromEntries([...settingsProductFiles(), HOLDING, HARNESS].map((file) => [file, code(read(file))])));
  });
  it('(m) C-13: the islands use --v2-error-text; PlanEmbeddedCheckout keeps its own colour', () => {
    pinM(code(read(PURCHASE)), code(read(UPGRADE)), code(read(EMBEDDED)));
  });
  it('(n) UM-FR11 / W-2: the busy gate exists, and the hand-off close bypasses it', () => pinN(code(read(MODAL))));
  it('(o) UM-1a Q-6: the view-only note is gone', () => {
    pinO(Object.fromEntries(settingsProductFiles().map((file) => [file, code(read(file))])), { en: translations.en, he: translations.he, es: translations.es });
  });
  it('(p) UM-SA8 / X-7: readMyPlan is called only by its allowed callers, never the provider', () => {
    pinP(Object.fromEntries([...settingsProductFiles(), DEMO, DEMO_PAGE].map((file) => [file, code(read(file))])));
  });
  it.each([PROVIDER, STANDALONE, CONTEXT, SESSION, SETTINGS_MODAL, SURFACE])('(q) C-4: %s reads no URL and uses no window event', (file) => pinQ(code(read(file))));
  it('(r) C-4: the context is exactly the three-member union', () => pinR(code(read(CONTEXT))));
  it('(s) UM-SA2: PlanSection registers as the inline host after the [language] effect', () => pinS(code(read(SECTION))));
  it('(t) LF-1: no --v2-primary-dark in the modal, the islands or the drawer; white text only on the app primary', () => {
    // Non-vacuity: the islands' button constants are the app's primary button.
    expect(code(read(UPGRADE))).toContain("const PRIMARY_BUTTON = 'rounded bg-[var(--v2-primary)]");
    expect(code(read(PURCHASE))).toContain("'rounded bg-[var(--v2-primary)]");
    pinT(Object.fromEntries([MODAL, PURCHASE, UPGRADE, SECTION].map((file) => [file, code(read(file))])));
  });
  it('(u) UM-3 U3-b: no muted text in the modal or the islands', () => {
    pinU(Object.fromEntries([MODAL, PURCHASE, UPGRADE].map((file) => [file, code(read(file))])));
  });
  it('(v) UM-3 U3-c: no figure, currency sign or pressure phrase in any upgrade_modal.* value', () => {
    for (const language of ['en', 'he', 'es']) expect(translations[language]['upgrade_modal.subheading.upgrade']).toBeTruthy();
    pinV({ en: translations.en, he: translations.he, es: translations.es });
  });
  it('(w) UM-D3: the Settings surface is chosen by planSurfaceFor alone, and the pop-up hosts inline', () => {
    pinW(code(read(VIEW)), code(read(SURFACE)), code(read(SETTINGS_MODAL)));
  });
});

describe('negative controls: each pin fails on the violation it exists for', () => {
  const modal = code(read(MODAL));
  const view = code(read(VIEW));
  const section = code(read(SECTION));

  it('(a) an island in the drawer, or Stripe in the modal', () => {
    expect(() => pinA(modal, `${section}\nimport { PlanPurchase } from './PlanPurchase';`)).toThrow();
    expect(() => pinA(modal, `${section}\n<PlanUpgrade plans={[]} />`)).toThrow();
    expect(() => pinA(`${modal}\nimport { getStripePromise } from '@/lib/client/stripeJs';`, section)).toThrow();
    expect(() => pinA(modal.replace("from './PlanUpgrade'", "from './elsewhere'"), section)).toThrow();
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
    expect(() => pinF(modal, section.replace('text-white bg-[var(--v2-primary)]', 'text-white bg-[var(--v2-primary-dark)]'))).toThrow();
    expect(() => pinF(modal, section.replace('text-white bg-[var(--v2-primary)]', 'text-white bg-gradient-to-r'))).toThrow();
    expect(() => pinF(`${modal}\nconst band = 'bg-gradient-to-r to-[var(--v2-secondary)]';`, section)).toThrow();
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
  it('(l) autoStart passed by another caller', () => {
    expect(() => pinL({ [PURCHASE]: 'autoStart={x}', [HOLDING]: '<PlanEmbeddedCheckout autoStart={true} />' })).toThrow();
  });
  it('(m) a red line back in an island, or PlanEmbeddedCheckout recoloured', () => {
    const purchase = code(read(PURCHASE));
    const upgrade = code(read(UPGRADE));
    const embedded = code(read(EMBEDDED));
    expect(() => pinM(`${purchase}\nconst c = 'text-red-700';`, upgrade, embedded)).toThrow();
    expect(() => pinM(purchase, upgrade, embedded.replace('text-red-700', 'text-[var(--v2-error-text)]'))).toThrow();
  });
  it('(n) a gate that lets a busy close through, or a hand-off that consults it', () => {
    expect(() => pinN(modal.replace('if (!next && busy) return;', ''))).toThrow();
    expect(() => pinN(modal.replace('if (busy) event.preventDefault();', ''))).toThrow();
    expect(() => pinN(modal.replace('const handOff = () => {', 'const handOff = () => {\n    if (busy) return;'))).toThrow();
  });
  it('(o) the view-only note back', () => {
    expect(() => pinO({ [MODAL]: "t('upgrade_modal.view_only_note')" }, {})).toThrow();
    expect(() => pinO({}, { en: { 'upgrade_modal.view_only_note': 'x' } })).toThrow();
  });
  it('(p) a read in the provider, or a new caller', () => {
    const sources = Object.fromEntries([...settingsProductFiles(), DEMO, DEMO_PAGE].map((file) => [file, code(read(file))]));
    expect(() => pinP({ ...sources, [PROVIDER]: `${sources[PROVIDER]}\nvoid readMyPlan();` })).toThrow();
    expect(() => pinP({ ...sources, [MODAL]: `${sources[MODAL]}\nvoid readMyPlan();` })).toThrow();
  });
  it('(q) a URL read or a window event', () => {
    expect(() => pinQ("const p = useSearchParams();")).toThrow();
    expect(() => pinQ("window.dispatchEvent(new CustomEvent('open-upgrade'));")).toThrow();
    expect(() => pinQ("window.addEventListener('message', f);")).toThrow();
  });
  it('(r) a fourth member, or a field a caller could fill', () => {
    const context = code(read(CONTEXT));
    expect(() => pinR(context.replace("| { kind: 'founding_partner' }", "| { kind: 'founding_partner' }\n  | { kind: 'other' }"))).toThrow();
    expect(() => pinR(context.replace("{ kind: 'locked_feature'; planId: string }", "{ kind: 'locked_feature'; planId: string; name: string }"))).toThrow();
  });
  it('(s) the host registered before the [language] effect, or twice', () => {
    const section = code(read(SECTION));
    const moved = section.replace('useUpgradeModalInlineHost();', '').replace('const firstStarted = useRef(false);', 'useUpgradeModalInlineHost();\n  const firstStarted = useRef(false);');
    expect(() => pinS(moved)).toThrow();
    expect(() => pinS(`${section}\nuseUpgradeModalInlineHost();`)).toThrow();
  });

  it('(t) the darker shade back, or white words on anything but the app primary', () => {
    const upgrade = code(read(UPGRADE));
    expect(() => pinT({ [UPGRADE]: upgrade.replace('bg-[var(--v2-primary)] px-3', 'bg-[var(--v2-primary-dark)] px-3') })).toThrow();
    expect(() => pinT({ [MODAL]: `${modal}\n<span className={'px-2 text-white bg-[var(--v2-secondary)]'} />` })).toThrow();
    expect(() => pinT({ [MODAL]: `${modal}\nconst band = 'text-white';` })).toThrow();
    // The app's own primary button is not a violation.
    expect(() => pinT({ [MODAL]: "const ok = 'text-white bg-[var(--v2-primary)]';" })).not.toThrow();
  });
  it('(u) a muted line back', () => {
    expect(() => pinU({ [MODAL]: `${modal}\nconst c = 'text-xs text-[var(--v2-text-muted)]';` })).toThrow();
  });
  it('(v) "Limited time", a dollar value, a digit, or a Hebrew pressure word; a slot and a longer word pass', () => {
    expect(() => pinV({ en: { 'upgrade_modal.x': 'Limited time offer' } })).toThrow();
    expect(() => pinV({ en: { 'upgrade_modal.x': 'Only $79' } })).toThrow();
    expect(() => pinV({ en: { 'upgrade_modal.x': 'Save 20 percent' } })).toThrow();
    expect(() => pinV({ he: { 'upgrade_modal.x': 'מבצע לזמן מוגבל' } })).toThrow();
    expect(() => pinV({ es: { 'upgrade_modal.x': 'Cancela cuando quieras' } })).toThrow();
    expect(() => pinV({ en: { 'upgrade_modal.x': 'See what {plan} includes' } })).not.toThrow();
    expect(() => pinV({ en: { 'upgrade_modal.x': 'Unlimited contacts' } })).not.toThrow();
    // Outside upgrade_modal.* it does not apply.
    expect(() => pinV({ en: { 'plan.x': 'Only $79' } })).not.toThrow();
  });
  it('(w) a second offer test in the decision, or the host gone', () => {
    const viewSource = code(read(VIEW));
    const surface = code(read(SURFACE));
    const settingsModal = code(read(SETTINGS_MODAL));
    expect(() => pinW(viewSource.replace('view.available && view.hasActions', "view.available && answer.purchase?.offer.kind === 'choose'"), surface, settingsModal)).toThrow();
    expect(() => pinW(viewSource, surface.replace('planSurfaceFor(plan, false)', 'plan?.purchase ? "modal" : "drawer"'), settingsModal)).toThrow();
    expect(() => pinW(viewSource, surface, settingsModal.replace('useUpgradeModalInlineHost();', ''))).toThrow();
  });

  it('(k) a second hard-coded two- or three-column class, a fourth column, or the tripwire pointer gone', () => {
    const raw = read(MODAL);
    expect(() => pinK(`${raw}\nconst other = 'max-sm:grid-cols-2';`)).toThrow();
    expect(() => pinK(`${raw}\nconst other = 'max-sm:grid-cols-3';`)).toThrow();
    expect(() => pinK(`${raw}\nconst other = 'max-sm:grid-cols-4';`)).toThrow();
    expect(() => pinK(raw.split(TRIPWIRE).join('somewhere'))).toThrow();
  });
});
