// lib/design-system-v2/customTokens.ts

/**
 * Platform custom design tokens: the allow-list, the value grammars, the
 * sanitizer and the CSS builder (performance slice TH-1, TH-2 folded in).
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * An admin saves custom tokens in `/admin/ui-config`. Since slice F-1 the save
 * is validated by `lib/validation/admin-ui-config-schema.ts`, which is built from
 * this module's allow-list and `validTokenValue`, so both sides share one
 * grammar. They used to reach the page only through `style.setProperty` in the
 * browser. Now they are read on the server and written into a raw `<style>`
 * element on every owner page, so THIS module remains the security boundary for
 * the read: nothing outside the allow-list, and no value outside its grammar,
 * can reach the HTML, whatever is stored.
 *
 * Pure: no React, no Next, no I/O, no logger (guard G-12). The provider imports
 * only the type.
 *
 * ── The rules ───────────────────────────────────────────────────────────────
 * - The allow-list is iterated, never the input's keys, so `__proto__`,
 *   `constructor` and unknown keys are never read or copied.
 * - Values must be strings, trimmed length 1..200, and match the group's
 *   anchored grammar. No grammar admits `;`, `{`, `}`, `<`, `>`, `\`, quotes,
 *   `@` or `*`, so a value cannot end the declaration, close the rule, open a
 *   comment, or close the `<style>` element.
 * - Each custom value overrides its default in light AND dark with the same
 *   value, exactly as `V2ThemeProvider` does (`custom || (isDark ? … : …)`).
 */

/** The `system_settings_config` key holding the tokens. */
export const V2_CUSTOM_TOKENS_CONFIG_KEY = 'v2_custom_tokens';

/**
 * Custom key → the CSS variable the provider writes for it. 31 entries; the 12
 * `--v2-status-*` values are not overridable. The provider's own code is the
 * other half of this mapping, and the behavioural guard keeps them equal.
 */
export const V2_CUSTOM_TOKEN_VARS = {
  colors: {
    background: '--v2-bg',
    surface: '--v2-surface',
    surfaceHover: '--v2-surface-hover',
    border: '--v2-border',
    primary: '--v2-primary',
    primaryDark: '--v2-primary-dark',
    secondary: '--v2-secondary',
    textPrimary: '--v2-text-primary',
    textSecondary: '--v2-text-secondary',
    textMuted: '--v2-text-muted',
    successBg: '--v2-success-bg',
    successBorder: '--v2-success-border',
    successText: '--v2-success-text',
    successIcon: '--v2-success-icon',
    errorBg: '--v2-error-bg',
    errorBorder: '--v2-error-border',
    errorText: '--v2-error-text',
    errorIcon: '--v2-error-icon',
  },
  borderRadius: {
    panel: '--v2-radius-panel',
    card: '--v2-radius-card',
    button: '--v2-radius-button',
    input: '--v2-radius-input',
  },
  shadows: {
    card: '--v2-shadow-card',
    cardHover: '--v2-shadow-card-hover',
    button: '--v2-shadow-button',
  },
  spacing: {
    panel: '--v2-spacing-panel',
    card: '--v2-spacing-card',
    section: '--v2-spacing-section',
  },
  typography: {
    fontSizeBase: '--v2-font-size-base',
    fontSizeLg: '--v2-font-size-lg',
    fontSizeXl: '--v2-font-size-xl',
  },
} as const;

export type V2CustomTokenGroup = keyof typeof V2_CUSTOM_TOKEN_VARS;

/** Validated custom tokens. Every present value passed its group's grammar. */
export type V2CustomTokens = {
  readonly [G in V2CustomTokenGroup]?: Readonly<Partial<Record<keyof (typeof V2_CUSTOM_TOKEN_VARS)[G], string>>>;
};

const MAX_VALUE_LENGTH = 200;

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
// Whitespace is a space or a tab only: newlines, U+2028/2029, NBSP and U+FEFF
// are not CSS whitespace and are rejected here rather than failing silently later.
const FUNCTIONAL_COLOR = /^(?:rgb|rgba|hsl|hsla)\([0-9.,% \t/]+\)$/i;
// Named colours, `transparent`, `currentColor`. Letters only cannot inject.
const NAMED_COLOR = /^[a-z]{3,30}$/i;

const LENGTH = '(?:0|\\d{1,4}(?:\\.\\d{1,3})?(?:px|rem|em|%))';
const LENGTH_LIST = new RegExp(`^${LENGTH}(?:[ \\t]+${LENGTH}){0,3}$`, 'i');

