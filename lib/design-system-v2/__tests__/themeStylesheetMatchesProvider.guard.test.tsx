/**
 * @jest-environment jsdom
 *
 * T-T: what paints BEFORE hydration must equal what the provider writes AFTER
 * it (performance slice TH-1). Otherwise the page changes colour at hydration,
 * which is the flash TH-1 exists to remove.
 *
 * Behavioural, not a source parse: the provider is rendered and its real
 * `setProperty` calls are collected, so a refactor of its tables cannot hide a
 * drift.
 *
 *   T-T1  the default sheet = the provider with no custom tokens, per mode
 *   T-T2  the cascade of every sheet plus the inlined custom rule = the provider
 *         with custom tokens, per mode, with and without `globals-v2.css`
 *
 * The cascade resolver computes specificity from the selector text (SA RC-13);
 * it is not a hand-written table that could drift together with a selector.
 */

import React from 'react';
import { act } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { createRoot } from 'react-dom/client';

import { V2ThemeProvider } from '../theme-provider';
import { V2_THEME_STORAGE_KEY } from '../themeMode';
import { V2_CUSTOM_TOKEN_VARS, buildV2CustomTokenCss, type V2CustomTokens } from '../customTokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ROOT = join(__dirname, '..', '..', '..');
const DEFAULT_SHEET = readFileSync(join(__dirname, '..', 'v2-theme-tokens.css'), 'utf8');
const GLOBALS_V2 = readFileSync(join(ROOT, 'app', 'v2', 'globals-v2.css'), 'utf8');
const GLOBALS = readFileSync(join(ROOT, 'app', 'globals.css'), 'utf8');

type Mode = 'light' | 'dark';
type Decl = { name: string; value: string };
type Rule = { selectors: string[]; decls: Decl[] };
type Sheet = { id: string; rules: Rule[] };

const norm = (v: string) => v.trim().replace(/\s+/g, ' ').replace(/#[0-9a-f]{3,8}\b/gi, (h) => h.toUpperCase());

/** Top-level rules of a stylesheet (at-rule blocks such as @keyframes are skipped). */
function parseSheet(id: string, css: string): Sheet {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        selector = text.slice(start, i).trim();
        start = i + 1;
      }
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const body = text.slice(start, i);
        if (!selector.startsWith('@')) {
          const decls: Decl[] = [];
          for (const part of body.split(';')) {
            const at = part.indexOf(':');
            if (at === -1) continue;
            decls.push({ name: part.slice(0, at).trim(), value: norm(part.slice(at + 1)) });
          }
          rules.push({ selectors: selector.split(',').map((s) => s.trim()), decls });
        }
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      start = i + 1; // top-level @import etc.
    }
  }
  return { id, rules };
}

/** [ids, classes + pseudo-classes, types], computed from a simple compound selector. */
function specificity(selector: string): [number, number, number] {
  if (/\s|>|\+|~/.test(selector)) throw new Error(`not a simple compound selector: ${selector}`);
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length + (selector.match(/(?<!:):(?!:)[\w-]+/g) ?? []).length;
  const types = /^[a-z]/i.test(selector) ? 1 : 0;
  return [ids, classes, types];
}

/** Does a simple compound selector match <html> in this mode? Only these shapes are understood. */
function matchesHtml(selector: string, mode: Mode): boolean {
  const parts = selector.match(/(^[a-z]+)|(\.[\w-]+)|(:[\w-]+)/gi) ?? [];
  if (parts.join('') !== selector) throw new Error(`unknown selector shape: ${selector}`);
  for (const part of parts) {
    if (part === 'html' || part === ':root') continue;
    if (part === '.dark') {
      if (mode !== 'dark') return false;
      continue;
    }
    throw new Error(`unexpected selector part ${part} in ${selector}`);
  }
  return true;
}

const cmp = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The `--v2-*` values on <html> before hydration. A tie in specificity between
 * DIFFERENT sheets must agree in value, because their load order is not
 * guaranteed; within one sheet the later rule wins.
 */
