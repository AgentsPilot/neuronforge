/**
 * T-C: the custom-token allow-list, the value grammars, the sanitizer and the
 * CSS builder (performance slice TH-1, TH-2 folded in; SA RC-13).
 *
 * This module is the security boundary between an admin-saved, unvalidated
 * JSON value and a raw `<style>` element on every owner page.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';

import {
  V2_CUSTOM_TOKEN_VARS,
  V2_CUSTOM_TOKENS_SELECTOR,
  buildV2CustomTokenCss,
  sanitizeV2CustomTokens,
  sanitizeV2CustomTokensDetailed,
  validTokenValue,
  type V2CustomTokenGroup,
} from '../customTokens';
import { V2CustomTokensStyle } from '../V2CustomTokensStyle';
import { v2Tokens } from '../tokens';

const ALL_VARS = Object.values(V2_CUSTOM_TOKEN_VARS).flatMap((g) => Object.values(g) as string[]);

describe('T-C1 allow-list', () => {
  it('has 31 keys mapped to 31 distinct variables, none of them a status token', () => {
    expect(ALL_VARS).toHaveLength(31);
    expect(new Set(ALL_VARS).size).toBe(31);
    expect(ALL_VARS.some((v) => v.startsWith('--v2-status-'))).toBe(false);
  });

  it('drops unknown groups and keys', () => {
    const out = sanitizeV2CustomTokens({
      colors: { primary: '#0000A1', bogus: '#0000A2' },
      unknownGroup: { primary: '#0000A3' },
    });
    expect(out).toEqual({ colors: { primary: '#0000A1' } });
  });

  it('never copies __proto__, constructor or prototype, at either level', () => {
    const raw = JSON.parse(
      '{"__proto__":{"polluted":"yes"},"constructor":{"x":"#fff"},"colors":{"__proto__":{"polluted":"yes"},"prototype":"#fff","primary":"#0000A1"}}'
    );
    const out = sanitizeV2CustomTokens(raw);
    expect(out).toEqual({ colors: { primary: '#0000A1' } });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(out, '__proto__')).toBe(false);
  });

  it.each([null, undefined, [], 'string', 42, true])('a root of %p gives {}', (raw) => {
    expect(sanitizeV2CustomTokens(raw)).toEqual({});
  });

  it.each([null, [], 'string', 42])('a group of %p is dropped', (group) => {
    const { tokens, droppedKeys } = sanitizeV2CustomTokensDetailed({ colors: group, spacing: { card: '24px' } });
    expect(tokens).toEqual({ spacing: { card: '24px' } });
    expect(droppedKeys).toEqual(['colors']);
  });

  it('drops non-string values and reports names only', () => {
    const { tokens, droppedKeys } = sanitizeV2CustomTokensDetailed({
      colors: { primary: 123, secondary: { nested: '#fff' }, surface: '#0000A1' },
    });
    expect(tokens).toEqual({ colors: { surface: '#0000A1' } });
    expect(droppedKeys).toEqual(['colors.primary', 'colors.secondary']);
  });

  it('returns a deep-frozen object with no inherited keys (RC-13(b))', () => {
    const out = sanitizeV2CustomTokens({ colors: { primary: '#0000A1' }, spacing: { card: '8px' } });
    expect(Object.isFrozen(out)).toBe(true);
    expect(Object.isFrozen(out.colors)).toBe(true);
    expect(Object.isFrozen(out.spacing)).toBe(true);
    expect(Object.keys(out)).toEqual(['colors', 'spacing']);
  });

  it('accepts an Object.create(null) root and group (RC-13(d)): only own properties are read', () => {
    const colors = Object.create(null) as Record<string, string>;
    colors.primary = '#0000A1';
    const root = Object.create(null) as Record<string, unknown>;
    root.colors = colors;
    expect(sanitizeV2CustomTokens(root)).toEqual({ colors: { primary: '#0000A1' } });
  });

  it('ignores inherited (non-own) values', () => {
    const proto = { primary: '#0000A1' };
    const colors = Object.create(proto);
    expect(sanitizeV2CustomTokens({ colors })).toEqual({});
  });
});

describe('T-C2 grammars', () => {
  const cases: Array<[V2CustomTokenGroup, string, boolean]> = [
    ['colors', '#6366F1', true],
    ['colors', '#fff', true],
    ['colors', '#ffff', true],
    ['colors', '#11223344', true],
    ['colors', 'rgba(6, 95, 70, 0.15)', true],
    ['colors', 'hsl(240 50% 50% / 0.5)', true],
    ['colors', 'rebeccapurple', true],
    ['colors', 'currentColor', true],
    ['colors', 'transparent', true],
    ['colors', '#12345', false],
    ['colors', 'var(--x)', false],
    ['colors', 'url(x)', false],
    ['colors', 'expression(alert(1))', false],
    ['colors', 'red;}', false],
    ['colors', 'red</style>', false],
    ['colors', 'rgb(1,2,3);color:red', false],
    ['colors', '', false],
    ['colors', '   ', false],
    ['borderRadius', '24px', true],
    ['borderRadius', '0', true],
    ['borderRadius', '8px 16px', true],
    ['borderRadius', '1px 2px 3px 4px', true],
    ['borderRadius', '1px 2px 3px 4px 5px', false],
    ['borderRadius', 'calc(1px + 2px)', false],
    ['borderRadius', '24px;', false],
    ['borderRadius', '-1px', false],
    ['spacing', '1.125rem', true],
    ['spacing', '50%', true],
    ['spacing', '24', false],
    ['typography', '1rem', true],
    ['typography', '1.2345rem', false],
    ['shadows', 'none', true],
    ['shadows', '0 2px 16px rgba(0, 0, 0, 0.3)', true],
    ['shadows', 'inset 0 0 1px #000', true],
    ['shadows', '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)', true],
    ['shadows', '0 0 1px red', false],
    ['shadows', '0 0 1px var(--x)', false],
    ['shadows', '0 0 1px url(x)', false],
    ['shadows', '0 0 1px rgba(0,0,0,0.1);x:y', false],
    ['shadows', '0 0 1px rgba(0 0 0 / 0.1)', false],
    ['shadows', '0 0 1px */', false],
  ];

  it.each(cases)('%s %p → %p', (group, value, ok) => {
    expect(validTokenValue(group, value) !== null).toBe(ok);
  });

  // QA-1: a value whose ONLY bad character is `;` or `:` must still be refused.
  it.each([
    ['colors', 'red;'], ['colors', '#fff;'], ['colors', 'rgb(1;2;3)'], ['colors', 'red;color:blue'], ['colors', 'red:blue'],
    ['borderRadius', '24px;'], ['borderRadius', '24px:'], ['borderRadius', '24px;color:blue'],
    ['spacing', '24px;'], ['spacing', '24px:'], ['typography', '1rem;'], ['typography', '1rem:'],
    ['shadows', '0 0 1px red;x'], ['shadows', '0 0 1px #000;'], ['shadows', '0 0 1px #000:'], ['shadows', 'none;'],
  ] as Array<[V2CustomTokenGroup, string]>)('QA-1 rejects %s %p', (group, value) => {
    expect(validTokenValue(group, value)).toBeNull();
    expect(buildV2CustomTokenCss({ [group]: { [Object.keys(V2_CUSTOM_TOKEN_VARS[group])[0]]: value } })).toBe('');
  });

  it.each([
    ['colors', 'rgb(1,\n2,3)'], ['colors', 'rgb(1,\u20282,3)'], ['colors', 'rgb(1,\u00a02,3)'], ['colors', 'rgb(1,\ufeff2,3)'],
    ['spacing', '8px\n16px'], ['spacing', '8px\u00a016px'], ['shadows', '0 0\n1px #000'], ['shadows', '0 0\u20281px #000'],
  ] as Array<[V2CustomTokenGroup, string]>)(
    'only a space or a tab counts as whitespace inside a value: %s %j', (group, value) => {
      expect(validTokenValue(group, value)).toBeNull();
    }
  );

  it('caps the length at 200', () => {
    expect(validTokenValue('colors', `rgb(${'1,'.repeat(99)}1)`)).toBeNull();
    expect(validTokenValue('shadows', `0 0 ${'1'.repeat(300)}px #000`)).toBeNull();
  });

  it('returns the trimmed value', () => {
    expect(validTokenValue('colors', '  #0000A1 ')).toBe('#0000A1');
  });
});

