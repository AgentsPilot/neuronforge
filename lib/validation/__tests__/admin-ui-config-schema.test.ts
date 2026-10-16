/**
 * T-2, T-3, T-4 (slice F-1): the write-side schema for `/api/admin/ui-config`.
 *
 *   T-2  each group's grammar, unknown keys/groups, trimming, empty removal (R-2)
 *   T-3  read/write parity with TH-1's sanitizer, the anti-drift pin (R-3 a)
 *   T-3b the 400 key list names only allow-listed keys (R-3 b)
 *   T-4  every preset and every default the editor pre-fills passes (R-5)
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';

import {
  V2_CUSTOM_TOKEN_VARS,
  sanitizeV2CustomTokens,
  sanitizeV2CustomTokensDetailed,
  type V2CustomTokenGroup,
} from '@/lib/design-system-v2/customTokens';
import { v2Tokens } from '@/lib/design-system-v2/tokens';
import {
  CUSTOM_OPTION,
  fontSizeOptions,
  radiusOptions,
  shadowOptions,
  spacingOptions,
} from '@/app/admin/ui-config/presets';
import {
  invalidTokenKeys,
  invalidTokensMessage,
  stripEmptyTokenValues,
  uiConfigPostSchema,
  v2CustomTokensWriteSchema,
} from '../admin-ui-config-schema';

const GROUPS = Object.keys(V2_CUSTOM_TOKEN_VARS) as V2CustomTokenGroup[];
const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const parse = (tokens: unknown) => v2CustomTokensWriteSchema.safeParse(tokens);

describe('T-2 grammar per group', () => {
  it.each([
    ['colors', 'primary', ['#6366F1', '#fff', '#ffff', '#11223344', 'rgb(1, 2, 3)', 'rgba(0,0,0,0.5)', 'hsl(10 20% 30%)', 'transparent', 'red']],
    ['borderRadius', 'card', ['0', '12px', '1.5rem', '50%', '4px 8px', '1em 2em 3em 4em']],
    ['spacing', 'panel', ['32px', '0', '2rem']],
    ['typography', 'fontSizeBase', ['1rem', '16px']],
    ['shadows', 'card', ['none', '0 1px 2px rgba(0,0,0,0.05)', 'inset 0 0 4px #000', '0 2px 4px hsla(0, 0%, 0%, 0.1)']],
  ] as const)('%s accepts its grammar', (group, key, values) => {
    for (const value of values) {
      const result = parse({ [group]: { [key]: value } });
      expect([value, result.success]).toEqual([value, true]);
    }
  });

  const hostile = [
    'red;}',
    'red;}body{display:none',
    '#fff}',
    '#fff{',
    '<style>',
    '"#fff"',
    "'#fff'",
    '#fff\\',
    '#fff\nred',
    'url(javascript:alert(1))',
    'expression(alert(1))',
    'a'.repeat(201),
  ];

  it.each(GROUPS)('%s rejects hostile values and non-strings', (group) => {
    const key = Object.keys(V2_CUSTOM_TOKEN_VARS[group])[0];
    for (const value of [...hostile, 12, true, null, {}, ['#fff']]) {
      const result = parse({ [group]: { [key]: value } });
      expect([group, value, result.success]).toEqual([group, value, false]);
    }
  });

  it('rejects unknown keys, unknown groups and non-object shapes', () => {
    expect(parse({ colors: { evil: '#fff' } }).success).toBe(false);
    expect(parse({ '--v2-bg': { primary: '#fff' } }).success).toBe(false);
    expect(parse({ colors: { evil: '' } }).success).toBe(false); // unknown key, even when empty
    for (const shape of [null, 'tokens', 42, ['#fff'], { colors: ['#fff'] }, { colors: null }]) {
      expect([shape, parse(shape).success]).toEqual([shape, false]);
    }
  });

  it('outputs the trimmed value', () => {
    const result = parse({ colors: { primary: '  #6366F1\t' }, spacing: { card: ' 24px ' } });
    expect(result.success && result.data).toEqual({ colors: { primary: '#6366F1' }, spacing: { card: '24px' } });
  });

  it('removes empty and whitespace-only values on allow-listed keys, and empty groups (Q-1)', () => {
    const result = parse({
      colors: { primary: '', secondary: '   ', background: '#fff' },
      shadows: { card: '' },
      spacing: {},
    });
    expect(result.success && result.data).toEqual({ colors: { background: '#fff' } });
  });

  it('rejects null and numbers rather than stripping them (R-2)', () => {
    expect(parse({ colors: { primary: null } }).success).toBe(false);
    expect(parse({ colors: { primary: 0 } }).success).toBe(false);
  });

  it('accepts an empty object (nothing to override)', () => {
    expect(parse({})).toEqual({ success: true, data: {} });
  });
});

describe('T-2 prototype safety of the empty-value walk (R-2, R-4)', () => {
  afterEach(() => {
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it.each([
    ['top-level __proto__', '{"__proto__":{"x":"1"}}'],
    ['top-level constructor', '{"constructor":{"prototype":{"x":"1"}}}'],
    ['top-level prototype', '{"prototype":{"x":"1"}}'],
    ['group-level __proto__', '{"colors":{"__proto__":{"x":"1"}}}'],
    ['group-level __proto__ empty', '{"colors":{"__proto__":""}}'],
    ['group-level constructor', '{"colors":{"constructor":"#fff"}}'],
    ['group-level constructor empty', '{"colors":{"constructor":""}}'],
    ['group-level prototype', '{"colors":{"prototype":"#fff"}}'],
    ['__proto__ beside a valid key', '{"colors":{"primary":"#fff","__proto__":{"polluted":"1"}}}'],
  ])('rejects %s', (_label, json) => {
    const raw: unknown = JSON.parse(json);
    expect(parse(raw).success).toBe(false);
  });

  it('keeps an own __proto__ key as an own key instead of setting the prototype', () => {
    const raw = JSON.parse('{"__proto__":{"x":"1"},"colors":{"__proto__":"","primary":""}}');
    const stripped = stripEmptyTokenValues(raw) as Record<string, unknown>;
    expect(Object.getPrototypeOf(stripped)).toBe(Object.prototype);
    expect(hasOwn(stripped, '__proto__')).toBe(true);
    const colors = stripped.colors as Record<string, unknown>;
    expect(Object.getPrototypeOf(colors)).toBe(Object.prototype);
    // `__proto__` is not allow-listed, so its empty value is kept for the schema to reject.
    expect(hasOwn(colors, '__proto__')).toBe(true);
    expect(hasOwn(colors, 'primary')).toBe(false);
  });
});

/* ── T-3 parity ─────────────────────────────────────────────────────────── */