function resolve(sheets: Sheet[], mode: Mode): Record<string, string> {
  const best: Record<string, { spec: number[]; value: string; sheet: string; tied: Set<string> }> = {};
  for (const sheet of sheets) {
    for (const rule of sheet.rules) {
      const v2 = rule.decls.filter((d) => d.name.startsWith('--v2-'));
      if (v2.length === 0) continue;
      for (const selector of rule.selectors) {
        if (!matchesHtml(selector, mode)) continue;
        const spec = specificity(selector);
        for (const d of v2) {
          const cur = best[d.name];
          if (!cur || cmp(spec, cur.spec) > 0) {
            best[d.name] = { spec, value: d.value, sheet: sheet.id, tied: new Set([d.value]) };
          } else if (cmp(spec, cur.spec) === 0) {
            if (cur.sheet !== sheet.id && cur.value !== d.value) {
              throw new Error(`${d.name} (${mode}): ${cur.sheet} and ${sheet.id} tie at ${spec} with different values`);
            }
            cur.value = d.value;
            cur.sheet = sheet.id;
          }
        }
      }
    }
  }
  return Object.fromEntries(Object.entries(best).map(([k, v]) => [k, v.value]));
}

function mockOs() {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** What the provider finally writes on <html>, per name. */
async function providerOutput(mode: Mode, customTokens: V2CustomTokens): Promise<Record<string, string>> {
  localStorage.clear();
  localStorage.setItem(V2_THEME_STORAGE_KEY, mode);
  document.documentElement.className = '';
  document.documentElement.removeAttribute('style');
  mockOs();
  const written: Record<string, string> = {};
  const real = CSSStyleDeclaration.prototype.setProperty;
  const spy = jest.spyOn(CSSStyleDeclaration.prototype, 'setProperty').mockImplementation(function (
    this: CSSStyleDeclaration, name: string, value: string | null, priority?: string
  ) {
    written[name] = norm(String(value));
    return real.call(this, name, value, priority);
  });
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<V2ThemeProvider customTokens={customTokens}><span /></V2ThemeProvider>);
  });
  spy.mockRestore();
  act(() => root.unmount());
  host.remove();
  return written;
}

const defaultSheet = parseSheet('v2-theme-tokens.css', DEFAULT_SHEET);
const globalsV2 = parseSheet('globals-v2.css', GLOBALS_V2);
const customSheet = (tokens: V2CustomTokens) => parseSheet('custom <style>', buildV2CustomTokenCss(tokens));

describe('the resolver computes specificity', () => {
  it.each([
    [':root', [0, 1, 0]],
    [':root.dark', [0, 2, 0]],
    ['html.dark', [0, 1, 1]],
    ['.dark', [0, 1, 0]],
    [':root:root:root', [0, 3, 0]],
  ])('%s → %p', (selector, expected) => {
    expect(specificity(selector)).toEqual(expected);
  });
});