describe('QA-1 forbidden characters, around every valid sample in every group', () => {
  const FORBIDDEN = [';', ':', '{', '}', '<', '>', '\\', '"', "'", '@', '*', '!'];
  const SAMPLES: Array<[V2CustomTokenGroup, string]> = [
    ['colors', '#0000A1'], ['colors', 'rgb(1, 2, 3)'], ['colors', 'rebeccapurple'],
    ['borderRadius', '24px'], ['borderRadius', '8px 16px'], ['spacing', '24px'], ['typography', '1.125rem'],
    ['shadows', '0 0 1px #000'], ['shadows', '0 2px 16px rgba(0, 0, 0, 0.3)'], ['shadows', 'none'],
  ];
  const cases = SAMPLES.flatMap(([group, sample]) =>
    FORBIDDEN.flatMap((c) => [
      [group, sample, `${sample}${c}`],
      [group, sample, `${c}${sample}`],
      [group, sample, `${sample}${c}color:blue`],
    ] as Array<[V2CustomTokenGroup, string, string]>)
  );

  it('every sample is itself valid', () => {
    for (const [group, sample] of SAMPLES) expect([group, sample, validTokenValue(group, sample)]).toEqual([group, sample, sample]);
  });

  it.each(cases)('%s: %p becomes %p → null, and the builder emits nothing', (group, _sample, value) => {
    expect(validTokenValue(group, value)).toBeNull();
    const key = Object.keys(V2_CUSTOM_TOKEN_VARS[group])[0];
    expect(buildV2CustomTokenCss({ [group]: { [key]: value } })).toBe('');
  });
});