/** True iff every own group and key is allow-listed and every group is an object. */
function onlyAllowListedShape(raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  return Object.keys(raw).every((group) => {
    if (!hasOwn(V2_CUSTOM_TOKEN_VARS, group)) return false;
    const source = raw[group];
    // A non-object group is reported by the sanitizer in droppedKeys; let that decide.
    if (!isRecord(source)) return true;
    return Object.keys(source).every((key) => hasOwn(V2_CUSTOM_TOKEN_VARS[group as V2CustomTokenGroup], key));
  });
}

const CORPUS: Array<[string, unknown]> = [
  ['empty', {}],
  ['one valid colour', { colors: { primary: '#6366F1' } }],
  ['every group valid', { colors: { background: '#F5F5F7', textMuted: 'gray' }, borderRadius: { card: '12px' }, shadows: { card: 'none' }, spacing: { section: '2rem' }, typography: { fontSizeXl: '1.25rem' } }],
  ['padded values', { colors: { primary: ' #fff ' } }],
  ['empty values', { colors: { primary: '', secondary: '#fff' }, shadows: { card: ' ' } }],
  ['one invalid value', { colors: { primary: 'red;}', secondary: '#fff' } }],
  ['shadow with url', { shadows: { card: 'url(javascript:alert(1))' } }],
  ['number value', { spacing: { card: 24 } }],
  ['null value', { spacing: { card: null } }],
  ['group is a string', { colors: '#fff' }],
  ['group is an array', { colors: ['#fff'] }],
  ['unknown key', { colors: { evil: '#fff' } }],
  ['unknown group', { evil: { primary: '#fff' } }],
  ['css var as group', { '--v2-bg': '#000' }],
  ['array tokens', ['#fff']],
  ['string tokens', 'colors'],
  ['null tokens', null],
  ['proto top', JSON.parse('{"__proto__":{"x":"1"}}')],
  ['proto group', JSON.parse('{"colors":{"__proto__":"#fff"}}')],
  ['constructor group', JSON.parse('{"colors":{"constructor":"#fff"}}')],
  ['valid + proto', JSON.parse('{"colors":{"primary":"#fff"},"__proto__":{"colors":{"primary":"red"}}}')],
  ['201 chars', { borderRadius: { card: '1'.repeat(201) } }],
  ['200-char shadow', { shadows: { card: `0 0 ${'1'.repeat(190)}px #000` } }],
];