describe('T-T1 the default sheet equals the provider with no custom tokens', () => {
  it('(3) has exactly two rules, `:root` and `:root.dark`, of custom properties only', () => {
    expect(defaultSheet.rules.map((r) => r.selectors)).toEqual([[':root'], [':root.dark']]);
    for (const rule of defaultSheet.rules) {
      for (const d of rule.decls) expect(d.name).toMatch(/^--v2-[a-z0-9-]+$/);
    }
    expect(DEFAULT_SHEET.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/@/);
  });

  it.each(['light', 'dark'] as const)('(1)(2) %s: exactly equal, 43 names', async (mode) => {
    const provider = await providerOutput(mode, {});
    const sheet = resolve([defaultSheet], mode);
    expect(Object.keys(provider)).toHaveLength(43);
    expect(sheet).toEqual(provider);
  });

  it('(4a) light: every name in both `:root` blocks agrees with globals-v2.css', () => {
    const mine = resolve([defaultSheet], 'light');
    const theirs = resolve([globalsV2], 'light');
    for (const name of Object.keys(mine)) {
      if (name in theirs) expect([name, theirs[name]]).toEqual([name, mine[name]]);
    }
  });

  it('(4b) dark: every name globals-v2 sets in dark that the provider writes is in `:root.dark` here', async () => {
    const provider = await providerOutput('dark', {});
    const darkRule = globalsV2.rules.find((r) => r.selectors.includes('html.dark'));
    expect(darkRule).toBeDefined();
    const mineDark = new Set(defaultSheet.rules[1].decls.map((d) => d.name));
    for (const d of darkRule!.decls) {
      if (d.name in provider) expect([d.name, mineDark.has(d.name)]).toEqual([d.name, true]);
    }
  });

  it('(4c) the dark selector is exactly `:root.dark`, and globals.css declares no --v2-* value', () => {
    expect(defaultSheet.rules[1].selectors).toEqual([':root.dark']);
    expect(GLOBALS.replace(/\/\*[\s\S]*?\*\//g, '')).not.toMatch(/--v2-[\w-]+\s*:/);
  });
});

// Synthetic values only; the production row is never used in a test.
function fullSyntheticSet(): V2CustomTokens {
  let n = 0;
  const hex = () => `#0000${(0xa1 + n++).toString(16).toUpperCase()}`;
  return {
    colors: Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.colors).map((k) => [k, hex()])),
    borderRadius: Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.borderRadius).map((k, i) => [k, `${101 + i}px`])),
    shadows: Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.shadows).map((k, i) => [k, `0 0 ${i + 1}px rgba(1, 2, 3, 0.4)`])),
    spacing: Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.spacing).map((k, i) => [k, `${201 + i}px`])),
    typography: Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.typography).map((k, i) => [k, `3.${i + 1}rem`])),
  } as V2CustomTokens;
}

const PARTIAL: V2CustomTokens = { colors: { primary: '#0000A1', secondary: '#0000A2' } };

describe('T-T2 the inlined custom rule equals the provider with custom tokens (both modes)', () => {
  const sets: Array<[string, V2CustomTokens]> = [['full', fullSyntheticSet()], ['partial (production shape)', PARTIAL]];
  const passes: Array<[string, (t: V2CustomTokens) => Sheet[]]> = [
    ['owner segments', (t) => [defaultSheet, customSheet(t)]],
    ['/v2 and CRM (with globals-v2.css)', (t) => [globalsV2, defaultSheet, customSheet(t)]],
  ];

  for (const [setName, tokens] of sets) {
    for (const [passName, sheetsFor] of passes) {
      it.each(['light', 'dark'] as const)(`${setName}, ${passName}, %s`, async (mode) => {
        const provider = await providerOutput(mode, tokens);
        const css = resolve(sheetsFor(tokens), mode);
        const before = Object.fromEntries(Object.keys(provider).map((k) => [k, css[k]]));
        expect(before).toEqual(provider);
      });
    }
  }

  it('the allow-list has 31 entries and is exactly the set of variables custom tokens change', async () => {
    const allowVars = Object.values(V2_CUSTOM_TOKEN_VARS).flatMap((g) => Object.values(g) as string[]);
    expect(allowVars).toHaveLength(31);
    for (const mode of ['light', 'dark'] as const) {
      const defaults = await providerOutput(mode, {});
      const custom = await providerOutput(mode, fullSyntheticSet());
      const changed = Object.keys(custom).filter((k) => custom[k] !== defaults[k]);
      expect(new Set(changed)).toEqual(new Set(allowVars));
    }
  });

  it('the custom rule outranks every default declaration by computed specificity', () => {
    const custom = customSheet(PARTIAL);
    const customSpec = specificity(custom.rules[0].selectors[0]);
    for (const sheet of [defaultSheet, globalsV2]) {
      for (const rule of sheet.rules) {
        if (!rule.decls.some((d) => d.name.startsWith('--v2-'))) continue;
        for (const selector of rule.selectors) expect(cmp(customSpec, specificity(selector))).toBeGreaterThan(0);
      }
    }
  });
});