describe('T-C3 every default value passes its grammar', () => {
  const defaults: Record<V2CustomTokenGroup, Record<string, string>> = {
    colors: {
      background: v2Tokens.colors.background, surface: v2Tokens.colors.surface,
      surfaceHover: '#F9FAFB', border: '#E5E7EB',
      primary: v2Tokens.colors.brand.primary, primaryDark: v2Tokens.colors.brand.primaryDark,
      secondary: v2Tokens.colors.brand.secondary,
      textPrimary: v2Tokens.colors.text.primary, textSecondary: v2Tokens.colors.text.secondary,
      textMuted: v2Tokens.colors.text.muted,
      successBg: v2Tokens.colors.success.bg, successBorder: v2Tokens.colors.success.border,
      successText: v2Tokens.colors.success.text, successIcon: v2Tokens.colors.success.icon,
      errorBg: v2Tokens.colors.error.bg, errorBorder: v2Tokens.colors.error.border,
      errorText: v2Tokens.colors.error.text, errorIcon: v2Tokens.colors.error.icon,
    },
    borderRadius: { ...v2Tokens.borderRadius },
    shadows: { ...v2Tokens.shadows },
    spacing: { ...v2Tokens.spacing },
    typography: {
      fontSizeBase: v2Tokens.typography.fontSize.base,
      fontSizeLg: v2Tokens.typography.fontSize.lg,
      fontSizeXl: v2Tokens.typography.fontSize.xl,
    },
  };

  for (const group of Object.keys(V2_CUSTOM_TOKEN_VARS) as V2CustomTokenGroup[]) {
    for (const key of Object.keys(V2_CUSTOM_TOKEN_VARS[group])) {
      it(`${group}.${key}`, () => {
        const value = defaults[group][key];
        expect(value).toBeDefined();
        expect(validTokenValue(group, value)).toBe(value);
      });
    }
  }
});

