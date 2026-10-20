/**
 * @jest-environment node
 *
 * WCAG contrast of the plan comparison window, on the computed token values
 * (upgrade modal UM-3 §7, A-1 to A-6; SA Y-3, Y-7). A TEST-ONLY helper: it reads
 * the token hex values from `app/v2/globals-v2.css`, light (`:root`) and dark
 * (`html.dark`, falling back to `:root` for a token it does not override), and
 * computes the WCAG 2.x ratio. No product code, no new dependency, no jest-axe.
 *
 * The defaults are the source of truth (R-2): a platform custom theme that
 * rewrites --v2-primary is a theme-config matter, checked live (run sheet U3-3).
 *
 * Each pair is the one the modal actually paints, so a token swap that breaks
 * AA fails here: small text ≥ 4.5:1, non-text (icons, marks) ≥ 3:1.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const css = readFileSync(join(process.cwd(), 'app/v2/globals-v2.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = css.slice(start, css.indexOf('}', start));
  const tokens: Record<string, string> = {};
  for (const match of Array.from(body.matchAll(/--(v2-[\w-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g))) tokens[match[1]] = match[2];
  return tokens;
}

const LIGHT = block(':root');
const DARK = { ...LIGHT, ...block('html.dark') };
type Theme = 'light' | 'dark';
const THEMES: Record<Theme, Record<string, string>> = { light: LIGHT, dark: DARK };

type Rgb = [number, number, number];
const WHITE: Rgb = [255, 255, 255];

function hex(theme: Theme, token: string): Rgb {
  const value = THEMES[theme][token];
  if (!value) throw new Error(`token ${token} missing in ${theme}`);
  return [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16)) as Rgb;
}

/** `top` at `alpha` over `under` (Tailwind's `/5`, `/15`, `opacity-90`). */
const over = (top: Rgb, alpha: number, under: Rgb): Rgb => top.map((channel, i) => channel * alpha + under[i] * (1 - alpha)) as Rgb;

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

describe('the helper is right (known WCAG values)', () => {
  it('black on white is 21:1, white on white 1:1, #767676 on white about 4.54:1', () => {
    expect(contrast([0, 0, 0], WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrast([118, 118, 118], WHITE)).toBeCloseTo(4.54, 2);
  });

  it('reads both themes: dark overrides the surface, not the primary', () => {
    expect(THEMES.dark['v2-surface']).not.toBe(THEMES.light['v2-surface']);
    expect(THEMES.dark['v2-primary-dark']).toBe(THEMES.light['v2-primary-dark']);
  });

  it('the findings that motivated UM-3 are real: muted small text and white on --v2-primary fail', () => {
    expect(contrast(hex('light', 'v2-text-muted'), hex('light', 'v2-surface'))).toBeLessThan(TEXT);
    expect(contrast(WHITE, hex('light', 'v2-primary'))).toBeLessThan(TEXT);
    expect(contrast(hex('dark', 'v2-primary'), hex('dark', 'v2-surface'))).toBeLessThan(TEXT);
  });
});

describe('A-1 / A-3: white text on the band and on the primary buttons (C-9)', () => {
  it.each(['light', 'dark'] as const)('%s: white on --v2-primary-dark ≥ 4.5:1', (theme) => {
    expect(contrast(WHITE, hex(theme, 'v2-primary-dark'))).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('A-2 / Y-3: the X as it renders, white at opacity-90 over the band', () => {
  it.each(['light', 'dark'] as const)('%s: over the gradient end (--v2-secondary) and over --v2-primary-dark, ≥ 3:1', (theme) => {
    for (const backdrop of ['v2-secondary', 'v2-primary-dark']) {
      const under = hex(theme, backdrop);
      expect({ backdrop, ok: contrast(over(WHITE, 0.9, under), under) >= NON_TEXT }).toEqual({ backdrop, ok: true });
    }
  });
  // The busy `opacity-40` state is disabled (pointer-events-none), so WCAG 1.4.11 exempts it.
});

describe('A-4 / Y-7: small secondary text on every surface it sits on', () => {
  const surfaces = (theme: Theme): Array<[string, Rgb]> => [
    ['--v2-surface', hex(theme, 'v2-surface')],
    ['--v2-surface-hover (current column)', hex(theme, 'v2-surface-hover')],
    ['--v2-primary at 5 % (recommended column)', over(hex(theme, 'v2-primary'), 0.05, hex(theme, 'v2-surface'))],
  ];
  it.each(['light', 'dark'] as const)('%s: --v2-text-secondary ≥ 4.5:1 on the surface and both column tints', (theme) => {
    for (const [name, under] of surfaces(theme)) {
      expect({ name, ok: contrast(hex(theme, "v2-text-secondary"), under) >= TEXT }).toEqual({ name, ok: true });
    }
  });

  it.each(['light', 'dark'] as const)('%s: the "Coming soon" chip on --v2-bg reads ≥ 4.5:1 in the token it uses (--v2-text-primary)', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), hex(theme, 'v2-bg'))).toBeGreaterThanOrEqual(TEXT);
  });

  it('why the chip is not --v2-text-secondary: on --v2-bg in light it is just under AA', () => {
    expect(contrast(hex('light', 'v2-text-secondary'), hex('light', 'v2-bg'))).toBeLessThan(TEXT);
  });
});

describe('A-5: the "Back to plans" link', () => {
  it.each(['light', 'dark'] as const)('%s: --v2-text-primary on the surface ≥ 4.5:1', (theme) => {
    expect(contrast(hex(theme, 'v2-text-primary'), hex(theme, 'v2-surface'))).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('A-6: ✓ / ✕ marks, non-text ≥ 3:1', () => {
  it.each(['light', 'dark'] as const)('%s: ✓ (--v2-success-icon on --v2-success/15) and ✕ (--v2-text-secondary on --v2-border)', (theme) => {
    const tick = contrast(hex(theme, 'v2-success-icon'), over(hex(theme, 'v2-success'), 0.15, hex(theme, 'v2-surface')));
    const cross = contrast(hex(theme, 'v2-text-secondary'), hex(theme, 'v2-border'));
    expect({ tick: tick >= NON_TEXT, cross: cross >= NON_TEXT }).toEqual({ tick: true, cross: true });
  });
});