const SHADOW_CHARS = /^[0-9a-z#.,%() \t-]+$/i;
const SHADOW_WORDS = new Set(['inset', 'px', 'rem', 'em', 'rgb', 'rgba', 'hsl', 'hsla']);

function isColor(value: string): boolean {
  return HEX_COLOR.test(value) || FUNCTIONAL_COLOR.test(value) || NAMED_COLOR.test(value);
}

function isShadow(value: string): boolean {
  if (value.toLowerCase() === 'none') return true;
  if (!SHADOW_CHARS.test(value)) return false;
  // Every alphabetic run, once hex colours are removed, must be a known word.
  const withoutHex = value.replace(/#[0-9a-f]{3,8}\b/gi, ' ');
  const words = withoutHex.match(/[a-z]+/gi) ?? [];
  return words.every((word) => SHADOW_WORDS.has(word.toLowerCase()));
}

const GRAMMAR: Record<V2CustomTokenGroup, (value: string) => boolean> = {
  colors: isColor,
  borderRadius: (v) => LENGTH_LIST.test(v),
  spacing: (v) => LENGTH_LIST.test(v),
  typography: (v) => LENGTH_LIST.test(v),
  shadows: isShadow,
};

const GROUPS = Object.keys(V2_CUSTOM_TOKEN_VARS) as V2CustomTokenGroup[];

/** The trimmed value when it is a valid token for `group`, otherwise `null`. */
export function validTokenValue(group: V2CustomTokenGroup, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return null;
  return GRAMMAR[group](value) ? value : null;
}

/**
 * A plain object for our purposes: a non-null, non-array object. An
 * `Object.create(null)` object counts (only own properties are read).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const hasOwn = (obj: object, key: string) => Object.prototype.hasOwnProperty.call(obj, key);

export interface SanitizeResult {
  tokens: V2CustomTokens;
  /** `group.key` names whose value was present but rejected. Names only. */
  droppedKeys: string[];
}

/**
 * Keep only allow-listed keys with grammar-valid values. Never throws. The
 * result is deep-frozen, because the server reader shares it across requests.
 */
export function sanitizeV2CustomTokensDetailed(raw: unknown): SanitizeResult {
  const out: Record<string, Record<string, string>> = {};
  const droppedKeys: string[] = [];
  if (!isRecord(raw)) return { tokens: Object.freeze({}), droppedKeys };

  for (const group of GROUPS) {
    if (!hasOwn(raw, group)) continue;
    const source = raw[group];
    if (!isRecord(source)) {
      droppedKeys.push(group);
      continue;
    }
    const kept: Record<string, string> = {};
    for (const key of Object.keys(V2_CUSTOM_TOKEN_VARS[group])) {
      if (!hasOwn(source, key)) continue;
      const value = validTokenValue(group, source[key]);
      if (value === null) droppedKeys.push(`${group}.${key}`);
      else kept[key] = value;
    }
    if (Object.keys(kept).length > 0) out[group] = Object.freeze(kept);
  }
  return { tokens: Object.freeze(out) as V2CustomTokens, droppedKeys };
}

export function sanitizeV2CustomTokens(raw: unknown): V2CustomTokens {
  return sanitizeV2CustomTokensDetailed(raw).tokens;
}

/** The selector of the inlined rule. Specificity 0,3,0 beats every default sheet, in any load order. */
export const V2_CUSTOM_TOKENS_SELECTOR = ':root:root:root';

/**
 * The CSS rule for the inlined `<style>`, or `''` when nothing is valid.
 *
 * Walks the allow-list again and re-checks every value, so an object that never
 * went through the sanitizer still cannot inject (defence in depth). Emits the
 * trimmed, validated value, never the raw one. Property names come only from
 * the constant map.
 */
export function buildV2CustomTokenCss(tokens: unknown): string {
  if (!isRecord(tokens)) return '';
  const declarations: string[] = [];
  for (const group of GROUPS) {
    if (!hasOwn(tokens, group)) continue;
    const source = tokens[group];
    if (!isRecord(source)) continue;
    const vars = V2_CUSTOM_TOKEN_VARS[group] as Record<string, string>;
    for (const key of Object.keys(vars)) {
      if (!hasOwn(source, key)) continue;
      const value = validTokenValue(group, source[key]);
      if (value !== null) declarations.push(`${vars[key]}:${value}`);
    }
  }
  return declarations.length === 0 ? '' : `${V2_CUSTOM_TOKENS_SELECTOR}{${declarations.join(';')}}`;
}