describe('T-3 read/write parity with the TH-1 sanitizer (R-3 a)', () => {
  it.each(CORPUS)('%s', (_label, input) => {
    const stripped = stripEmptyTokenValues(input);
    const { droppedKeys } = sanitizeV2CustomTokensDetailed(stripped);
    const expected = droppedKeys.length === 0 && onlyAllowListedShape(stripped);

    const result = parse(input);
    expect(result.success).toBe(expected);
    if (result.success) {
      expect(result.data).toEqual(sanitizeV2CustomTokens(stripped));
    }
  });

  it('the corpus covers both outcomes', () => {
    const outcomes = new Set(CORPUS.map(([, input]) => parse(input).success));
    expect(outcomes).toEqual(new Set([true, false]));
  });
});

describe('T-3b the 400 key list (R-3 b)', () => {
  const postError = (tokens: unknown) => {
    const result = uiConfigPostSchema.safeParse({ action: 'save_tokens', data: { tokens } });
    if (result.success) throw new Error('expected a failure');
    return result.error;
  };

  it('names allow-listed keys with the data.tokens prefix stripped', () => {
    expect(invalidTokenKeys(postError({ colors: { primary: 'red;}' }, shadows: { card: 'url(x)' } }))).toEqual({
      invalidKeys: ['colors.primary', 'shadows.card'],
      unknownCount: 0,
    });
  });

  it('names a non-object allow-listed group by its group name', () => {
    expect(invalidTokenKeys(postError({ colors: 'red' }))?.invalidKeys).toEqual(['colors']);
  });

  it('counts unknown groups and keys but never names them', () => {
    const summary = invalidTokenKeys(postError({ colors: { evilKey: '#fff' }, evilGroup: {} }));
    expect(summary).toEqual({ invalidKeys: [], unknownCount: 2 });
    const message = invalidTokensMessage(summary!);
    expect(message).not.toContain('evil');
    expect(message).toContain('unknown setting');
  });

  it('never names a prototype key', () => {
    const summary = invalidTokenKeys(postError(JSON.parse('{"__proto__":{"x":"1"},"colors":{"constructor":"#fff","primary":"bad;"}}')));
    expect(summary).toEqual({ invalidKeys: ['colors.primary'], unknownCount: 2 });
    expect(invalidTokensMessage(summary!)).not.toMatch(/__proto__|constructor/);
  });

  it('dedupes, sorts and caps the names in the message', () => {
    const colors = Object.fromEntries(Object.keys(V2_CUSTOM_TOKEN_VARS.colors).map((k) => [k, 'bad;']));
    const summary = invalidTokenKeys(postError({ colors }))!;
    expect(summary.invalidKeys).toHaveLength(18);
    expect(summary.invalidKeys).toEqual([...summary.invalidKeys].sort());
    expect(invalidTokensMessage(summary)).toContain('and 8 more');
  });

  it('never names a key outside the allow-list, even from an issue Zod would not raise today', () => {
    const forged = new z.ZodError([
      { code: z.ZodIssueCode.custom, path: ['data', 'tokens', 'colors', '__proto__'], message: 'x' },
      { code: z.ZodIssueCode.custom, path: ['data', 'tokens', 'colors', 'evilKey'], message: 'x' },
      { code: z.ZodIssueCode.custom, path: ['data', 'tokens', 'evilGroup'], message: 'x' },
      { code: z.ZodIssueCode.custom, path: ['data', 'tokens', 'colors', 'primary'], message: 'x' },
    ]);
    expect(invalidTokenKeys(forged)?.invalidKeys).toEqual(['colors.primary']);
  });

  it('issue messages never carry the rejected value', () => {
    const result = parse({ colors: { primary: 'red;}SECRET' }, shadows: { card: 'url(SECRET)' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(JSON.stringify(result.error.issues)).not.toContain('SECRET');
  });

  it('returns null when no issue concerns the tokens', () => {
    const result = uiConfigPostSchema.safeParse({ action: 'update_version', data: { version: 'v3' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(invalidTokenKeys(result.error)).toBeNull();
  });

  it('reports a non-object token payload as a token problem with no names', () => {
    expect(invalidTokenKeys(postError(['#fff']))).toEqual({ invalidKeys: [], unknownCount: 0 });
  });
});

describe('the POST body schema', () => {
  it.each([
    [{ action: 'update_version', data: { version: 'v1' } }, true],
    [{ action: 'update_version', data: { version: 'v2' } }, true],
    [{ action: 'update_version', data: { version: 'v3' } }, false],
    [{ action: 'update_version', data: { version: 2 } }, false],
    [{ action: 'update_version', data: {} }, false],
    [{ action: 'save_tokens', data: { tokens: { colors: { primary: '#fff' } } } }, true],
    [{ action: 'save_tokens', data: {} }, false],
    [{ action: 'reset_tokens', data: {} }, true],
    [{ action: 'reset_tokens' }, true],
    [{ action: 'drop_table' }, false],
    [{}, false],
  ])('%j → %s', (body, ok) => {
    expect(uiConfigPostSchema.safeParse(body).success).toBe(ok);
  });
});

/* ── T-4 presets and defaults ─────────────────────────────────────────── */

describe('T-4 the page never offers a value its own save refuses (R-5)', () => {
  it.each([
    ['borderRadius', radiusOptions],
    ['shadows', shadowOptions],
    ['spacing', spacingOptions],
    ['typography', fontSizeOptions],
  ] as const)('every %s preset passes', (group, options) => {
    const values = options.filter((o) => o !== CUSTOM_OPTION);
    expect(values.length).toBeGreaterThan(0);
    const key = Object.keys(V2_CUSTOM_TOKEN_VARS[group])[0];
    for (const value of values) {
      expect([value, parse({ [group]: { [key]: value } }).success]).toEqual([value, true]);
    }
  });

  // The editor pre-fills each field with `customTokens.<group>?.<key> || v2Tokens.<path>`.
  // Read from the page source so a new field is covered without editing this test.
  const page = readFileSync(join(process.cwd(), 'app/admin/ui-config/page.tsx'), 'utf8');
  const FALLBACK = /customTokens\.(\w+)\?\.(\w+)\s*\|\|\s*v2Tokens\.([\w.]+)/g;
  const fallbacks = [...page.matchAll(FALLBACK)].map((m) => ({ group: m[1], key: m[2], path: m[3] }));

  it('finds every field of the editor', () => {
    expect(fallbacks.length).toBe(28);
  });

  it.each(fallbacks.map((f) => [`${f.group}.${f.key} ← v2Tokens.${f.path}`, f] as const))(
    '%s passes',
    (_label, { group, key, path }) => {
      expect(hasOwn(V2_CUSTOM_TOKEN_VARS, group)).toBe(true);
      expect(hasOwn(V2_CUSTOM_TOKEN_VARS[group as V2CustomTokenGroup], key)).toBe(true);
      const value = path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], v2Tokens);
      expect(typeof value).toBe('string');
      expect([value, parse({ [group]: { [key]: value } }).success]).toEqual([value, true]);
    }
  );
});
