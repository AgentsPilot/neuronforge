/**
 * The settings page starts the Marketing permission drawer's reads early
 * (settings drawer review §0.6 C-5; C-a workplan T-G1..T-G5; SA condition C-8,
 * SA-CA-8, SA-CA-10).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The page needs the auth, language and configuration providers to render, and
 * what matters here is a handful of easily-undone wiring choices: the warm
 * reads stay off while the page loads and while the configuration dialog (where
 * the address book is edited) is open, and pause while the drawer itself is open; the key carries the account and the
 * language; the row warms on hover, focus and press but still opens exactly as
 * before; the drawer takes the reads; and none of it leaks into `loadData` or
 * names a route in the page. The hook's own rules have their own tests.
 *
 * Pins run on comment-stripped source, so a commented-out line cannot satisfy
 * them. Each pin has a negative control.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';
const HOOK = 'components/business-os/settings/useDrawerPrefetch.ts';
const NEW_MODULES = [
  HOOK,
  'components/business-os/settings/marketingDrawerReads.ts',
  'components/ui/addressBookRead.ts',
];

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = stripComments(read(SETTINGS));

/** From `marker` to the brace that closes the first `{` after it. */
function braceBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced block after: ${marker}`);
}

/**
 * Every top-level `let`, `var` or `const` line that is not a plain numeric
 * constant (`const NAME = 60_000;`). Top level = starts in column 0.
 */
function moduleStateViolations(source: string): string[] {
  const declarations = source.match(/^(?:export\s+)?(?:const|let|var)\b[^\n]*/gm) ?? [];
  return declarations.filter((line) => !/^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*[\d_]+\s*;\s*$/.test(line.trimEnd()));
}

/** The `useDrawerPrefetch({ … })` call's options object. */
const prefetchCall = (source: string) => braceBlock(source, 'useDrawerPrefetch(');

/** The consent row button, up to its closing tag. */
function consentRow(source: string): string {
  const start = source.indexOf('ref={consentRowRef}');
  if (start < 0) throw new Error('consent row not found');
  return source.slice(start, source.indexOf('</button>', start));
}

/** The `<MarketingConsentDrawer … />` element. */
function drawerElement(source: string): string {
  const start = source.indexOf('<MarketingConsentDrawer');
  if (start < 0) throw new Error('drawer not found');
  return source.slice(start, source.indexOf('/>', start) + 2);
}

function g1(source: string) {
  const call = prefetchCall(source);
  expect(call).toMatch(/start:\s*\(\)\s*=>\s*startMarketingDrawerReads\(\s*language\s*\)/);
  const key = call.match(/key:\s*([^\n]+)/)?.[1] ?? '';
  expect(key).toContain('user.id');
  expect(key).toContain('language');
  // The whole expression, not its terms: `||` in place of `&&` keeps both
  // terms and warms while the dialog is open (QA-MU-7).
  const enabled = (call.match(/enabled:\s*([^\n]+)/)?.[1] ?? '').trim();
  expect(enabled).toBe('!loading && !isConfigurationOpen,');
  // QA-CA-B1: nothing starts while the drawer itself is open. Paused, not
  // disabled, so the drawer can still take the set it opened with (rule 6).
  const paused = (call.match(/paused:\s*([^\n]+)/)?.[1] ?? '').trim();
  expect(paused).toBe('consentDrawerOpen,');
  expect(call).toMatch(/maxAgeMs:\s*DRAWER_PREFETCH_MAX_AGE_MS/);
  expect(call).toMatch(/warmOnIdle:\s*true/);
}

function g2(source: string) {
  const row = consentRow(source);
  expect(row).toContain('onPointerEnter={consentPrefetch.warm}');
  expect(row).toContain('onFocus={consentPrefetch.warm}');
  expect(row).toContain('onPointerDown={consentPrefetch.warm}');
  expect(row).toContain('onClick={() => setConsentDrawerOpen(true)}');
}

function g3(source: string) {
  expect(drawerElement(source)).toContain('takePrefetched={consentPrefetch.take}');
}

function g4(source: string) {
  const loadData = braceBlock(source, 'const loadData = async () =>');
  expect(loadData).not.toContain('consentPrefetch');
  expect(loadData).not.toContain('startMarketingDrawerReads');
  expect(loadData).not.toContain('useDrawerPrefetch');
}

function g5(source: string) {
  expect(source).not.toMatch(/\breadConsentSettings\b/);
  expect(source).not.toMatch(/\breadAddressBook\b/);
  expect(source).not.toContain('addressBookRead');
  const imports = source.match(/import\s*\{([^}]*)\}\s*from\s*'@\/components\/business-os\/settings\/(?:marketingDrawerReads|useDrawerPrefetch)'/g) ?? [];
  const names = imports
    .flatMap((line) => (line.match(/\{([^}]*)\}/)?.[1] ?? '').split(','))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  expect(names).toEqual(['DRAWER_PREFETCH_MAX_AGE_MS', 'startMarketingDrawerReads', 'useDrawerPrefetch']);
}

describe('the page wiring (C-5)', () => {
  it('T-G1: one prefetch, keyed by account and language, off while loading or while the configuration dialog is open, paused while the drawer itself is open', () => {
    expect(code.split('useDrawerPrefetch(').length - 1).toBe(1);
    g1(code);
  });

  it('T-G2: the consent row warms on hover, focus and press, and still opens with the same onClick', () => {
    g2(code);
  });

  it('T-G3: the drawer takes the reads', () => {
    g3(code);
  });

  it('T-G4: loadData names none of it (SA condition C-8: its own effect, not loadData)', () => {
    g4(code);
  });

  it('T-G5: the page imports only the starter, the hook and its max age; never a read or a route', () => {
    g5(code);
    expect(code).not.toContain('/api/business-os/addresses');
    expect(code).not.toContain('/api/business-os/consent-settings');
  });
});

describe('negative controls: each pin fails on the mutation it exists for', () => {
  const without = (needle: string, replacement = '') => {
    expect(code).toContain(needle);
    return code.replace(needle, replacement);
  };

  it('T-G1 fails without !isConfigurationOpen, and without !loading', () => {
    expect(() => g1(without('!loading && !isConfigurationOpen', '!loading'))).toThrow();
    expect(() => g1(without('!loading && !isConfigurationOpen', '!isConfigurationOpen'))).toThrow();
  });

  it('T-G1 fails when && becomes || (QA-MU-7)', () => {
    expect(() => g1(without('enabled: !loading && !isConfigurationOpen,', 'enabled: !loading || !isConfigurationOpen,'))).toThrow();
  });

  it('T-G1 fails without the pause on the drawer, or with a different one (QA-CA-B1)', () => {
    expect(() => g1(without('paused: consentDrawerOpen,'))).toThrow();
    expect(() => g1(without('paused: consentDrawerOpen,', 'paused: false,'))).toThrow();
    expect(() => g1(without('paused: consentDrawerOpen,', 'paused: !consentDrawerOpen,'))).toThrow();
  });

  it('T-G1 fails when the drawer term moves into enabled (that drops the set before the drawer can take it)', () => {
    const moved = without('enabled: !loading && !isConfigurationOpen,', 'enabled: !loading && !isConfigurationOpen && !consentDrawerOpen,');
    expect(() => g1(moved.replace('paused: consentDrawerOpen,', ''))).toThrow();
  });

  it('T-G1 fails when the key drops the language', () => {
    expect(() => g1(code.replace('`${user.id}:${language}`', '`${user.id}`'))).toThrow();
  });

  it('T-G2 fails without onFocus, and when onClick changes', () => {
    expect(() => g2(without('onFocus={consentPrefetch.warm}'))).toThrow();
    expect(() => g2(without('onClick={() => setConsentDrawerOpen(true)}', 'onClick={() => { consentPrefetch.warm(); setConsentDrawerOpen(true); }}'))).toThrow();
  });

  it('T-G3 fails without takePrefetched', () => {
    expect(() => g3(without('takePrefetched={consentPrefetch.take}'))).toThrow();
  });

  it('T-G4 fails when loadData warms', () => {
    const mutated = code.replace('const loadData = async () => {', 'const loadData = async () => {\n consentPrefetch.warm();');
    expect(() => g4(mutated)).toThrow();
  });

  it('T-G5 fails on a direct read import', () => {
    const mutated = code.replace(
      'import { startMarketingDrawerReads }',
      'import { readConsentSettings, startMarketingDrawerReads }'
    );
    expect(mutated).not.toBe(code);
    expect(() => g5(mutated)).toThrow();
  });
});

describe('the new modules stay inside their limits (SA-CA-8, SA-CA-10)', () => {
  it.each(NEW_MODULES)('%s: no entitlements, browser Supabase, repository or console.*', (file) => {
    const source = stripComments(read(file));
    expect(source).not.toMatch(/business-os\/entitlements/);
    expect(source).not.toMatch(/supabaseClient|@supabase\//);
    expect(source).not.toMatch(/lib\/repositories/);
    expect(source).not.toMatch(/\bconsole\./);
  });

  it('the hook holds no module-level state: its only top-level declarations are constants, types and the hook', () => {
    expect(moduleStateViolations(stripComments(read(HOOK)))).toEqual([]);
  });

  /*
   * An allow-list, not a deny-list (QA-MU-1): the old deny pattern missed a
   * typed declaration (`const X: T = { current: null }`), and would miss a
   * factory call too. A top-level `const` may only be a numeric constant; no
   * `let` or `var` at all.
   */
  it('the module-state check fails on each way of holding state at module level (negative controls)', () => {
    const source = stripComments(read(HOOK));
    const anchor = 'const IDLE_FALLBACK_MS = 1_500;';
    expect(source).toContain(anchor);
    const withLine = (line: string) => source.replace(anchor, `${anchor}\n${line}`);
    for (const line of [
      'const MODULE_HELD: { current: unknown } = { current: null };',
      'const cache = new Map<string, unknown>();',
      'export const store = createStore();',
      'const held = [];',
      'let held = null;',
      'export let held: unknown = null;',
      'var held = null;',
    ]) {
      expect(moduleStateViolations(withLine(line))).not.toEqual([]);
    }
  });

  it("the hook's header states its scope", () => {
    expect(read(HOOK)).toContain('Approved for settings-page drawers; another surface needs SA review.');
  });
});
