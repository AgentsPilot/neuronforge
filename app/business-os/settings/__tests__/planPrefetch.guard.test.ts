/**
 * The settings page starts the plan drawer's read early (settings drawer
 * review §0.6 C-2, slice C-b; workplan P-G1..P-G8; B-1..B-4; SA conditions
 * C-8, C-11; SA-CB-1, SA-CB-3, SA-CB-9).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SOURCE GUARD
 *
 * The page needs the auth, language and configuration providers to render, and
 * what matters is a handful of easily-undone wiring choices: the warm read is
 * off while the page loads, while the configuration dialog is open and after
 * the plan drawer's first close (rule 7, SA Q-1 (b)); it pauses while the
 * drawer is open; the key carries the account and the language; the row warms
 * on hover, focus and press but still opens exactly as before; the section
 * takes the read while the checkout marker is passed exactly as before; none of
 * it leaks into `loadData` or the deep-link effect; and the page never names
 * the route. `PlanSection`'s own side (take once, outside the cancellable
 * effect, declared before it) is pinned here too, structurally; its behaviour
 * is in `PlanSection.prefetch.render.test.tsx`.
 *
 * Pins run on comment-stripped source, so a commented-out line cannot satisfy
 * them. Each pin has a negative control.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import fs from 'fs';
import path from 'path';

const SETTINGS = 'app/business-os/settings/page.tsx';
const SECTION = 'components/business-os/settings/PlanSection.tsx';
const READS = 'components/business-os/settings/planDrawerReads.ts';

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
const stripComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const code = stripComments(read(SETTINGS));
const section = stripComments(read(SECTION));
const reads = stripComments(read(READS));

/** From `marker` to the brace that closes the first `{` after it. */
function braceBlock(source: string, marker: string, from = 0): string {
  const start = source.indexOf(marker, from);
  if (start < 0) throw new Error(`marker not found: ${marker}`);
  const open = source.indexOf('{', start + marker.length);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unbalanced block after: ${marker}`);
}

/** The plan `useDrawerPrefetch({ … })` call's options object, found by its name. */
const planCall = (source: string) => braceBlock(source, 'const planPrefetch = useDrawerPrefetch(');

/** The plan row button, up to its closing tag. */
function planRow(source: string): string {
  const start = source.indexOf('ref={planRowRef}');
  if (start < 0) throw new Error('plan row not found');
  return source.slice(start, source.indexOf('</button>', start));
}

/** The `<PlanSection … />` element. */
function sectionElement(source: string): string {
  const start = source.indexOf('<PlanSection');
  if (start < 0) throw new Error('PlanSection not found');
  return source.slice(start, source.indexOf('/>', start) + 2);
}

/** The deep-link effect: from its `useEffect(` to its dependency list. */
function deepLinkEffect(source: string): string {
  const anchor = source.indexOf("searchParams.get('section')");
  if (anchor < 0) throw new Error('deep-link effect not found');
  const start = source.lastIndexOf('useEffect(', anchor);
  const end = source.indexOf('openPasswordFromLink, signsInWithProvider]', anchor);
  if (start < 0 || end < 0) throw new Error('deep-link effect bounds not found');
  return source.slice(start, end);
}

/**
 * Every top-level `let`, `var` or `const` line that is not a plain numeric
 * constant (C-a's allow-list, QA-MU-1). Top level = starts in column 0.
 */
function moduleStateViolations(source: string): string[] {
  const declarations = source.match(/^(?:export\s+)?(?:const|let|var)\b[^\n]*/gm) ?? [];
  return declarations.filter((line) => !/^(?:export\s+)?const\s+[A-Z][A-Z0-9_]*\s*=\s*[\d_]+\s*;\s*$/.test(line.trimEnd()));
}

/**
 * An IMPORT of the entitlements module: `from '…'`, `import('…')` or
 * `require('…')` only (SA-CB-9). The route URL in `readMyPlan` contains
 * `business-os/entitlements` too, and must not trip it.
 */
const ENTITLEMENTS_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)['"][^'"]*lib\/business-os\/entitlements[^'"]*['"]/;

function pg1(source: string) {
  const call = planCall(source);
  expect(call).toMatch(/start:\s*\(\)\s*=>\s*startPlanDrawerRead\(\s*language\s*\)/);
  const key = call.match(/key:\s*([^\n]+)/)?.[1] ?? '';
  expect(key).toContain('user.id');
  expect(key).toContain('language');
  // The whole expression: `||` for `&&`, or a term dropped, warms when it must not.
  expect((call.match(/enabled:\s*([^\n]+)/)?.[1] ?? '').trim()).toBe('!loading && !isConfigurationOpen && !planWarmSpent,');
  // Rule 6: paused, not disabled, while open, so the section can take the set.
  expect((call.match(/paused:\s*([^\n]+)/)?.[1] ?? '').trim()).toBe('planDrawer.open,');
  expect(call).toMatch(/maxAgeMs:\s*DRAWER_PREFETCH_MAX_AGE_MS,/);
  expect(call).toMatch(/warmOnIdle:\s*true/);
}

function pg2(source: string) {
  const row = planRow(source);
  expect(row).toContain('onPointerEnter={planPrefetch.warm}');
  expect(row).toContain('onFocus={planPrefetch.warm}');
  expect(row).toContain('onPointerDown={planPrefetch.warm}');
  expect(row).toContain('onClick={planDrawer.openFromRow}');
}

/** UM-D3: the decider's `usePlanSurface({ … })` options. */
const surfaceCall = (source: string) => braceBlock(source, 'const planSurface = usePlanSurface(');

/**
 * P-G3, re-mapped by UM-D3 (D3-12): the DECIDER takes the page's set, once per
 * open, and hands it on; the section takes the decider's hand-over. Was: the
 * section took `planPrefetch.take` itself. The marker expression is still the
 * same, byte for byte, in both places (C-11).
 */
function pg3(source: string) {
  const element = sectionElement(source);
  // SA condition C-11: the marker expression, byte for byte.
  expect(element).toContain("checkoutMarker={searchParams?.get('checkout') ?? null}");
  expect(element).toContain('takePrefetched={planSurface.takeForDrawer}');
  const call = surfaceCall(source);
  expect(call).toContain('open: planDrawer.open,');
  expect(call).toContain("checkoutMarker: searchParams?.get('checkout') ?? null,");
  expect(call).toContain('takePrefetched: planPrefetch.take,');
  // The decider is the page set's only taker.
  expect(source.match(/planPrefetch\.take\b/g) ?? []).toHaveLength(1);
}

function pg4(source: string) {
  for (const block of [braceBlock(source, 'const loadData = async () =>'), deepLinkEffect(source)]) {
    expect(block).not.toContain('planPrefetch');
    expect(block).not.toContain('startPlanDrawerRead');
    expect(block).not.toContain('planWarmSpent');
    // UM-D3 (D3-8): nor the decider, which takes the set when the surface opens.
    expect(block).not.toContain('planSurface');
  }
}

function pg5(source: string) {
  expect(source).not.toMatch(/\breadMyPlan\b/);
  expect(source).not.toContain('my-plan');
  const imports = source.match(/import\s*\{([^}]*)\}\s*from\s*'@\/components\/business-os\/settings\/planDrawerReads'/g) ?? [];
  const names = imports
    .flatMap((line) => (line.match(/\{([^}]*)\}/)?.[1] ?? '').split(','))
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
  expect(names).toEqual(['startPlanDrawerRead']);
}

/**
 * SA-CB-1, in the render-derived form (SA optimisation 1): the flag that
 * remembers an open is only ever set true, the spent flag is that AND the
 * drawer being closed (never true while open, true in the render that closes
 * it), and both are computed before the hook call that reads them.
 */
function pg6(source: string) {
  expect(source).toMatch(/const \[planDrawerOpened, setPlanDrawerOpened\] = useState\(false\);/);
  expect(source).toContain('if (planDrawer.open && !planDrawerOpened) setPlanDrawerOpened(true);');
  expect(source.match(/setPlanDrawerOpened\(/g) ?? []).toHaveLength(1);
  expect(source).toContain('const planWarmSpent = planDrawerOpened && !planDrawer.open;');
  expect(source.indexOf('const planWarmSpent =')).toBeLessThan(source.indexOf('const planPrefetch = useDrawerPrefetch('));
  // settingsDeepLinks.guard forbids this shape anywhere in the page.
  expect(source).not.toMatch(/if\s*\(\s*!\s*planDrawer\.open/);
}

function pg7(source: string) {
  expect(source).not.toMatch(ENTITLEMENTS_IMPORT);
  expect(source).not.toMatch(/supabaseClient|@supabase\//);
  expect(source).not.toMatch(/lib\/repositories/);
  expect(source).not.toMatch(/\bconsole\./);
  // No import at all (A-1), so no cycle with PlanSection and nothing to drift.
  expect(source).not.toMatch(/^\s*import\b/m);
  expect(source).not.toMatch(/\brequire\s*\(/);
  expect(moduleStateViolations(source)).toEqual([]);
}

/** The `useEffect(` that holds `needle`, as a block. */
function effectHolding(source: string, needle: string): { start: number; block: string } {
  const at = source.indexOf(needle);
  if (at < 0) throw new Error(`not found: ${needle}`);
  const start = source.lastIndexOf('useEffect(', at);
  return { start, block: braceBlock(source, 'useEffect(', start) };
}

function pg8(source: string) {
  // B-1: the set is taken exactly once, in the effect guarded by `firstStarted`.
  expect(source.match(/takePrefetched\?\.\(/g) ?? []).toHaveLength(1);
  const first = effectHolding(source, 'if (firstStarted.current) return;');
  expect(first.block).toContain('takePrefetched?.(');
  expect(first.block).toContain('firstStarted.current = true;');

  // …and not in the `[language]` effect.
  const languageEnd = source.indexOf('}, [language]);');
  expect(languageEnd).toBeGreaterThan(-1);
  const languageStart = source.lastIndexOf('useEffect(', languageEnd);
  const languageEffect = source.slice(languageStart, languageEnd);
  expect(languageEffect).not.toContain('takePrefetched');
  expect(languageEffect).not.toContain('firstStarted');

  // SA-CB-3: declared IMMEDIATELY before the `[language]` effect.
  expect(first.start).toBeLessThan(languageStart);
  expect(source.indexOf('useEffect(', first.start + first.block.length)).toBe(languageStart);
}

describe('the page wiring (C-b)', () => {
  it('P-G1: the plan prefetch is keyed by account and language, off while loading, while Configuration is open and once spent, and paused while the drawer is open', () => {
    pg1(code);
  });

  it('P-G2: the plan row warms on hover, focus and press, and still opens with the same onClick', () => {
    pg2(code);
  });

  it('P-G3: the section takes the read, and the checkout marker is passed exactly as before (SA condition C-11)', () => {
    pg3(code);
  });

  it('P-G4: neither loadData nor the deep-link effect names any of it (SA condition C-8)', () => {
    pg4(code);
  });

  it('P-G5 (B-4): the page imports only the starter; never the read, never the route', () => {
    pg5(code);
  });

  it('P-G6 (rule 7, SA-CB-1): the spent flag is never true while the drawer is open and is set by the first close', () => {
    pg6(code);
  });
});

describe('the read module stays inside its limits (P-G7; SA-CB-8, SA-CB-9)', () => {
  it('planDrawerReads.ts: no entitlements import, no Supabase, no repository, no console.*, no import at all, no module-level state', () => {
    pg7(reads);
  });

  it('the import matcher is not vacuous: the module names the route, which contains business-os/entitlements, and that does not trip it', () => {
    expect(reads).toContain('business-os/entitlements/my-plan');
    expect(reads).not.toMatch(ENTITLEMENTS_IMPORT);
  });
});

describe('PlanSection takes the set once, outside the cancellable effect (P-G8; B-1, SA-CB-3)', () => {
  it('P-G8: one take, in the firstStarted effect, declared immediately before the [language] effect', () => {
    pg8(section);
  });
});

describe('negative controls: each pin fails on the mutation it exists for', () => {
  const swap = (source: string, needle: string, replacement = '') => {
    expect(source).toContain(needle);
    const mutated = source.replace(needle, replacement);
    expect(mutated).not.toBe(source);
    return mutated;
  };
  const without = (needle: string, replacement = '') => swap(code, needle, replacement);

  it('P-G1 fails without the spent term, without the configuration term, or with || (MB-17)', () => {
    expect(() => pg1(without('!loading && !isConfigurationOpen && !planWarmSpent,', '!loading && !isConfigurationOpen,'))).toThrow();
    expect(() => pg1(without('!loading && !isConfigurationOpen && !planWarmSpent,', '!loading && !planWarmSpent,'))).toThrow();
    expect(() => pg1(without('!loading && !isConfigurationOpen && !planWarmSpent,', '!loading || !isConfigurationOpen || !planWarmSpent,'))).toThrow();
  });

  it('P-G1 fails without the pause, or with the drawer term moved into enabled (MB-15, MB-16)', () => {
    expect(() => pg1(without('paused: planDrawer.open,'))).toThrow();
    expect(() => pg1(without('paused: planDrawer.open,', 'paused: false,'))).toThrow();
    const moved = without('!loading && !isConfigurationOpen && !planWarmSpent,', '!loading && !isConfigurationOpen && !planWarmSpent && !planDrawer.open,');
    expect(() => pg1(swap(moved, 'paused: planDrawer.open,'))).toThrow();
  });

  it('P-G1 fails when the key drops the language (MB-20)', () => {
    // The plan call's key, not the consent call's: replace inside the plan block.
    const block = planCall(code);
    const mutated = code.replace(block, block.replace('`${user.id}:${language}`', '`${user.id}`'));
    expect(mutated).not.toBe(code);
    expect(() => pg1(mutated)).toThrow();
  });

  it('P-G1 fails when start reads in a fixed language', () => {
    expect(() => pg1(without('startPlanDrawerRead(language)', "startPlanDrawerRead('en')"))).toThrow();
  });

  it('P-G2 fails without onFocus, and when onClick changes (MB-19)', () => {
    expect(() => pg2(without('onFocus={planPrefetch.warm}'))).toThrow();
    expect(() => pg2(without('onPointerEnter={planPrefetch.warm}'))).toThrow();
    expect(() => pg2(without('onPointerDown={planPrefetch.warm}'))).toThrow();
    expect(() => pg2(without('onClick={planDrawer.openFromRow}', 'onClick={() => { planPrefetch.warm(); planDrawer.openFromRow(); }}'))).toThrow();
  });

  it('P-G3 fails without takePrefetched, or with the marker expression changed', () => {
    expect(() => pg3(without('takePrefetched={planSurface.takeForDrawer}'))).toThrow();
    expect(() => pg3(without("checkoutMarker={searchParams?.get('checkout') ?? null}", "checkoutMarker={searchParams?.get('checkout') || null}"))).toThrow();
  });

  it('P-G3 (UM-D3) fails when the section takes the page set itself, the decider loses it, or its marker changes', () => {
    expect(() => pg3(without('takePrefetched={planSurface.takeForDrawer}', 'takePrefetched={planPrefetch.take}'))).toThrow();
    expect(() => pg3(without('takePrefetched: planPrefetch.take,', 'takePrefetched: () => null,'))).toThrow();
    expect(() => pg3(without("checkoutMarker: searchParams?.get('checkout') ?? null,", 'checkoutMarker: null,'))).toThrow();
  });

  it('P-G4 (UM-D3) fails when the deep-link effect names the decider', () => {
    expect(() => pg4(without('openPlanFromLink();', 'planSurface.takeForDrawer(); openPlanFromLink();'))).toThrow();
  });

  it('P-G4 fails when loadData or the deep-link effect warms', () => {
    expect(() => pg4(without('const loadData = async () => {', 'const loadData = async () => {\n planPrefetch.warm();'))).toThrow();
    expect(() => pg4(without('openPlanFromLink();', 'planPrefetch.warm(); openPlanFromLink();'))).toThrow();
  });

  it('P-G5 fails on a direct read import, or a route literal', () => {
    expect(() => pg5(without('import { startPlanDrawerRead }', 'import { readMyPlan, startPlanDrawerRead }'))).toThrow();
    expect(() => pg5(`${code}\nconst url = '/api/business-os/entitlements/my-plan';`)).toThrow();
  });

  it('P-G6 fails when the flag is set on the open (MB-18), inverted, or ever cleared', () => {
    expect(() => pg6(without('const planWarmSpent = planDrawerOpened && !planDrawer.open;', 'const planWarmSpent = planDrawerOpened;'))).toThrow();
    expect(() => pg6(without('const planWarmSpent = planDrawerOpened && !planDrawer.open;', 'const planWarmSpent = planDrawerOpened || !planDrawer.open;'))).toThrow();
    expect(() => pg6(without('if (planDrawer.open && !planDrawerOpened) setPlanDrawerOpened(true);'))).toThrow();
    expect(() => pg6(`${code}\nsetPlanDrawerOpened(false);`)).toThrow();
  });

  it('P-G7 fails on an entitlements import, type-only included (SA-CB-9), and on other forbidden content', () => {
    const anchor = 'export type PlanRead';
    expect(reads).toContain(anchor);
    const withLine = (line: string) => reads.replace(anchor, `${line}\n${anchor}`);
    for (const line of [
      "import type { X } from '@/lib/business-os/entitlements/types';",
      "import { Y } from '@/lib/business-os/entitlements/resolver';",
      "const z = require('@/lib/business-os/entitlements/source');",
      "const w = import('@/lib/business-os/entitlements/source');",
    ]) {
      expect(withLine(line)).toMatch(ENTITLEMENTS_IMPORT);
      expect(() => pg7(withLine(line))).toThrow();
    }
    expect(() => pg7(withLine("import { supabase } from '@/lib/supabaseClient';"))).toThrow();
    expect(() => pg7(withLine("import { x } from '@/lib/repositories/x';"))).toThrow();
    expect(() => pg7(withLine("console.log('x');"))).toThrow();
    // SA-CB-2: the URL inline, not a top-level string constant.
    expect(() => pg7(withLine("const MY_PLAN_URL = '/api/business-os/entitlements/my-plan';"))).toThrow();
    expect(() => pg7(withLine('let held = null;'))).toThrow();
  });

  it('P-G8 fails when take moves into the [language] effect (MB-1)', () => {
    const mutated = swap(
      swap(section, 'const offered = takePrefetched?.() ?? null;', 'const offered = null as PlanDrawerRead | null;'),
      'const pending = firstRead.current;',
      'const local = takePrefetched?.() ?? null; const pending = firstRead.current;'
    );
    expect(() => pg8(mutated)).toThrow();
  });

  it('P-G8 fails when the guard is removed (MB-2)', () => {
    expect(() => pg8(swap(section, 'if (firstStarted.current) return;'))).toThrow();
  });

  it('P-G8 fails when the two effects are swapped (MB-21)', () => {
    const first = effectHolding(section, 'if (firstStarted.current) return;');
    const firstFull = section.slice(first.start, section.indexOf('}, []);', first.start) + '}, []);'.length);
    const languageEnd = section.indexOf('}, [language]);') + '}, [language]);'.length;
    const languageStart = section.lastIndexOf('useEffect(', section.indexOf('}, [language]);'));
    const languageFull = section.slice(languageStart, languageEnd);
    const swapped = section.replace(firstFull, '__FIRST__').replace(languageFull, firstFull).replace('__FIRST__', languageFull);
    expect(swapped).not.toBe(section);
    expect(() => pg8(swapped)).toThrow();
  });

  it('P-G8 fails when another effect sits between the two', () => {
    const at = section.indexOf('}, [language]);');
    const languageStart = section.lastIndexOf('useEffect(', at);
    const mutated = `${section.slice(0, languageStart)}useEffect(() => { void 0; }, []);\n  ${section.slice(languageStart)}`;
    expect(() => pg8(mutated)).toThrow();
  });
});