describe('T-C4 injection, straight into the builder (defence in depth)', () => {
  const payloads = [
    'red;}body{display:none',
    'red</style><script>alert(1)</script>',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    'var(--x)',
    '#fff;--v2-bg:red',
    '/* x */',
    'x'.repeat(10_000),
    'red\nblue',
    'red\u2028blue',
    '<!--',
    '-->',
    '#fff\n}',
  ];

  it.each(payloads.map((p) => [p.length > 40 ? `${p.slice(0, 20)}…(${p.length})` : JSON.stringify(p), p]))(
    'rejects %s in every group',
    (_label, payload) => {
      const raw = {
        colors: { primary: payload, secondary: '#0000A2' },
        borderRadius: { panel: payload },
        shadows: { card: payload },
        spacing: { card: payload },
        typography: { fontSizeBase: payload },
      };
      const css = buildV2CustomTokenCss(raw);
      expect(css).toBe(`${V2_CUSTOM_TOKENS_SELECTOR}{--v2-secondary:#0000A2}`);
      expect(css).not.toContain(payload);
    }
  );

  it('never emits <, >, a comment, a newline, or a second brace pair, whatever it is given', () => {
    const raw = { colors: Object.fromEntries(payloads.map((p, i) => [Object.keys(V2_CUSTOM_TOKEN_VARS.colors)[i], p])) };
    const css = buildV2CustomTokenCss(raw);
    expect(css).toBe('');
    const ok = buildV2CustomTokenCss({ colors: { primary: '#0000A1' }, shadows: { card: '0 0 1px #000' } });
    expect(ok).not.toMatch(/[<>\n\u2028]|\/\*/);
    expect(ok.match(/\{/g)).toHaveLength(1);
    expect(ok.match(/\}/g)).toHaveLength(1);
  });

  it('emits a whitespace-padded valid value trimmed (RC-13(a), (c))', () => {
    expect(buildV2CustomTokenCss({ colors: { primary: ' #0000A1 ' } })).toBe(
      `${V2_CUSTOM_TOKENS_SELECTOR}{--v2-primary:#0000A1}`
    );
  });

  it('takes property names only from the allow-list', () => {
    const css = buildV2CustomTokenCss({
      colors: { primary: '#0000A1', '--v2-bg': '#0000A2', 'x}body{y': '#0000A3' },
      '--v2-evil': { a: '#fff' },
    });
    expect(css).toBe(`${V2_CUSTOM_TOKENS_SELECTOR}{--v2-primary:#0000A1}`);
  });
});

describe('T-C5 builder and component shape', () => {
  it('gives an empty string for nothing valid', () => {
    expect(buildV2CustomTokenCss({})).toBe('');
    expect(buildV2CustomTokenCss(null)).toBe('');
    expect(buildV2CustomTokenCss({ colors: { primary: 'var(--x)' } })).toBe('');
  });

  it('emits one rule, in allow-list order', () => {
    const css = buildV2CustomTokenCss({
      typography: { fontSizeBase: '1rem' },
      colors: { secondary: '#0000A2', primary: '#0000A1' },
    });
    expect(css).toBe(':root:root:root{--v2-primary:#0000A1;--v2-secondary:#0000A2;--v2-font-size-base:1rem}');
  });

  it('the component renders nothing for no tokens and one <style> otherwise', () => {
    expect(renderToStaticMarkup(React.createElement(V2CustomTokensStyle, { tokens: {} }))).toBe('');
    const markup = renderToStaticMarkup(
      React.createElement(V2CustomTokensStyle, { tokens: { colors: { primary: '#0000A1' } } })
    );
    expect(markup).toBe('<style data-v2-custom-tokens="">:root:root:root{--v2-primary:#0000A1}</style>');
  });
});
